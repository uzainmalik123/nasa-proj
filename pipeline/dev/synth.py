"""Synthetic S1 caches with the contract §4 schema, for developing S2 before
the real data branch exists.

    uv run python dev/synth.py            # all places in data/places.parquet
    uv run python dev/synth.py 50         # first 50 places

Writes under ``data/synth/``: ``places.parquet``, ``cache/power/{id}.parquet``
(10 years daily, latitude-driven seasonality, a mild drying/warming drift for
some places), ``cache/firms_counts.parquet`` (dense, 12 months, Poisson counts
whose rate follows the synthetic fire weather so labels carry signal) and
``cache/forecast/{run_id}.parquet`` (16 days). Nothing here is real data.
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import config

SYNTH_DIR = config.DATA_DIR / "synth"
RNG = np.random.default_rng(7)


def seasonal(doy: np.ndarray, lat: float, amp: float, phase: float = 0.0) -> np.ndarray:
    sign = 1.0 if lat >= 0 else -1.0
    return sign * amp * np.cos((doy - 200 - phase) / 365.25 * 2 * np.pi) * min(abs(lat) / 45, 1.0)


def synth_power(lat: float, lon: float, dates: pd.DatetimeIndex, drift: float) -> pd.DataFrame:
    n = len(dates)
    doy = dates.dayofyear.to_numpy()
    years = (dates - dates[0]).days.to_numpy() / 365.25
    base_t = 28 - 0.35 * abs(lat) + RNG.normal(0, 2)
    t2m = base_t + seasonal(doy, lat, 12) + RNG.normal(0, 2.5, n) + drift * years * 0.1
    tmax = t2m + 5 + RNG.normal(0, 1.5, n)
    wet = max(0.05, 1.0 - abs(abs(lat) - 10) / 40) + RNG.uniform(-0.2, 0.2)
    rain_rate = np.clip(wet * (1 + 0.8 * seasonal(doy, lat, 1, 60)), 0.02, None)
    rain_rate = rain_rate * np.clip(1 - drift * years * 0.03, 0.2, 2.0)
    rain = np.where(RNG.random(n) < np.clip(rain_rate * 0.5, 0.02, 0.9), RNG.gamma(1.2, 8, n), 0.0)
    rh = np.clip(45 + 40 * wet - 0.6 * (tmax - 25) + RNG.normal(0, 8, n), 5, 100)
    wind = np.clip(RNG.gamma(3, 1.0, n), 0.2, None)
    soil = np.clip(
        pd.Series(rain).rolling(45, min_periods=1).mean().to_numpy() / 8
        + 0.15
        + RNG.normal(0, 0.02, n),
        0.02,
        0.98,
    )
    df = pd.DataFrame(
        {
            "date": [d.date().isoformat() for d in dates],
            "t2m": t2m.round(2),
            "t2m_max": tmax.round(2),
            "rain_mm": rain.round(2),
            "rh_pct": rh.round(2),
            "wind_ms": wind.round(2),
            "soil_root": soil.round(2),
            "soil_top": np.clip(soil + RNG.normal(0, 0.03, n), 0.02, 0.98).round(2),
        }
    )
    return df


def fire_rate(power: pd.DataFrame) -> np.ndarray:
    """A Poisson rate that rises with heat, dryness and days since rain."""
    angstrom = power["rh_pct"] / 20 + (27 - power["t2m_max"]) / 10
    danger = np.clip((4 - angstrom) / 4, 0, 1)
    dry = (power["rain_mm"] < 1).astype(float)
    dsr = dry.groupby((dry == 0).cumsum()).cumsum()
    return (0.05 + 3.0 * danger**2 * np.clip(dsr / 10, 0, 1)).to_numpy()


def main(limit: int | None) -> None:
    today = datetime.now(UTC).date()
    places = pd.read_parquet(config.PLACES_PARQUET)
    if limit:
        places = places.head(limit)
    places = places.reset_index(drop=True)
    (SYNTH_DIR / "cache" / "power").mkdir(parents=True, exist_ok=True)
    (SYNTH_DIR / "cache" / "forecast").mkdir(parents=True, exist_ok=True)
    places.to_parquet(SYNTH_DIR / "places.parquet", index=False)

    power_end = today - timedelta(days=3)
    dates = pd.date_range(f"{today.year - 10}-01-01", power_end, freq="D")
    firms_start = pd.Timestamp(today - timedelta(days=365))
    firms_dates = pd.date_range(firms_start, today, freq="D")
    counts = []
    past_days = 92  # Open-Meteo ``past_days``: forecast cache overlaps POWER
    null_head = 26  # measured 2026-11-14: the API populates only ~66 of the 92 past days
    fc_dates = pd.date_range(
        today - timedelta(days=past_days), periods=past_days + config.FORECAST_DAYS, freq="D"
    )
    fc = []
    run_id = datetime.now(UTC).strftime(config.RUN_ID_FORMAT)
    for _, p in places.iterrows():
        drift = RNG.choice([0.0, 0.0, 1.0, -1.0, 2.0])
        power = synth_power(p["lat"], p["lon"], dates, drift)
        power.to_parquet(SYNTH_DIR / "cache" / "power" / f"{p['id']}.parquet", index=False)
        rate = fire_rate(power)
        rate_s = pd.Series(rate, index=dates).reindex(firms_dates).ffill()
        n = RNG.poisson(rate_s.to_numpy() * RNG.uniform(0.2, 2.0))
        counts.append(
            pd.DataFrame(
                {
                    "place_id": p["id"],
                    "date": [d.date().isoformat() for d in firms_dates],
                    "n": n.astype("int32"),
                    "frp_sum": (n * RNG.uniform(5, 40)).round(2),
                }
            )
        )
        # the "forecast": the synthetic truth plus noise, with a per-place humidity
        # bias and 10 m winds, so the per-place calibration has something to undo
        truth = power.set_index(pd.to_datetime(power["date"])).reindex(fc_dates)
        truth = truth.ffill().bfill()
        nf = len(fc_dates)
        rh_bias = RNG.choice([0.0, 0.0, 15.0, -15.0, 30.0])
        rh_true = truth["rh_pct"].to_numpy()
        fc_rows = pd.DataFrame(
            {
                "place_id": p["id"],
                "date": [d.date().isoformat() for d in fc_dates],
                "tmax": (truth["t2m_max"].to_numpy() + RNG.normal(0, 1, nf)).round(1),
                "rain_mm": np.clip(
                    truth["rain_mm"].to_numpy() + RNG.normal(0, 1, nf), 0, None
                ).round(1),
                "rh_min": np.clip(rh_true + rh_bias - 15, 3, 100).round(0),
                "rh_mean": np.clip(rh_true + rh_bias + RNG.normal(0, 3, nf), 3, 100).round(0),
                "wind_max": (truth["wind_ms"].to_numpy() * 1.8).round(2),
                "wind_mean": (truth["wind_ms"].to_numpy() / 0.75 + RNG.normal(0, 0.2, nf))
                .clip(0)
                .round(2),
                "et0": RNG.uniform(1, 6, nf).round(2),
            }
        )
        fc_rows.iloc[:null_head, 2:] = np.nan  # all-null head rows, as the API returns them
        fc.append(fc_rows)
    pd.concat(counts, ignore_index=True).to_parquet(
        SYNTH_DIR / "cache" / "firms_counts.parquet", index=False
    )
    pd.concat(fc, ignore_index=True).to_parquet(
        SYNTH_DIR / "cache" / "forecast" / f"{run_id}.parquet", index=False
    )
    print(f"synthetic caches for {len(places)} places → {SYNTH_DIR}")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else None)
