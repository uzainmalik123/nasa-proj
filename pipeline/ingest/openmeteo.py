"""Open-Meteo 16-day daily forecast per place (PRD §7.2 step 3).

One request per place; writes ``data/cache/forecast/{run_id}.parquet`` with
``place_id, date, tmax, rain_mm, rh_min, wind_max, et0`` (contracts §4).
Wind is requested in m/s to match POWER's WS2M unit (note: Open-Meteo is 10 m
wind, POWER is 2 m). Open-Meteo is a non-NASA supplement and is labelled
"forecast" everywhere (PRD §7.4).
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
WORKERS = int(os.environ.get("OPENMETEO_WORKERS", "4"))
PACE_S = float(os.environ.get("OPENMETEO_PACE_S", "0.15"))  # free tier: 600 req/min
COLUMNS = {
    "temperature_2m_max": "tmax",
    "precipitation_sum": "rain_mm",
    "relative_humidity_2m_min": "rh_min",
    "wind_speed_10m_max": "wind_max",
    "et0_fao_evapotranspiration": "et0",
}
SCHEMA = ["place_id", "date", *COLUMNS.values()]


def fetch(place_id: str, lat: float, lon: float, pacer: Pacer) -> pd.DataFrame:
    r = get(
        config.OPENMETEO_API,
        params={
            "latitude": round(lat, 4),
            "longitude": round(lon, 4),
            "daily": config.OPENMETEO_DAILY,
            "forecast_days": config.FORECAST_DAYS,
            "wind_speed_unit": "ms",
            "timezone": "UTC",
        },
        timeout=60,
        pacer=pacer,
        label=f"open-meteo {place_id}",
    )
    daily = r.json()["daily"]
    df = pd.DataFrame({"date": pd.to_datetime(daily["time"]).date})
    for k, c in COLUMNS.items():
        df[c] = pd.Series(daily.get(k, []), dtype="float64")
    df.insert(0, "place_id", place_id)
    return df[SCHEMA]


def run(places: pd.DataFrame, run_id: str) -> dict:
    FORECAST_DIR.mkdir(parents=True, exist_ok=True)
    pacer = Pacer(PACE_S)
    parts: list[pd.DataFrame] = []
    failures: list[str] = []
    started = datetime.now(UTC)
    with ThreadPoolExecutor(max_workers=max(1, WORKERS)) as ex:
        futs = {
            ex.submit(fetch, p.id, float(p.lat), float(p.lon), pacer): p.id
            for p in places.itertuples(index=False)
        }
        for i, f in enumerate(as_completed(futs), 1):
            try:
                parts.append(f.result())
            except Exception as e:
                failures.append(futs[f])
                log.error("%s: giving up after retries: %s", futs[f], e)
            if i % 100 == 0 or i == len(futs):
                log.info(
                    "forecast %d/%d places · %.0fs · %d failed",
                    i,
                    len(futs),
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
