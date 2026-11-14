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

import functools
import logging
from dataclasses import dataclass
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

# POWER serves its newest ~6 weeks from the near-real-time GEOS product and the
# rest from the final MERRA-2 reanalysis. On the day the product switches, every
# place's soil wetness, wind and humidity step at once (measured 2026-11-14:
# step on 2026-10-01, soil_root -0.05, wind -19 %, rh -2 points net of the
# climatological change for those two weeks; temperature and rain do not step).
# ``power_step`` finds that day from the cross-place mean one-day change in
# soil_root and estimates a per-place offset for each affected variable as the
# 2026 jump minus the same calendar jump averaged over the earlier years;
# ``load_power`` removes it from the days after the step. The detection runs
# fresh every run, so the correction follows the step as POWER backfills.
STEP_VARS = {"soil_root": "add", "soil_top": "add", "rh_pct": "add", "wind_ms": "mul"}
STEP_LOOKBACK_DAYS = 150
STEP_WINDOW_DAYS = 28
STEP_MIN_WINDOW_DAYS = 5
STEP_MIN_RATIO = 5.0  # vs the median cross-place mean |1-day change|
STEP_MIN_ABS = 0.02  # soil_root units
STEP_CLIP = {"soil_root": 0.3, "soil_top": 0.3, "rh_pct": 25.0, "wind_ms": (0.5, 2.0)}
STEP_SHRINK = {"rh_pct": 0.5, "wind_ms": 0.5}  # noisier variables: halfway to the global mean


@dataclass
class PowerStep:
    date: pd.Timestamp
    offsets: pd.DataFrame  # index place_id, one column per STEP_VARS entry (NaN = no correction)
    global_mean: dict[str, float]


def _window_means(piv: pd.DataFrame, step: pd.Timestamp, w: int) -> tuple[pd.Series, pd.Series]:
    before = piv.loc[step - pd.Timedelta(days=w) : step - pd.Timedelta(days=1)]
    after = piv.loc[step : step + pd.Timedelta(days=w - 1)]
    if len(before) < STEP_MIN_WINDOW_DAYS or len(after) < STEP_MIN_WINDOW_DAYS:
        return pd.Series(dtype="float64"), pd.Series(dtype="float64")
    return before.mean(), after.mean()


@functools.lru_cache(maxsize=4)
def power_step(data_dir: Path = config.DATA_DIR) -> PowerStep | None:
    pdir = data_dir / "cache" / "power"
    files = sorted(pdir.glob("*.parquet")) if pdir.exists() else []
    if len(files) < 20:
        return None
    frames = []
    for f in files:
        d = pd.read_parquet(f)
        if d.empty:
            continue
        d["date"] = pd.to_datetime(d["date"])
        d["place_id"] = f.stem
        frames.append(d)
    df = pd.concat(frames)
    cols = [c for c in STEP_VARS if c in df.columns]
    df[cols] = df[cols].astype("float64").mask(df[cols] <= POWER_MISSING)
    soil = df.pivot_table(index="date", columns="place_id", values="soil_root")
    recent = soil.loc[soil.index.max() - pd.Timedelta(days=STEP_LOOKBACK_DAYS) :]
    jump = recent.diff().abs().mean(axis=1).dropna()
    if len(jump) < 30:
        return None
    med = float(jump.median())
    step = jump.idxmax()
    if jump.max() < max(STEP_MIN_ABS, STEP_MIN_RATIO * med):
        log.info("power step · none (max mean |Δsoil_root| %.4f, median %.4f)", jump.max(), med)
        return None
    offsets = {}
    global_mean = {}
    for var in cols:
        piv = df.pivot_table(index="date", columns="place_id", values=var)
        mul = STEP_VARS[var] == "mul"
        b26, a26 = _window_means(piv, step, STEP_WINDOW_DAYS)
        if b26.empty:
            continue
        d26 = (a26 / b26) if mul else (a26 - b26)
        clim = []
        for y in range(step.year - 10, step.year):
            try:
                s_y = step.replace(year=y)
            except ValueError:
                continue
            b, a = _window_means(piv, s_y, STEP_WINDOW_DAYS)
            if not b.empty:
                clim.append((a / b) if mul else (a - b))
        if not clim:
            continue
        clim_mean = pd.concat(clim, axis=1).mean(axis=1)
        net = (d26 / clim_mean) if mul else (d26 - clim_mean)
        if var in STEP_SHRINK:
            k = STEP_SHRINK[var]
            net = (1 - k) * net + k * net.mean()
        if mul:
            lo, hi = STEP_CLIP[var]
            net = net.clip(lo, hi)
        else:
            net = net.clip(-STEP_CLIP[var], STEP_CLIP[var])
        offsets[var] = net
        global_mean[var] = float(net.mean())
    if not offsets:
        return None
    out = PowerStep(step, pd.DataFrame(offsets), global_mean)
    log.info(
        "power step · %s · mean |Δsoil_root| %.4f (median %.4f) · correcting %d places · %s",
        step.date(),
        jump.max(),
        med,
        len(out.offsets),
        ", ".join(f"{k} {v:+.3f}" for k, v in global_mean.items()),
    )
    return out


def apply_step(df: pd.DataFrame, place_id: str, step: PowerStep | None) -> pd.DataFrame:
    """Remove the per-place product-switch offset from the days at and after the step."""
    if step is None or place_id not in step.offsets.index:
        return df
    after = df.index >= step.date
    for var, kind in STEP_VARS.items():
        if var not in df.columns or var not in step.offsets.columns:
            continue
        off = step.offsets.at[place_id, var]
        if not np.isfinite(off):
            continue
        if kind == "mul":
            df.loc[after, var] = df.loc[after, var] / off
        else:
            df.loc[after, var] = df.loc[after, var] - off
    if "rh_pct" in df.columns:
        df["rh_pct"] = df["rh_pct"].clip(0, 100)
    for col in ("soil_root", "soil_top"):
        if col in df.columns:
            df[col] = df[col].clip(0, 1)
    if "wind_ms" in df.columns:
        df["wind_ms"] = df["wind_ms"].clip(lower=0)
    return df


def load_places(data_dir: Path = config.DATA_DIR) -> pd.DataFrame:
    places = pd.read_parquet(data_dir / "places.parquet")
    return places.reset_index(drop=True)


def load_power(
    place_id: str, data_dir: Path = config.DATA_DIR, correct_step: bool = True
) -> pd.DataFrame | None:
    """POWER daily record for one place, reindexed to a continuous daily range.

    With ``correct_step`` the near-real-time product switch is removed (see ``power_step``).
    """
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
    if correct_step:
        df = apply_step(df, place_id, power_step(data_dir))
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
