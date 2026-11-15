"""Open-Meteo 16-day daily forecast per place (PRD §7.2 step 3).

Places are requested in batches (comma-separated ``latitude``/``longitude``
lists, one JSON object per location in the reply). Writes
``data/cache/forecast/{run_id}.parquet`` with
``place_id, date, tmax, rain_mm, rh_min, rh_mean, wind_max, wind_mean, et0``
(contracts §4 plus the two means, see the change log there): the 16 forecast
days plus up to 92 past days of the model's own analysis, which S2 uses to
calibrate the forecast against POWER. Wind is requested in m/s to match
POWER's WS2M unit (note: Open-Meteo is 10 m wind, POWER is 2 m). Open-Meteo is
a non-NASA supplement and is labelled "forecast" everywhere (PRD §7.4).

Quota (open-meteo.com/en/pricing, per IP: 10,000 calls/day, 5,000/h,
600/min; one call = one location for 14 days, fractional beyond that):

* 2026-11-14 the per-place fetch with ``past_days=92`` cost ~7.7 calls per
  place, ~4,300 per run, and the shared GitHub runner IP was banned (429,
  Retry-After until midnight UTC) before the 10:55 run even started.
* Now only ``INCR_PAST_DAYS`` past days are fetched (~1.3 calls per place,
  ~700 per run); the older analysis rows are carried over from the previous
  parquet, so the file still spans up to 92 days before today. The 92-day
  fetch happens only when no previous file has ``MIN_HISTORY_DAYS`` of past
  rows, or, per place, when the previous file does not know the place (a new
  tier, PRD M9), also when a cached run is otherwise reused.
* A cached forecast younger than ``MIN_AGE_H`` is reused without any request
  (PRD §10: "forecast every 2nd run"); ``OPENMETEO_MIN_AGE_H=0`` fetches every run.
* A 429 ban aborts the fetch at once (``_http.RateLimited``) and the newest
  cached forecast is reused if it is within the G3 budget (12 h); otherwise
  the ingest fails and the run stays red.

The default model mix ("best_match") ends at day 15 over Europe (its tail is
ECMWF IFS, a 15-day model), so ~21 European places came back with an all-null
day 16. Places with any null forecast day are re-fetched from
``FALLBACK_MODEL`` (GFS, 16 days everywhere) and only those rows are patched.

Measured 2026-11-14: one place with ``past_days=92`` answers in ~1 s, 20
places in one request in ~0.8 s.
"""

from __future__ import annotations

import logging
import os
import re
from concurrent.futures import CancelledError, ThreadPoolExecutor, as_completed
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pandas as pd

import config
from ingest._http import Pacer, RateLimited, get

log = logging.getLogger("ingest.openmeteo")

FORECAST_DIR = config.CACHE_DIR / "forecast"
WORKERS = int(os.environ.get("OPENMETEO_WORKERS", "2"))
PACE_S = float(os.environ.get("OPENMETEO_PACE_S", "0.5"))  # free tier: 600 req/min
BATCH = int(os.environ.get("OPENMETEO_BATCH", "25"))  # places per request
# rh_mean / wind_mean are additive to contracts §4: POWER observations are
# daily means (RH2M, WS2M), so "perfect prognosis" training features are means
# and inference should feed the same statistic, not the min / max.
COLUMNS = {
    "temperature_2m_max": "tmax",
    "precipitation_sum": "rain_mm",
    "relative_humidity_2m_min": "rh_min",
    "relative_humidity_2m_mean": "rh_mean",
    "wind_speed_10m_max": "wind_max",
    "wind_speed_10m_mean": "wind_mean",
    "et0_fao_evapotranspiration": "et0",
}
DAILY = ",".join(COLUMNS)  # superset of config.OPENMETEO_DAILY
PAST_DAYS = int(os.environ.get("OPENMETEO_PAST_DAYS", "92"))  # the one-time history fetch
INCR_PAST_DAYS = int(os.environ.get("OPENMETEO_INCR_PAST_DAYS", "2"))  # every other fetch
MIN_HISTORY_DAYS = 60  # previous file must hold this many past days to go incremental
MIN_AGE_H = float(os.environ.get("OPENMETEO_MIN_AGE_H", "5.5"))  # reuse a cache younger than this
FALLBACK_MODEL = os.environ.get("OPENMETEO_FALLBACK_MODEL", "gfs_seamless")
SCHEMA = ["place_id", "date", *COLUMNS.values()]
VALUES = list(COLUMNS.values())
RUN_ID_RE = re.compile(r"^\d{8}T\d{4}Z$")


def _frame(place_id: str, daily: dict) -> pd.DataFrame:
    df = pd.DataFrame({"date": pd.to_datetime(daily["time"]).date})
    for k, c in COLUMNS.items():
        df[c] = pd.Series(daily.get(k, []), dtype="float64")
    df.insert(0, "place_id", place_id)
    return df[SCHEMA]


def fetch_batch(
    batch: list[tuple[str, float, float]],
    pacer: Pacer,
    model: str | None = None,
    past_days: int = INCR_PAST_DAYS,
) -> list[pd.DataFrame]:
    """One request for up to ``BATCH`` places; the reply is a list in request order."""
    params = {
        "latitude": ",".join(f"{lat:.4f}" for _, lat, _ in batch),
        "longitude": ",".join(f"{lon:.4f}" for _, _, lon in batch),
        "daily": DAILY,
        "forecast_days": config.FORECAST_DAYS,
        "past_days": past_days,
        "wind_speed_unit": "ms",
        "timezone": "UTC",
    }
    if model:
        params["models"] = model
    r = get(
        config.OPENMETEO_API,
        params=params,
        timeout=120,
        pacer=pacer,
        label=f"open-meteo {batch[0][0]}..{batch[-1][0]} ({len(batch)}, {model or 'best_match'})",
    )
    body = r.json()
    if isinstance(body, dict):  # a single location comes back as one object
        body = [body]
    if len(body) != len(batch):
        raise ValueError(f"open-meteo returned {len(body)} locations for {len(batch)}")
    return [_frame(pid, loc["daily"]) for (pid, _, _), loc in zip(batch, body, strict=True)]


def fetch(place_id: str, lat: float, lon: float, pacer: Pacer) -> pd.DataFrame:
    """One place (kept for probes and as the fallback when a batch fails)."""
    return fetch_batch([(place_id, lat, lon)], pacer)[0]


# ---- cache -------------------------------------------------------------------


def run_time(run_id: str) -> datetime:
    return datetime.strptime(run_id, config.RUN_ID_FORMAT).replace(tzinfo=UTC)


def newest_cached(fdir: Path = FORECAST_DIR, exclude: str | None = None) -> Path | None:
    """The newest ``{run_id}.parquet`` in the cache (other than ``exclude``)."""
    if not fdir.exists():
        return None
    files = sorted(
        p for p in fdir.glob("*.parquet") if RUN_ID_RE.match(p.stem) and p.stem != exclude
    )
    return files[-1] if files else None


def missing_forecast_rows(out: pd.DataFrame, today: date) -> pd.DataFrame:
    """Forecast rows (date ≥ today) with no value at all, as ``place_id, date``."""
    if out.empty:
        return out[["place_id", "date"]]
    fut = out[pd.to_datetime(out["date"]).dt.date >= today]
    return fut.loc[fut[VALUES].isna().all(axis=1), ["place_id", "date"]]


def merge_history(new: pd.DataFrame, prev: pd.DataFrame | None, today: date) -> pd.DataFrame:
    """``new`` rows plus the previous file's older analysis rows (all-null rows dropped)."""
    if prev is None or prev.empty or new.empty:
        return new
    # per place: a new place fetched with the full history has nothing to carry over
    first_new = pd.to_datetime(new["date"]).dt.date.groupby(new["place_id"].to_numpy()).min()
    prev = prev[prev["place_id"].isin(first_new.index)]
    floor = today - timedelta(days=PAST_DAYS)
    old_dates = pd.to_datetime(prev["date"]).dt.date.to_numpy()
    cut = prev["place_id"].map(first_new).to_numpy()
    has_value = prev[VALUES].notna().any(axis=1).to_numpy()
    keep = prev[(old_dates < cut) & (old_dates >= floor) & has_value]
    out = pd.concat([keep[SCHEMA], new[SCHEMA]], ignore_index=True)
    return out.drop_duplicates(["place_id", "date"], keep="last")


def past_coverage(prev: pd.DataFrame, today: date) -> int:
    """Distinct past days with any value in the previous file."""
    d = pd.to_datetime(prev["date"]).dt.date
    rows = prev[(d < today) & prev[VALUES].notna().any(axis=1)]
    return int(pd.to_datetime(rows["date"]).dt.date.nunique())


def fill_missing_days(
    out: pd.DataFrame, triples: list[tuple[str, float, float]], today: date, pacer: Pacer
) -> tuple[pd.DataFrame, dict]:
    """Patch all-null forecast days from ``FALLBACK_MODEL``; other rows are untouched."""
    missing = missing_forecast_rows(out, today)
    if missing.empty or not FALLBACK_MODEL:
        return out, {"places": 0, "rows": 0, "unfilled": 0}
    want = set(missing["place_id"])
    todo = [t for t in triples if t[0] in want]
    size = max(1, BATCH)
    fills: list[pd.DataFrame] = []
    for i in range(0, len(todo), size):
        batch = todo[i : i + size]
        try:
            fills.extend(fetch_batch(batch, pacer, FALLBACK_MODEL, past_days=0))
        except RateLimited as e:
            log.warning("%s fill stopped: %s", FALLBACK_MODEL, e)
            break
        except Exception as e:
            log.warning("%s fill for %d places failed: %s", FALLBACK_MODEL, len(batch), e)
    if not fills:
        return out, {"places": len(want), "rows": 0, "unfilled": len(missing)}
    fb = pd.concat(fills, ignore_index=True).set_index(["place_id", "date"])
    out = out.set_index(["place_id", "date"])
    keys = pd.MultiIndex.from_frame(missing)
    keys = keys[keys.isin(fb.index)]
    patch = fb.loc[keys, VALUES]
    patch = patch[patch.notna().any(axis=1)]
    out.loc[patch.index, VALUES] = patch.to_numpy()
    out = out.reset_index()[SCHEMA]
    left = len(missing_forecast_rows(out, today))
    log.info(
        "forecast fill: %d places had all-null days (%d rows); %s filled %d, %d left",
        len(want),
        len(missing),
        FALLBACK_MODEL,
        len(patch),
        left,
    )
    return out, {"places": len(want), "rows": len(patch), "unfilled": left}


Triple = tuple[str, float, float]


def _jobs(
    triples: list[Triple], past_days: int, known: set[str] | None
) -> tuple[list[tuple[list[Triple], int]], int]:
    """Batches of ``BATCH`` places with their ``past_days``. On an incremental
    fetch, places absent from the previous file (``known``; a new tier, PRD
    M9) get the one-time ``PAST_DAYS`` history in batches of their own."""
    size = max(1, BATCH)
    if known is None or past_days >= PAST_DAYS:
        old, new = triples, []
    else:
        old = [t for t in triples if t[0] in known]
        new = [t for t in triples if t[0] not in known]
    jobs = [(old[i : i + size], past_days) for i in range(0, len(old), size)]
    jobs += [(new[i : i + size], PAST_DAYS) for i in range(0, len(new), size)]
    return jobs, len(new)


def _fetch_batches(
    jobs: list[tuple[list[Triple], int]], pacer: Pacer, started: datetime, total: int
) -> tuple[list[pd.DataFrame], list[str], RateLimited | None]:
    """Run every (batch, past_days) job in parallel. Returns one frame per
    place fetched, the ids given up on, and the ban that stopped the rest."""
    parts: list[pd.DataFrame] = []
    failures: list[str] = []
    banned: RateLimited | None = None
    done = 0
    with ThreadPoolExecutor(max_workers=max(1, WORKERS)) as ex:
        futs = {ex.submit(fetch_batch, b, pacer, None, pdays): (b, pdays) for b, pdays in jobs}
        for f in as_completed(futs):
            batch, pdays = futs[f]
            try:
                parts.extend(f.result())
            except CancelledError:
                continue
            except RateLimited as e:
                if banned is None:
                    banned = e
                    log.error("open-meteo quota ban, stopping: %s", e)
                    for g in futs:
                        g.cancel()
                continue
            except Exception as e:
                # isolate the bad place(s): retry the batch one by one
                log.warning(
                    "batch %s..%s failed (%s); retrying singly", batch[0][0], batch[-1][0], e
                )
                for pid, lat, lon in batch:
                    try:
                        parts.append(fetch_batch([(pid, lat, lon)], pacer, None, pdays)[0])
                    except RateLimited as e1:
                        banned = banned or e1
                        break
                    except Exception as e1:
                        failures.append(pid)
                        log.error("%s: giving up after retries: %s", pid, e1)
            done += len(batch)
            log.info(
                "forecast %d/%d places · %.0fs · %d failed",
                done,
                total,
                (datetime.now(UTC) - started).total_seconds(),
                len(failures),
            )
    return parts, failures, banned


# ---- stage -------------------------------------------------------------------


def _reuse(
    path: Path, why: str, run_id: str, triples: list[tuple[str, float, float]], today: date
) -> dict:
    """Reuse a cached forecast; still patch any all-null forecast day (one cheap request)."""
    t = run_time(path.stem)
    log.warning("forecast: reusing %s (%s, retrieved %s)", path.name, why, t.strftime("%H:%MZ"))
    df = pd.read_parquet(path)
    changed = False
    # places the cached run does not know (a new tier, PRD M9): history fetch now
    have = set(df["place_id"])
    absent = [t for t in triples if t[0] not in have]
    if absent:
        jobs, _ = _jobs(absent, PAST_DAYS, None)
        parts, failed, banned = _fetch_batches(jobs, Pacer(PACE_S), datetime.now(UTC), len(absent))
        if parts:
            df = pd.concat([df[SCHEMA], *(p[SCHEMA] for p in parts)], ignore_index=True)
            changed = True
        log.info(
            "forecast: %d places absent from the cached run; fetched %d, %d failed%s",
            len(absent),
            len(parts),
            len(failed),
            f", banned: {banned}" if banned else "",
        )
    filled = {"places": 0, "rows": 0, "unfilled": 0}
    if not missing_forecast_rows(df, today).empty:
        df, filled = fill_missing_days(df, triples, today, Pacer(PACE_S))
        changed = changed or bool(filled["rows"])
    if changed:
        path = FORECAST_DIR / f"{run_id}.parquet"
        df.sort_values(["place_id", "date"]).to_parquet(path, index=False)
        log.info("forecast: cached run + additions written → %s", path.name)
    return {
        "ok": int(df["place_id"].nunique()),
        "failed": [],
        "rows": len(df),
        "path": str(path),
        "first": df["date"].min().isoformat() if len(df) else None,
        "last": df["date"].max().isoformat() if len(df) else None,
        "filled": filled,
        "reused": t.strftime(config.RUN_ID_FORMAT),
        "retrieved_at": t,
    }


def run(places: pd.DataFrame, run_id: str) -> dict:
    FORECAST_DIR.mkdir(parents=True, exist_ok=True)
    started = datetime.now(UTC)
    today = started.date()
    triples = [(p.id, float(p.lat), float(p.lon)) for p in places.itertuples(index=False)]
    prev_path = newest_cached(FORECAST_DIR, exclude=run_id)
    prev_age_h = (started - run_time(prev_path.stem)).total_seconds() / 3600 if prev_path else None
    # a file from an earlier UTC day covers one forecast day too few for today
    prev_today = prev_path is not None and run_time(prev_path.stem).date() == today
    if prev_path and prev_today and prev_age_h < MIN_AGE_H:
        why = f"{prev_age_h:.1f} h old, under OPENMETEO_MIN_AGE_H={MIN_AGE_H}"
        return _reuse(prev_path, why, run_id, triples, today)

    prev = pd.read_parquet(prev_path) if prev_path else None
    past_days = PAST_DAYS
    known: set[str] | None = None
    if prev is not None and past_coverage(prev, today) >= MIN_HISTORY_DAYS:
        past_days = INCR_PAST_DAYS
        known = set(prev["place_id"])
    pacer = Pacer(PACE_S)
    jobs, n_new = _jobs(triples, past_days, known)
    log.info(
        "forecast: %d places in %d batches · past_days %d (%d new places at %d) · previous %s",
        len(triples),
        len(jobs),
        past_days,
        n_new,
        PAST_DAYS,
        prev_path.name if prev_path else "none",
    )
    parts, failures, banned = _fetch_batches(jobs, pacer, started, len(triples))
    if banned is not None:
        if prev_path and prev_age_h <= config.G3_FORECAST_MAX_AGE_H:
            why = f"rate limited for {banned.retry_after} s"
            return _reuse(prev_path, why, run_id, triples, today)
        raise RuntimeError(
            f"open-meteo rate limited ({banned.retry_after} s) and no forecast cache within "
            f"{config.G3_FORECAST_MAX_AGE_H} h"
        )
    new = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=SCHEMA)
    out = merge_history(new, prev, today) if past_days < PAST_DAYS else new
    out, filled = fill_missing_days(out, triples, today, pacer)
    out = out.sort_values(["place_id", "date"]).reset_index(drop=True)
    path = FORECAST_DIR / f"{run_id}.parquet"
    out.to_parquet(path, index=False)
    log.info(
        "forecast done: %d places ok, %d failed, %d rows (%d carried over) → %s",
        len(parts),
        len(failures),
        len(out),
        len(out) - len(new),
        path.name,
    )
    return {
        "ok": len(parts),
        "failed": failures,
        "rows": len(out),
        "path": str(path),
        "first": out["date"].min().isoformat() if not out.empty else None,
        "last": out["date"].max().isoformat() if not out.empty else None,
        "filled": filled,
        "past_days": past_days,
        "reused": None,
        "retrieved_at": datetime.now(UTC),
    }
