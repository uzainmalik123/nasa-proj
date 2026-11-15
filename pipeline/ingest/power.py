"""NASA POWER daily observations per place (PRD §7.2 step 2).

One parquet per place at ``data/cache/power/{place_id}.parquet`` with the
columns from contracts §4: ``date, t2m, t2m_max, rain_mm, rh_pct, wind_ms,
soil_root, soil_top``. First run fetches from 2016-01-01; later runs re-fetch
from a week before the last cached date so late-filled days (POWER lags ~3
days and back-fills) get overwritten. ``-999`` becomes null.

Requests are paced at ``POWER_PACE_S`` across ``POWER_WORKERS`` threads and
retried three times with backoff on 429/5xx. Tier places (PRD M9, ``tier ==
"pk"``) are refreshed every ``POWER_TIER_REFRESH_H`` hours only (``is_due``),
which keeps the incremental run inside the G1 budget.
"""

from __future__ import annotations

import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, date, datetime, timedelta

import pandas as pd

import config
from ingest._http import Pacer, get

log = logging.getLogger("ingest.power")

POWER_DIR = config.CACHE_DIR / "power"
FIRST_START = date(2016, 1, 1)
REFETCH_DAYS = 7
WORKERS = int(os.environ.get("POWER_WORKERS", "2"))
COLUMNS = {
    "T2M": "t2m",
    "T2M_MAX": "t2m_max",
    "PRECTOTCORR": "rain_mm",
    "RH2M": "rh_pct",
    "WS2M": "wind_ms",
    "GWETROOT": "soil_root",
    "GWETTOP": "soil_top",
}
SCHEMA = ["date", *COLUMNS.values()]


def cache_path(place_id: str):
    return POWER_DIR / f"{place_id}.parquet"


def read_cache(place_id: str) -> pd.DataFrame | None:
    p = cache_path(place_id)
    if not p.exists():
        return None
    try:
        return pd.read_parquet(p)
    except Exception as e:  # corrupt file: refetch from scratch
        log.warning("%s: unreadable cache (%s); refetching", place_id, e)
        return None


def parse(payload: dict) -> pd.DataFrame:
    params = payload["properties"]["parameter"]
    frame = pd.DataFrame({COLUMNS[k]: pd.Series(v, dtype="float64") for k, v in params.items()})
    frame.index.name = "date"
    frame = frame.reset_index()
    frame["date"] = pd.to_datetime(frame["date"], format="%Y%m%d").dt.date
    for c in COLUMNS.values():
        if c not in frame:
            frame[c] = pd.NA
    frame[list(COLUMNS.values())] = frame[list(COLUMNS.values())].mask(
        frame[list(COLUMNS.values())] <= -999
    )
    return frame[SCHEMA]


def fetch(lat: float, lon: float, start: date, end: date, pacer: Pacer, label: str) -> pd.DataFrame:
    r = get(
        config.POWER_API,
        params={
            "parameters": config.POWER_PARAMS,
            "community": config.POWER_COMMUNITY,
            "longitude": round(lon, 4),
            "latitude": round(lat, 4),
            "start": start.strftime("%Y%m%d"),
            "end": end.strftime("%Y%m%d"),
            "format": "JSON",
        },
        timeout=180,
        pacer=pacer,
        label=f"power {label}",
    )
    return parse(r.json())


def is_due(tier, cached: pd.DataFrame | None, today: date, hour: int) -> bool:
    """Global places (``tier`` null) every run. A tier place (PRD M9 ``"pk"``)
    only on runs whose UTC hour divides by ``POWER_TIER_REFRESH_H`` (every 2nd
    cron run, PRD §13.2's refresh pattern), unless it has no cache or its
    newest day would fail G2 (POWER through ``G3_POWER_MAX_AGE_D`` days ago).
    """
    if tier is None or pd.isna(tier):
        return True
    if cached is None or cached.empty:
        return True
    if hour % config.POWER_TIER_REFRESH_H == 0:
        return True
    newest = pd.Timestamp(cached["date"].max()).date()
    return (today - newest).days > config.G3_POWER_MAX_AGE_D


def update_place(
    place_id: str,
    lat: float,
    lon: float,
    today: date,
    pacer: Pacer,
    tier=None,
    hour: int = 0,
) -> dict:
    cached = read_cache(place_id)
    if not is_due(tier, cached, today, hour):
        assert cached is not None
        newest = cached["date"].max()
        return {"place_id": place_id, "rows": len(cached), "newest": newest, "fetched": 0}
    if cached is None or cached.empty:
        start = FIRST_START
        cached = pd.DataFrame(columns=SCHEMA)
    else:
        last = cached["date"].max()
        start = max(FIRST_START, last - timedelta(days=REFETCH_DAYS))
        if start > today:
            start = today
    fresh = fetch(lat, lon, start, today, pacer, place_id)
    # drop the trailing all-null tail (POWER's lag) so "last cached date" means data
    has_data = fresh[list(COLUMNS.values())].notna().any(axis=1)
    fresh = fresh[has_data]
    merged = pd.concat([cached[cached["date"] < start], fresh], ignore_index=True)
    merged = merged.sort_values("date").drop_duplicates("date", keep="last").reset_index(drop=True)
    merged.to_parquet(cache_path(place_id), index=False)
    newest = merged["date"].max() if not merged.empty else None
    return {"place_id": place_id, "rows": len(merged), "newest": newest, "fetched": len(fresh)}


def run(places: pd.DataFrame, pace_s: float = config.POWER_PACE_S) -> dict:
    """Update every place's cache. Returns a summary dict for freshness.json."""
    POWER_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now(UTC)
    today, hour = now.date(), now.hour
    pacer = Pacer(pace_s)
    results: list[dict] = []
    failures: list[str] = []
    started = datetime.now(UTC)
    with ThreadPoolExecutor(max_workers=max(1, WORKERS)) as ex:
        futs = {
            ex.submit(
                update_place,
                p.id,
                float(p.lat),
                float(p.lon),
                today,
                pacer,
                getattr(p, "tier", None),
                hour,
            ): p.id
            for p in places.itertuples(index=False)
        }
        for i, f in enumerate(as_completed(futs), 1):
            pid = futs[f]
            try:
                results.append(f.result())
            except Exception as e:
                failures.append(pid)
                log.error("%s: giving up after retries: %s", pid, e)
            if i % 50 == 0 or i == len(futs):
                el = (datetime.now(UTC) - started).total_seconds()
                log.info("power %d/%d places · %.0fs · %d failed", i, len(futs), el, len(failures))
    newest = max((r["newest"] for r in results if r["newest"] is not None), default=None)
    total_rows = sum(r["rows"] for r in results)
    skipped = sum(1 for r in results if r["fetched"] == 0)
    log.info(
        "power done: %d ok (%d tier places not due, cache kept), %d failed, %d rows, newest %s",
        len(results),
        skipped,
        len(failures),
        total_rows,
        newest,
    )
    return {
        "ok": len(results),
        "failed": failures,
        "rows": total_rows,
        "newest": newest.isoformat() if newest else None,
        "retrieved_at": datetime.now(UTC),
    }
