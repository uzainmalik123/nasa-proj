"""Feature table: one row per place per day for the last 13 months (PRD §7.2 step 5).

Columns (all float32 unless stated; NaN where not computable):

  place_id (str) · place (int, index into places) · date · lat · lon · doy_sin · doy_cos
  rain_7d rain_30d rain_90d            rolling sums ending on the row's day (mm)
  rain_anom_7d/30d/90d                 z vs the place's own climatology of that
                                       window for that calendar day (±15-day pooled)
  tmax tmax_anom_7d rh rh_anom_7d      daily value and 7-day-mean anomaly z
  soil_wet soil_anom soil_wet_change_30d
  days_since_rain                      days since the last day with ≥ RAIN_DAY_MM
  fwi_obs_7d                           mean daily fire weather index, last 7 days
  fwi_14d fwi_14d_max                  mean / max daily index over the next 14 days:
                                       observed POWER where it exists (perfect
                                       prognosis), Open-Meteo forecast beyond it,
                                       mapped into POWER units per place when the
                                       forecast cache carries past days
  future_observed_days (int)           how many of those 14 days were observed
  fires_7d fires_30d days_since_fire   FIRMS detections within RADIUS_KM
  *_trend_10y *_trend_90d              Sen's slopes from trends.json (per place)
  label_fires_14d (int) label (bool)   detections in the next HORIZON_DAYS, ≥ LABEL_MIN_DETECTIONS
  label_valid (bool)                   the whole future window is inside the FIRMS cache
  split (str)                          train | holdout (final HOLDOUT_WEEKS of valid
                                       labels) | inference (future not observed)

The daily fire weather index is Angstrom-style, 0-1, higher is more dangerous:
  I = rh/20 + (27 - tmax)/10 ; danger = clip((4 - I)/4, 0, 1)
  fwi = danger · (0.6 + 0.4·clip(wind/8, 0, 1)) · (0.4 + 0.6·clip(days_since_rain/14, 0, 1))

    uv run python -m features.build            # real caches, data/features.parquet
    uv run python -m features.build --synth    # data/synth/
"""

from __future__ import annotations

import json
import logging
import sys
import time
from datetime import UTC, date, datetime
from pathlib import Path

import numpy as np
import pandas as pd

import config
from trend import load

log = logging.getLogger("features")

ROW_MONTHS = 13
SMOOTH_DAYS = 15  # climatology pooled over ±15 calendar days
RAIN_DAY_MM = 1.0  # a "rain day" for days_since_rain
MAX_DAYS_SINCE = 365
Z_CLIP = 5.0
# Open-Meteo → POWER-like units for the forecast slots. POWER rh_pct is the daily
# mean at 2 m and wind_ms the 2 m daily mean. The forecast cache carries rh_min /
# wind_max (contracts §4) and, since S1's 2026-11-14 change, rh_mean / wind_mean.
# When the cache also carries past days (Open-Meteo ``past_days``), every place
# gets its own linear map fitted on the overlap with POWER (``calibrate``);
# these constants are the fallback. Medians across 554 places on 2026-11-14:
# rh_obs - rh_min = +18.8, wind_obs / wind_max = 0.48; 10 m → 2 m mean ≈ 0.75.
FC_RH_MIN_TO_MEAN = 19.0
FC_WIND_MAX10_TO_MEAN2 = 0.48
FC_WIND_MEAN10_TO_MEAN2 = 0.75
CALIB_MIN_DAYS = 30  # overlap days needed for a per-place fit
CALIB_SLOPE = (0.3, 2.0)  # slope clip for the per-place linear map

TREND_VARS = {
    "rain_mm": "rain",
    "tmax_c": "tmax",
    "rh_pct": "rh",
    "soil_wet": "soil",
    "fires": "fires",
}
FEATURE_COLS = [
    "rain_7d", "rain_30d", "rain_90d",
    "rain_anom_7d", "rain_anom_30d", "rain_anom_90d",
    "tmax", "tmax_anom_7d", "rh", "rh_anom_7d",
    "soil_wet", "soil_anom", "soil_wet_change_30d",
    "days_since_rain", "fwi_obs_7d", "fwi_14d", "fwi_14d_max",
    "fires_7d", "fires_30d", "days_since_fire",
    "rain_trend_10y", "tmax_trend_10y", "rh_trend_10y", "soil_trend_10y",
    "rain_trend_90d", "tmax_trend_90d", "rh_trend_90d", "soil_trend_90d", "fires_trend_90d",
    "lat", "lon", "doy_sin", "doy_cos",
]  # fmt: skip


# ---------------------------------------------------------------------------
# climatology
def climatology(series: pd.Series) -> tuple[np.ndarray, np.ndarray]:
    """(mean, sd) per day-of-year (index 1..366), pooled over ±SMOOTH_DAYS, circular."""
    s = series.dropna()
    doy = s.index.day_of_year.to_numpy()
    x = s.to_numpy(dtype="float64")
    n = np.bincount(doy, minlength=367)[1:]
    sm = np.bincount(doy, weights=x, minlength=367)[1:]
    sq = np.bincount(doy, weights=x * x, minlength=367)[1:]
    k = 2 * SMOOTH_DAYS + 1
    kernel = np.ones(k)

    def circ(a: np.ndarray) -> np.ndarray:
        padded = np.concatenate([a[-SMOOTH_DAYS:], a, a[:SMOOTH_DAYS]])
        return np.convolve(padded, kernel, mode="valid")

    n_s, sm_s, sq_s = circ(n.astype("float64")), circ(sm), circ(sq)
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = np.where(n_s > 0, sm_s / n_s, np.nan)
        var = np.where(n_s > 1, sq_s / n_s - mean * mean, np.nan)
    sd = np.sqrt(np.clip(var, 0, None))
    return np.concatenate([[np.nan], mean]), np.concatenate([[np.nan], sd])


def anomaly_z(series: pd.Series, mean: np.ndarray, sd: np.ndarray) -> pd.Series:
    doy = series.index.day_of_year.to_numpy()
    mu, sig = mean[doy], sd[doy]
    sig = np.where(np.isfinite(sig), np.maximum(sig, 1e-6), np.nan)
    z = (series.to_numpy(dtype="float64") - mu) / sig
    return pd.Series(np.clip(z, -Z_CLIP, Z_CLIP), index=series.index)


# ---------------------------------------------------------------------------
# fire weather
def days_since(flag: pd.Series, cap: int = MAX_DAYS_SINCE) -> pd.Series:
    """Days since ``flag`` was last True; NaN before the first True; capped."""
    idx = flag.index
    last = pd.Series(np.where(flag.to_numpy(), np.arange(len(idx)), np.nan), index=idx).ffill()
    out = np.arange(len(idx)) - last.to_numpy()
    return pd.Series(np.minimum(out, cap), index=idx)


def fire_weather(tmax: pd.Series, rh: pd.Series, wind: pd.Series, dsr: pd.Series) -> pd.Series:
    angstrom = rh / 20.0 + (27.0 - tmax) / 10.0
    danger = ((4.0 - angstrom) / 4.0).clip(0, 1)
    wind_f = 0.6 + 0.4 * (wind / 8.0).clip(0, 1)
    dry_f = 0.4 + 0.6 * (dsr / 14.0).clip(0, 1)
    return (danger * wind_f * dry_f).clip(0, 1)


def forecast_to_power(fc: pd.DataFrame) -> pd.DataFrame:
    """Forecast rows (date index) in POWER-like columns, uncalibrated."""
    rh = fc["rh_mean"] if "rh_mean" in fc else pd.Series(np.nan, index=fc.index)
    rh = rh.fillna((fc["rh_min"] + FC_RH_MIN_TO_MEAN).clip(upper=100))
    if "wind_mean" in fc:
        wind = (fc["wind_mean"] * FC_WIND_MEAN10_TO_MEAN2).fillna(
            fc["wind_max"] * FC_WIND_MAX10_TO_MEAN2
        )
    else:
        wind = fc["wind_max"] * FC_WIND_MAX10_TO_MEAN2
    return pd.DataFrame(
        {
            "rain_mm": fc["rain_mm"],
            "tmax_c": fc["tmax"],
            "rh_pct": rh.clip(0, 100),
            "wind_ms": wind.clip(lower=0),
            "soil_wet": np.nan,
        }
    )


def calibrate(fc_path: pd.DataFrame, obs: pd.DataFrame) -> tuple[pd.DataFrame, bool]:
    """Map forecast tmax / rh / wind into POWER units with a per-place linear fit.

    Fitted on dates both frames cover (Open-Meteo past days vs observed POWER),
    applied to every forecast row. Returns (mapped frame, whether a fit was used).
    """
    both = fc_path.index.intersection(obs.index)
    if len(both) < CALIB_MIN_DAYS:
        return fc_path, False
    out = fc_path.copy()
    for col in ("tmax_c", "rh_pct", "wind_ms"):
        x = fc_path.loc[both, col].to_numpy(dtype="float64")
        y = obs.loc[both, col].to_numpy(dtype="float64")
        ok = np.isfinite(x) & np.isfinite(y)
        if ok.sum() < CALIB_MIN_DAYS or np.ptp(x[ok]) < 1e-6:
            continue
        b, a = np.polyfit(x[ok], y[ok], 1)
        b = float(np.clip(b, *CALIB_SLOPE))
        a = float(y[ok].mean() - b * x[ok].mean())
        out[col] = a + b * fc_path[col]
    out["rh_pct"] = out["rh_pct"].clip(0, 100)
    out["wind_ms"] = out["wind_ms"].clip(lower=0)
    return out, True


def weather_path(
    daily: pd.DataFrame, forecast: pd.DataFrame | None, today: date
) -> tuple[pd.DataFrame, pd.Timestamp | None, bool]:
    """Observed POWER, then the forecast (calibrated per place when past days overlap).

    Returns (path, last observed POWER day, calibrated). Days after the last
    POWER day that the forecast does not cover carry the last observed
    tmax/rh/wind/soil and the climatological mean daily rain.
    """
    obs = daily[["rain_mm", "tmax_c", "rh_pct", "wind_ms", "soil_wet"]].copy()
    last_obs = obs["tmax_c"].last_valid_index()
    end = pd.Timestamp(today) + pd.Timedelta(days=config.FORECAST_DAYS)
    calibrated = False
    if forecast is not None and not forecast.empty:
        fc_path = forecast_to_power(forecast.set_index("date").sort_index())
        fc_path, calibrated = calibrate(fc_path, obs.dropna(subset=["tmax_c"]))
        if last_obs is not None:
            fc_path = fc_path[fc_path.index > last_obs]
        obs = pd.concat([obs[obs.index <= (last_obs or obs.index[-1])], fc_path])
    full = pd.date_range(obs.index.min(), max(obs.index.max(), end), freq="D")
    path = obs.reindex(full)
    rain_mean, _ = climatology(daily["rain_mm"])
    gap = path["tmax_c"].isna() & (path.index > (last_obs or path.index[0]))
    for col in ("tmax_c", "rh_pct", "wind_ms", "soil_wet"):
        path[col] = path[col].ffill(limit=max(1, config.G3_POWER_MAX_AGE_D + 1))
    path.loc[gap, "rain_mm"] = rain_mean[path.index[gap].day_of_year]
    return path, last_obs, calibrated


# ---------------------------------------------------------------------------
# one place
def place_features(
    place: pd.Series,
    daily: pd.DataFrame,
    forecast: pd.DataFrame | None,
    rows: pd.DatetimeIndex,
    today: date,
    firms_range: tuple[pd.Timestamp, pd.Timestamp] | None,
    trend_slopes: dict[str, float | None],
) -> pd.DataFrame:
    path, last_obs, calibrated = weather_path(daily, forecast, today)
    # backward-looking windows run on the gap-filled path (observed POWER plus
    # ≤ POWER-lag days carried forward) so the newest rows are not NaN; the
    # climatology they are compared with comes from the observed record only.
    obs = path[path.index <= pd.Timestamp(today)]
    rain = daily["rain_mm"]
    out = pd.DataFrame(index=rows)
    for w in (7, 30, 90):
        clim = climatology(rain.rolling(w, min_periods=int(w * 0.8)).sum())
        s = obs["rain_mm"].rolling(w, min_periods=int(w * 0.8)).sum()
        out[f"rain_{w}d"] = s.reindex(rows)
        out[f"rain_anom_{w}d"] = anomaly_z(s, *clim).reindex(rows)
    tmax7 = obs["tmax_c"].rolling(7, min_periods=5).mean()
    rh7 = obs["rh_pct"].rolling(7, min_periods=5).mean()
    out["tmax"] = obs["tmax_c"].reindex(rows)
    clim = climatology(daily["tmax_c"].rolling(7, min_periods=5).mean())
    out["tmax_anom_7d"] = anomaly_z(tmax7, *clim).reindex(rows)
    out["rh"] = obs["rh_pct"].reindex(rows)
    clim = climatology(daily["rh_pct"].rolling(7, min_periods=5).mean())
    out["rh_anom_7d"] = anomaly_z(rh7, *clim).reindex(rows)
    out["soil_wet"] = obs["soil_wet"].reindex(rows)
    out["soil_anom"] = anomaly_z(obs["soil_wet"], *climatology(daily["soil_wet"])).reindex(rows)
    out["soil_wet_change_30d"] = (obs["soil_wet"] - obs["soil_wet"].shift(30)).reindex(rows)
    # fire weather along the observed+forecast path
    dsr = days_since(path["rain_mm"] >= RAIN_DAY_MM)
    fwi = fire_weather(path["tmax_c"], path["rh_pct"], path["wind_ms"], dsr)
    out["days_since_rain"] = dsr.reindex(rows)
    out["fwi_obs_7d"] = fwi.rolling(7, min_periods=4).mean().reindex(rows)
    h = config.HORIZON_DAYS
    fwd_mean = fwi[::-1].rolling(h, min_periods=h).mean()[::-1].shift(-1)
    fwd_max = fwi[::-1].rolling(h, min_periods=h).max()[::-1].shift(-1)
    out["fwi_14d"] = fwd_mean.reindex(rows)
    out["fwi_14d_max"] = fwd_max.reindex(rows)
    if last_obs is not None:
        out["future_observed_days"] = np.clip((last_obs - rows).days, 0, h)
    else:
        out["future_observed_days"] = 0
    # fires
    fires = daily["fires"]
    out["fires_7d"] = fires.rolling(7, min_periods=7).sum().reindex(rows)
    out["fires_30d"] = fires.rolling(30, min_periods=30).sum().reindex(rows)
    out["days_since_fire"] = days_since(fires.fillna(0) > 0).where(fires.notna()).reindex(rows)
    # labels: detections in d+1..d+h, valid only when that window is fully cached
    fut = fires[::-1].rolling(h, min_periods=h).sum()[::-1].shift(-1)
    out["label_fires_14d"] = fut.reindex(rows)
    if firms_range is not None:
        first, last = firms_range
        valid = (rows + pd.Timedelta(days=1) >= first) & (rows + pd.Timedelta(days=h) <= last)
        out["label_valid"] = valid & out["label_fires_14d"].notna().to_numpy()
    else:
        out["label_valid"] = False
    out["label"] = out["label_valid"] & (out["label_fires_14d"] >= config.LABEL_MIN_DETECTIONS)
    # trends, static per place
    for col, val in trend_slopes.items():
        out[col] = np.nan if val is None else float(val)
    out["lat"] = float(place["lat"])
    out["lon"] = float(place["lon"])
    doy = rows.day_of_year.to_numpy() / 365.25 * 2 * np.pi
    out["doy_sin"] = np.sin(doy)
    out["doy_cos"] = np.cos(doy)
    out.insert(0, "place_id", str(place["id"]))
    out.attrs["calibrated"] = calibrated
    return out


def trend_slopes_for(trends: dict | None, i: int) -> dict[str, float | None]:
    out: dict[str, float | None] = {}
    vars_ = config.VARIABLES
    for var, short in TREND_VARS.items():
        j = vars_.index(var)
        if var != "fires":
            out[f"{short}_trend_10y"] = trends["long"]["slope"][i][j] if trends else None
        out[f"{short}_trend_90d"] = trends["short"]["slope"][i][j] if trends else None
    return out


# ---------------------------------------------------------------------------
# all places
def build(
    places: pd.DataFrame,
    data_dir: Path = config.DATA_DIR,
    trends: dict | None = None,
    today: date | None = None,
) -> pd.DataFrame:
    today = today or datetime.now(UTC).date()
    if trends is None:
        tpath = data_dir / "out" / "trends.json"
        if tpath.exists():
            trends = json.loads(tpath.read_text())
            log.info("trend slopes from %s", tpath)
        else:
            log.warning("no trends.json; trend slope features will be NaN")
    counts = load.load_firms_counts(data_dir)
    firms_range = None
    if counts is not None:
        # the newest cached day is today's partial NRT pull; labels stop the day before
        last = counts.index.max()
        if last.date() >= today:
            last = pd.Timestamp(today) - pd.Timedelta(days=1)
        firms_range = (counts.index.min(), last)
        log.info("firms counts %s → %s (label window)", firms_range[0].date(), last.date())
    forecast_all = load.load_forecast(data_dir)
    if forecast_all is not None:
        log.info("forecast run %s · %d rows", forecast_all.attrs.get("run_id"), len(forecast_all))
    start = pd.Timestamp(today) - pd.DateOffset(months=ROW_MONTHS)
    rows = pd.date_range(start, pd.Timestamp(today), freq="D")
    frames = []
    missing = 0
    n_calib = 0
    t0 = time.perf_counter()
    for i, place in places.iterrows():
        pid = str(place["id"])
        power = load.load_power(pid, data_dir)
        daily = load.place_daily(pid, power, counts)
        if daily is None:
            missing += 1
            continue
        fc = None
        if forecast_all is not None:
            fc = forecast_all[forecast_all["place_id"] == pid]
            fc = fc.dropna(subset=["tmax"]) if not fc.empty else None
        f = place_features(place, daily, fc, rows, today, firms_range, trend_slopes_for(trends, i))
        f.insert(1, "place", int(i))
        n_calib += int(f.attrs.get("calibrated", False))
        frames.append(f)
        if (i + 1) % 100 == 0:
            log.info("features %d/%d · %.1fs", i + 1, len(places), time.perf_counter() - t0)
    if not frames:
        raise RuntimeError("no place had a POWER cache; nothing to build")
    df = pd.concat(frames)
    df.index.name = "date"
    df = df.reset_index()
    # split: holdout = final HOLDOUT_WEEKS of valid labels, inference = future unobserved
    df["split"] = "inference"
    valid = df["label_valid"].to_numpy()
    if valid.any():
        last_valid = df.loc[valid, "date"].max()
        cut = last_valid - pd.Timedelta(weeks=config.HOLDOUT_WEEKS)
        df.loc[valid & (df["date"] > cut).to_numpy(), "split"] = "holdout"
        df.loc[valid & (df["date"] <= cut).to_numpy(), "split"] = "train"
    for col in [*FEATURE_COLS, "label_fires_14d"]:
        df[col] = df[col].astype("float32")
    df["future_observed_days"] = df["future_observed_days"].astype("int16")
    df["label"] = df["label"].astype(bool)
    df["label_valid"] = df["label_valid"].astype(bool)
    df["place"] = df["place"].astype("int32")
    df["date"] = df["date"].dt.date.astype(str)
    log.info(
        "features done · %d rows · %d places (%d without POWER) · forecast calibrated per "
        "place for %d · %.1fs",
        len(df),
        len(frames),
        missing,
        n_calib,
        time.perf_counter() - t0,
    )
    return df


def summary(df: pd.DataFrame) -> str:
    valid = df[df["label_valid"]]
    lines = [
        f"rows {len(df)} · places {df['place_id'].nunique()} "
        f"· dates {df['date'].min()} → {df['date'].max()}",
        f"columns ({len(df.columns)}): {', '.join(df.columns)}",
        f"label_valid rows {len(valid)} · label rate {valid['label'].mean():.4f}"
        if len(valid)
        else "label_valid rows 0",
        f"split counts {df['split'].value_counts().to_dict()}",
    ]
    for split in ("train", "holdout"):
        sub = df[df["split"] == split]
        if len(sub):
            lines.append(f"  {split:8} {len(sub):7d} rows · label rate {sub['label'].mean():.4f}")
    nan = df[FEATURE_COLS].isna().mean().sort_values(ascending=False)
    lines.append("nan share (top): " + ", ".join(f"{k} {v:.2f}" for k, v in nan.head(6).items()))
    return "\n".join(lines)


def main(argv: list[str]) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s: %(message)s")
    synth = "--synth" in argv
    data_dir = config.DATA_DIR / "synth" if synth else config.DATA_DIR
    places = load.load_places(data_dir)
    t0 = time.perf_counter()
    df = build(places, data_dir)
    out = data_dir / "features.parquet" if synth else config.FEATURES_PARQUET
    df.to_parquet(out, index=False)
    mb = out.stat().st_size / 1e6
    print(f"features stage: {time.perf_counter() - t0:.1f}s → {out} ({mb:.1f} MB)")
    print(summary(df))


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    main(sys.argv[1:])
