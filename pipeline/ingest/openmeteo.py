"""Open-Meteo 16-day daily forecast per place (PRD §7.2 step 3).

Places are requested in batches (comma-separated ``latitude``/``longitude``
lists, one JSON object per location in the reply): 16 forecast days plus the
last 92 days of model analysis per place. Writes
``data/cache/forecast/{run_id}.parquet`` with
``place_id, date, tmax, rain_mm, rh_min, rh_mean, wind_max, wind_mean, et0``
(contracts §4 plus the two means, see the change log there).
Wind is requested in m/s to match POWER's WS2M unit (note: Open-Meteo is 10 m
wind, POWER is 2 m). Open-Meteo is a non-NASA supplement and is labelled
"forecast" everywhere (PRD §7.4).

Measured 2026-11-14: one place with ``past_days=92`` answers in ~1 s, 20
places in one request in ~0.8 s, so batching brings 554 places from ~15 min
(the G1 incremental budget) down to under a minute.
"""

from __future__ import annotations

import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime

import pandas as pd

import config
from ingest._http import Pacer, get

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
# Also pull the trailing 92 days of the model's own analysis (dates before
# today, same columns). S2 calibrates the forecast per place on the overlap
# with POWER. Rows per place: ~92 + FORECAST_DAYS. No "future only" filter.
PAST_DAYS = int(os.environ.get("OPENMETEO_PAST_DAYS", "92"))
SCHEMA = ["place_id", "date", *COLUMNS.values()]


def _frame(place_id: str, daily: dict) -> pd.DataFrame:
    df = pd.DataFrame({"date": pd.to_datetime(daily["time"]).date})
    for k, c in COLUMNS.items():
        df[c] = pd.Series(daily.get(k, []), dtype="float64")
    df.insert(0, "place_id", place_id)
    return df[SCHEMA]


def fetch_batch(batch: list[tuple[str, float, float]], pacer: Pacer) -> list[pd.DataFrame]:
    """One request for up to ``BATCH`` places; the reply is a list in request order."""
    r = get(
        config.OPENMETEO_API,
        params={
            "latitude": ",".join(f"{lat:.4f}" for _, lat, _ in batch),
            "longitude": ",".join(f"{lon:.4f}" for _, _, lon in batch),
            "daily": DAILY,
            "forecast_days": config.FORECAST_DAYS,
            "past_days": PAST_DAYS,
            "wind_speed_unit": "ms",
            "timezone": "UTC",
        },
        timeout=120,
        pacer=pacer,
        label=f"open-meteo {batch[0][0]}..{batch[-1][0]} ({len(batch)})",
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


def run(places: pd.DataFrame, run_id: str) -> dict:
    FORECAST_DIR.mkdir(parents=True, exist_ok=True)
    pacer = Pacer(PACE_S)
    parts: list[pd.DataFrame] = []
    failures: list[str] = []
    started = datetime.now(UTC)
    triples = [(p.id, float(p.lat), float(p.lon)) for p in places.itertuples(index=False)]
    size = max(1, BATCH)
    batches = [triples[i : i + size] for i in range(0, len(triples), size)]
    done = 0
    with ThreadPoolExecutor(max_workers=max(1, WORKERS)) as ex:
        futs = {ex.submit(fetch_batch, b, pacer): b for b in batches}
        for f in as_completed(futs):
            batch = futs[f]
            try:
                parts.extend(f.result())
            except Exception as e:
                # isolate the bad place(s): retry the batch one by one
                log.warning(
                    "batch %s..%s failed (%s); retrying singly", batch[0][0], batch[-1][0], e
                )
                for pid, lat, lon in batch:
                    try:
                        parts.append(fetch(pid, lat, lon, pacer))
                    except Exception as e1:
                        failures.append(pid)
                        log.error("%s: giving up after retries: %s", pid, e1)
            done += len(batch)
            log.info(
                "forecast %d/%d places · %.0fs · %d failed",
                done,
                len(triples),
                (datetime.now(UTC) - started).total_seconds(),
                len(failures),
            )
    out = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=SCHEMA)
    out = out.sort_values(["place_id", "date"]).reset_index(drop=True)
    path = FORECAST_DIR / f"{run_id}.parquet"
    out.to_parquet(path, index=False)
    log.info(
        "forecast done: %d places ok, %d failed, %d rows → %s",
        len(parts),
        len(failures),
        len(out),
        path.name,
    )
    return {
        "ok": len(parts),
        "failed": failures,
        "rows": len(out),
        "path": str(path),
        "first": out["date"].min().isoformat() if not out.empty else None,
        "last": out["date"].max().isoformat() if not out.empty else None,
        "retrieved_at": datetime.now(UTC),
    }
