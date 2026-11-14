"""Per-place daily frames from the S1 caches (docs/contracts.md §4).

Both the trend engine and the feature builder read the same thing: one daily
frame per place with the contract's variable columns, on a continuous daily
index. POWER supplies five of the six variables; ``fires`` comes from
``firms_counts.parquet`` and is NaN outside the cached FIRMS date range.

    power  = load_power(place_id, data_dir)
    counts = load_firms_counts(data_dir)        # once, pivoted: date x place_id
    daily  = place_daily(place_id, power, counts)
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd

import config

log = logging.getLogger("trend.load")

# contract variable → POWER cache column
POWER_COLS = {
    "rain_mm": "rain_mm",
    "tmax_c": "t2m_max",
    "rh_pct": "rh_pct",
    "wind_ms": "wind_ms",
    "soil_wet": "soil_root",  # GWETROOT; root-zone wetness, 0-1
}
POWER_MISSING = -990.0  # POWER's -999 sentinel if any slipped through S1


def load_places(data_dir: Path = config.DATA_DIR) -> pd.DataFrame:
    places = pd.read_parquet(data_dir / "places.parquet")
    return places.reset_index(drop=True)


def load_power(place_id: str, data_dir: Path = config.DATA_DIR) -> pd.DataFrame | None:
    """POWER daily record for one place, reindexed to a continuous daily range."""
    path = data_dir / "cache" / "power" / f"{place_id}.parquet"
    if not path.exists():
        return None
    df = pd.read_parquet(path)
    if df.empty:
        return None
    df["date"] = pd.to_datetime(df["date"])
    df = df.drop_duplicates("date").set_index("date").sort_index()
    df = df.astype("float64")
    df = df.mask(df <= POWER_MISSING)
    full = pd.date_range(df.index.min(), df.index.max(), freq="D")
    return df.reindex(full)


def load_firms_counts(data_dir: Path = config.DATA_DIR) -> pd.DataFrame | None:
    """``firms_counts.parquet`` pivoted to date x place_id (detections per day).

    The S1 cache is dense within its date range, so a missing cell means the
    place had no row at all and is left NaN. The newest cached date is the
    partial NRT day; callers decide whether to trust it.
    """
    path = data_dir / "cache" / "firms_counts.parquet"
    if not path.exists():
        return None
    df = pd.read_parquet(path)
    if df.empty:
        return None
    df["date"] = pd.to_datetime(df["date"])
    piv = df.pivot_table(index="date", columns="place_id", values="n", aggfunc="sum")
    full = pd.date_range(piv.index.min(), piv.index.max(), freq="D")
    return piv.reindex(full).astype("float64")


def load_forecast(data_dir: Path = config.DATA_DIR) -> pd.DataFrame | None:
    """The newest forecast run (``cache/forecast/{run_id}.parquet``)."""
    fdir = data_dir / "cache" / "forecast"
    if not fdir.exists():
        return None
    files = sorted(fdir.glob("*.parquet"))
    if not files:
        return None
    df = pd.read_parquet(files[-1])
    df["date"] = pd.to_datetime(df["date"])
    df.attrs["run_id"] = files[-1].stem
    return df


def place_daily(
    place_id: str,
    power: pd.DataFrame | None,
    counts: pd.DataFrame | None,
) -> pd.DataFrame | None:
    """Daily frame with columns ``config.VARIABLES`` on a continuous daily index."""
    if power is None:
        return None
    out = pd.DataFrame(index=power.index)
    for var, col in POWER_COLS.items():
        out[var] = power[col].to_numpy() if col in power else np.nan
    fires = pd.Series(np.nan, index=power.index)
    if counts is not None and place_id in counts.columns:
        c = counts[place_id]
        idx = power.index.union(c.index)
        out = out.reindex(idx)
        fires = c.reindex(idx)
    out["fires"] = fires.to_numpy() if len(fires) == len(out) else np.nan
    return out[config.VARIABLES]
