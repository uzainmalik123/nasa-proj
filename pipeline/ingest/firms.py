"""NASA FIRMS active-fire detections (PRD §7.2 step 1).

Three jobs:

(a) live   ``world/2`` for ``FIRMS_LIVE_SOURCE`` (VIIRS dots) and ``MODIS_NRT``
           (counts), kept to the last 24 h by ``acq_date + acq_time``. ``world/N``
           counts days back from today UTC, so ``world/1`` is nearly empty early
           in the day; never use it. Rows are merged into
           ``firms/{acq_date}.parquet`` and de-duplicated on
           ``(lat, lon, acq_date, acq_time, satellite)`` across runs. The 24 h
           slice is also written to ``firms_live.parquet`` for fires_24h.json.
(b) history  ``MODIS_SP`` in 5-day ``world`` chunks (the API cap) back 12 months.
           The SP archive lags (max 2026-08-31 on 14 Nov), so days after the SP
           max come from ``MODIS_NRT`` instead. Fetched chunks are recorded in
           ``firms/_history.json`` and skipped on later runs.
(c) counts  every cached MODIS row (``type`` 0 = vegetation fire; NRT rows carry
           no ``type`` and are kept) joined to places within ``RADIUS_KM`` with a
           KD-tree on unit vectors → ``firms_counts.parquet``
           (``place_id, date, n, frp_sum``, dense: one row per place per date).
"""

from __future__ import annotations

import io
import json
import logging
import os
import time
from collections import deque
from datetime import UTC, date, datetime, timedelta

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

import config
from ingest._http import Pacer, get

log = logging.getLogger("ingest.firms")

FIRMS_DIR = config.CACHE_DIR / "firms"
COUNTS_PATH = config.CACHE_DIR / "firms_counts.parquet"
LIVE_PATH = config.CACHE_DIR / "firms_live.parquet"
MANIFEST = FIRMS_DIR / "_history.json"
AVAILABILITY_URL = "https://firms.modaps.eosdis.nasa.gov/api/data_availability/csv"
STATUS_URL = "https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/"
# The MAP_KEY allows 5,000 "transactions" per 10 min, and one world request
# costs many (roughly proportional to rows; a 5-day MODIS_SP chunk ~150).
# Over the limit the API answers 400 "Exceeding allowed transaction limit".
QUOTA_HEADROOM = float(os.environ.get("FIRMS_QUOTA_HEADROOM", "0.85"))
QUOTA_POLL_S = 30
# The status counter lags by a minute or two, so also cap ourselves: at most
# this many world chunks per rolling 10 minutes (measured: ~22 chunks + live
# pulls exhausted the 5,000 budget on 14 Nov).
CHUNKS_PER_WINDOW = int(os.environ.get("FIRMS_CHUNKS_PER_10MIN", "18"))
WINDOW_S = 10 * 60
EARTH_R_KM = 6371.0088

SCHEMA = [
    "lat",
    "lon",
    "acq_date",
    "acq_time",
    "satellite",
    "frp",
    "confidence",
    "daynight",
    "type",
    "source",
]
DEDUPE_KEY = ["lat", "lon", "acq_date", "acq_time", "satellite"]

_pacer = Pacer(config.FIRMS_PACE_S)


# ---- fetch + normalise -----------------------------------------------------


def _url(source: str, window: str) -> str:
    return f"{config.FIRMS_API}/{config.FIRMS_MAP_KEY}/{source}/world/{window}"


def quota() -> tuple[int, int]:
    """(current_transactions, transaction_limit) for the MAP_KEY."""
    r = get(STATUS_URL, params={"MAP_KEY": config.FIRMS_MAP_KEY}, timeout=30, label="firms quota")
    j = r.json()
    return int(j.get("current_transactions", 0)), int(j.get("transaction_limit", 5000))


def wait_for_quota(need_frac: float = 1.0 - QUOTA_HEADROOM, max_wait_s: float = 15 * 60) -> None:
    """Block until at least ``need_frac`` of the 10-minute transaction budget is free."""
    t0 = time.monotonic()
    while True:
        try:
            used, limit = quota()
        except Exception as e:  # status endpoint hiccup: don't block the run on it
            log.warning("quota check failed: %s", e)
            return
        if used <= limit * (1.0 - need_frac):
            return
        if time.monotonic() - t0 > max_wait_s:
            log.warning("quota still %d/%d after %.0fs; proceeding", used, limit, max_wait_s)
            return
        log.info("FIRMS quota %d/%d used; waiting %ds for the window", used, limit, QUOTA_POLL_S)
        time.sleep(QUOTA_POLL_S)


def _is_quota_error(e: Exception) -> bool:
    r = getattr(e, "response", None)
    return r is not None and r.status_code == 400 and "transaction" in (r.text or "").lower()


def fetch(source: str, window: str, quota_tries: int = 4) -> pd.DataFrame:
    """GET one world window and return it normalised to SCHEMA (may be empty).

    A 400 "Exceeding allowed transaction limit" is not a failure: wait for the
    10-minute window to free up and try again.
    """
    for attempt in range(1, quota_tries + 1):
        try:
            r = get(
                _url(source, window), timeout=300, pacer=_pacer, label=f"firms {source} {window}"
            )
            break
        except Exception as e:
            if _is_quota_error(e) and attempt < quota_tries:
                log.warning(
                    "%s world/%s: quota exceeded (attempt %d); waiting", source, window, attempt
                )
                wait_for_quota(need_frac=0.5)
                continue
            raise
    text = r.text
    if not text.startswith("latitude"):
        # FIRMS answers some errors with 200 + a message line
        raise RuntimeError(f"FIRMS {source} world/{window}: {text[:200]!r}")
    raw = pd.read_csv(io.StringIO(text), dtype={"confidence": str, "acq_time": str})
    return normalise(raw, source)


def normalise(raw: pd.DataFrame, source: str) -> pd.DataFrame:
    if raw.empty:
        return pd.DataFrame(columns=SCHEMA)
    out = pd.DataFrame(
        {
            "lat": raw["latitude"].astype("float64"),
            "lon": raw["longitude"].astype("float64"),
            "acq_date": pd.to_datetime(raw["acq_date"]).dt.date,
            "acq_time": pd.to_numeric(raw["acq_time"], errors="coerce").astype("Int32"),
            "satellite": raw["satellite"].astype(str),
            "frp": pd.to_numeric(raw.get("frp"), errors="coerce").astype("float64"),
            "confidence": raw["confidence"].astype(str),
            "daynight": raw["daynight"].astype(str),
            "type": pd.to_numeric(raw["type"], errors="coerce").astype("Int8")
            if "type" in raw
            else pd.Series(pd.NA, index=raw.index, dtype="Int8"),
            "source": source,
        }
    )
    return out[SCHEMA]


def acq_datetime(df: pd.DataFrame) -> pd.Series:
    t = df["acq_time"].fillna(0).astype(int)
    return (
        pd.to_datetime(df["acq_date"].astype(str), utc=True)
        + pd.to_timedelta(t // 100, unit="h")
        + pd.to_timedelta(t % 100, unit="m")
    )


# ---- per-date cache --------------------------------------------------------


def day_path(d: date):
    return FIRMS_DIR / f"{d.isoformat()}.parquet"


def merge_into_cache(rows: pd.DataFrame) -> dict[str, int]:
    """Union ``rows`` into firms/{acq_date}.parquet files, de-duplicating."""
    FIRMS_DIR.mkdir(parents=True, exist_ok=True)
    written: dict[str, int] = {}
    if rows.empty:
        return written
    for d, part in rows.groupby("acq_date", sort=True):
        p = day_path(d)
        if p.exists():
            old = pd.read_parquet(p)
            part = pd.concat([old, part], ignore_index=True)
        part = part.drop_duplicates(DEDUPE_KEY, keep="last").reset_index(drop=True)
        part.to_parquet(p, index=False)
        written[d.isoformat()] = len(part)
    return written


# ---- (a) live --------------------------------------------------------------


def live(now: datetime | None = None) -> dict:
    now = now or datetime.now(UTC)
    cutoff = now - timedelta(hours=24)
    summary: dict = {"sources": {}, "newest": None, "rows_24h": 0}
    live_parts: list[pd.DataFrame] = []
    for source in dict.fromkeys([config.FIRMS_LIVE_SOURCE, config.FIRMS_COUNT_SOURCE]):
        df = fetch(source, "2")
        n_raw = len(df)
        if not df.empty:
            ts = acq_datetime(df)
            df = df[ts >= cutoff].copy()
            ts = ts[ts >= cutoff]
        newest = ts.max() if not df.empty else None
        merge_into_cache(df)
        live_parts.append(df)
        summary["sources"][source] = {
            "rows_world2": n_raw,
            "rows_24h": len(df),
            "newest": newest.isoformat() if newest is not None else None,
        }
        log.info(
            "live %s: %d rows in world/2, %d in last 24h, newest %s", source, n_raw, len(df), newest
        )
        if newest is not None and (summary["newest"] is None or newest > summary["newest"]):
            summary["newest"] = newest
    live_df = (
        pd.concat(live_parts, ignore_index=True) if live_parts else pd.DataFrame(columns=SCHEMA)
    )
    live_df.to_parquet(LIVE_PATH, index=False)
    summary["rows_24h"] = len(live_df)
    summary["retrieved_at"] = datetime.now(UTC)
    return summary


# ---- (b) history -----------------------------------------------------------


def availability() -> dict[str, tuple[date, date]]:
    r = get(
        f"{AVAILABILITY_URL}/{config.FIRMS_MAP_KEY}/ALL",
        timeout=60,
        pacer=_pacer,
        label="firms availability",
    )
    df = pd.read_csv(io.StringIO(r.text))
    return {
        row.data_id: (date.fromisoformat(row.min_date), date.fromisoformat(row.max_date))
        for row in df.itertuples(index=False)
    }


def load_manifest() -> dict:
    if MANIFEST.exists():
        try:
            return json.loads(MANIFEST.read_text())
        except json.JSONDecodeError:
            return {}
    return {}


def save_manifest(m: dict) -> None:
    FIRMS_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(m, indent=0, sort_keys=True))


def chunks(start: date, end: date, size: int) -> list[tuple[date, int]]:
    """(chunk_start, n_days) covering [start, end] inclusive in ``size``-day steps."""
    out = []
    d = start
    while d <= end:
        n = min(size, (end - d).days + 1)
        out.append((d, n))
        d += timedelta(days=n)
    return out


def history(today: date | None = None, months: int = config.FIRMS_HISTORY_MONTHS) -> dict:
    today = today or datetime.now(UTC).date()
    yesterday = today - timedelta(days=1)
    start = date(
        today.year - (1 if today.month <= months else 0), (today.month - months - 1) % 12 + 1, 1
    )
    avail = availability()
    sp_min, sp_max = avail.get(config.FIRMS_HISTORY_SOURCE, (None, None))
    nrt_min, _ = avail.get(config.FIRMS_COUNT_SOURCE, (None, None))
    plan: list[tuple[str, date, int]] = []
    if sp_max is not None:
        plan += [
            (config.FIRMS_HISTORY_SOURCE, d, n)
            for d, n in chunks(
                max(start, sp_min), min(sp_max, yesterday), config.FIRMS_WORLD_MAX_DAYS
            )
        ]
        nrt_start = max(sp_max + timedelta(days=1), start)
    else:
        nrt_start = start
    if nrt_min is not None:
        nrt_start = max(nrt_start, nrt_min)
    plan += [
        (config.FIRMS_COUNT_SOURCE, d, n)
        for d, n in chunks(nrt_start, yesterday, config.FIRMS_WORLD_MAX_DAYS)
    ]

    manifest = load_manifest()
    todo = [(s, d, n) for s, d, n in plan if f"{s}:{d.isoformat()}:{n}" not in manifest]
    log.info(
        "history: %d chunks planned (%s..%s), %d already cached, %d to fetch",
        len(plan),
        start,
        yesterday,
        len(plan) - len(todo),
        len(todo),
    )
    rows = 0
    failed = 0
    recent: deque[float] = deque()
    for i, (source, d, n) in enumerate(todo, 1):
        key = f"{source}:{d.isoformat()}:{n}"
        now = time.monotonic()
        while recent and now - recent[0] > WINDOW_S:
            recent.popleft()
        if len(recent) >= CHUNKS_PER_WINDOW:
            pause = WINDOW_S - (now - recent[0]) + 5
            log.info("history: %d chunks in the last 10 min; pausing %.0fs", len(recent), pause)
            time.sleep(max(0.0, pause))
        wait_for_quota()
        recent.append(time.monotonic())
        try:
            df = fetch(source, f"{n}/{d.isoformat()}")
        except Exception as e:
            failed += 1
            log.error("history %s failed: %s", key, e)
            continue
        merge_into_cache(df)
        rows += len(df)
        manifest[key] = {
            "rows": len(df),
            "fetched_at": datetime.now(UTC).isoformat(timespec="seconds"),
        }
        save_manifest(manifest)
        if i % 10 == 0 or i == len(todo):
            log.info("history %d/%d chunks · %d rows so far", i, len(todo), rows)
    return {
        "planned": len(plan),
        "fetched": len(todo) - failed,
        "failed": failed,
        "rows": rows,
        "sp_max": sp_max.isoformat() if sp_max else None,
        "start": start.isoformat(),
    }


# ---- (c) counts ------------------------------------------------------------


def unit_vectors(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    la, lo = np.radians(lat), np.radians(lon)
    return np.column_stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])


def chord(km: float) -> float:
    return 2.0 * np.sin(km / (2.0 * EARTH_R_KM))


def load_cached_modis() -> pd.DataFrame:
    parts = []
    for p in sorted(FIRMS_DIR.glob("????-??-??.parquet")):
        df = pd.read_parquet(p, columns=["lat", "lon", "acq_date", "frp", "type", "source"])
        df = df[df["source"].str.startswith("MODIS")]
        df = df[df["type"].isna() | (df["type"] == 0)]
        if not df.empty:
            parts.append(df)
    if not parts:
        return pd.DataFrame(columns=["lat", "lon", "acq_date", "frp", "type", "source"])
    return pd.concat(parts, ignore_index=True)


def counts(places: pd.DataFrame, radius_km: float = config.RADIUS_KM) -> dict:
    fires = load_cached_modis()
    dates = sorted(fires["acq_date"].unique()) if not fires.empty else []
    log.info("counts: %d MODIS vegetation-fire rows over %d dates", len(fires), len(dates))
    if fires.empty:
        out = pd.DataFrame(columns=["place_id", "date", "n", "frp_sum"])
        out.to_parquet(COUNTS_PATH, index=False)
        return {"rows": 0, "dates": 0, "nonzero": 0}
    tree = cKDTree(unit_vectors(fires["lat"].to_numpy(), fires["lon"].to_numpy()))
    pv = unit_vectors(places["lat"].to_numpy(), places["lon"].to_numpy())
    hits = tree.query_ball_point(pv, r=chord(radius_km))
    fire_dates = fires["acq_date"].to_numpy()
    fire_frp = fires["frp"].fillna(0.0).to_numpy()
    parts = []
    for pid, idx in zip(places["id"], hits, strict=True):
        if not idx:
            continue
        idx = np.asarray(idx)
        g = (
            pd.DataFrame({"date": fire_dates[idx], "frp": fire_frp[idx]})
            .groupby("date")
            .agg(n=("frp", "size"), frp_sum=("frp", "sum"))
        )
        g["place_id"] = pid
        parts.append(g.reset_index())
    sparse = (
        pd.concat(parts, ignore_index=True)
        if parts
        else pd.DataFrame(columns=["date", "n", "frp_sum", "place_id"])
    )
    dense = pd.MultiIndex.from_product([places["id"], dates], names=["place_id", "date"]).to_frame(
        index=False
    )
    out = dense.merge(sparse, on=["place_id", "date"], how="left")
    out["n"] = out["n"].fillna(0).astype("int32")
    out["frp_sum"] = out["frp_sum"].fillna(0.0).astype("float64").round(2)
    out = out[["place_id", "date", "n", "frp_sum"]]
    out.to_parquet(COUNTS_PATH, index=False)
    nz = int((out["n"] > 0).sum())
    log.info(
        "counts: %d rows (%d places x %d dates), %d non-zero → %s",
        len(out),
        len(places),
        len(dates),
        nz,
        COUNTS_PATH.name,
    )
    return {
        "rows": len(out),
        "dates": len(dates),
        "nonzero": nz,
        "first": dates[0].isoformat(),
        "last": dates[-1].isoformat(),
    }


# ---- stage entry -----------------------------------------------------------


def run(places: pd.DataFrame) -> dict:
    if not config.FIRMS_MAP_KEY:
        raise RuntimeError("FIRMS_MAP_KEY missing (pipeline/.env or GitHub secret)")
    FIRMS_DIR.mkdir(parents=True, exist_ok=True)
    out = {"live": live()}
    out["history"] = history()
    out["counts"] = counts(places)
    return out
