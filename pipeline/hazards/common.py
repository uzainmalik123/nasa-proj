"""Per-place inputs shared by the threshold hazards and the writers.

One pass over the places loads the POWER record and the forecast path once
(the same ``weather_path`` the feature builder uses) and computes everything
that is not already a column of ``features.parquet``:

  * the place's own thresholds: tmax 95th / 99th percentile over the whole
    record, seasonal (±30 calendar days) 95th percentile of the wettest 3- and
    7-day total inside a 14-day window
  * forecast arrays for the next 16 days (tmax, rain, rh, fire weather index)
  * per-day hindcast inputs over the 90-day history: days above the heat
    threshold and wettest-week totals in the following 14 days
  * climatological normal / sd for series.json (rain_30d, tmax, soil_wet)
  * data completeness for the confidence levels

Everything is plain numpy so the hazard modules stay small and testable.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

import config
from features import build
from trend import load

log = logging.getLogger("hazards.common")

SEASON_HALF_DAYS = 30  # pooled window for the seasonal rain percentiles
SEASON_MIN_N = 60
WET_Q = 95.0
HEAT_Q = (95.0, 99.0)
ANCHOR_STEP = 15  # seasonal percentiles are evaluated every 15 history days and interpolated


@dataclass
class PlaceInputs:
    idx: int
    place_id: str
    name: str
    pop: int
    radius_km: int = config.RADIUS_KM  # 30 for the Pakistan tier (PRD M9)
    has_power: bool = False
    has_forecast: bool = False
    last_obs: date | None = None
    completeness: float = 0.0  # valid share of tmax/rain/soil over the history window
    tmax_p95: float = np.nan
    tmax_p99: float = np.nan
    rain7_q95: float = np.nan  # today's seasonal 95th pct of the wettest 7 days in 14
    rain3_q95: float = np.nan
    rain30_norm: float = np.nan  # climatological 30- / 90-day totals for today
    rain90_norm: float = np.nan
    # next 16 days from today (forecast_days)
    fc_tmax: np.ndarray = field(default_factory=lambda: np.full(config.FORECAST_DAYS, np.nan))
    fc_rain: np.ndarray = field(default_factory=lambda: np.full(config.FORECAST_DAYS, np.nan))
    fc_rh: np.ndarray = field(default_factory=lambda: np.full(config.FORECAST_DAYS, np.nan))
    fc_fwi: np.ndarray = field(default_factory=lambda: np.full(config.FORECAST_DAYS, np.nan))
    # next 14 days (d+1 .. d+14) for today
    next_tmax: np.ndarray = field(default_factory=lambda: np.full(config.HORIZON_DAYS, np.nan))
    next_rain: np.ndarray = field(default_factory=lambda: np.full(config.HORIZON_DAYS, np.nan))
    next_rh: np.ndarray = field(default_factory=lambda: np.full(config.HORIZON_DAYS, np.nan))
    # per history day (90 values, today-90 .. today-1)
    hist_days_above: np.ndarray = field(
        default_factory=lambda: np.full(config.HISTORY_DAYS, np.nan)
    )
    hist_peak_above: np.ndarray = field(
        default_factory=lambda: np.full(config.HISTORY_DAYS, np.nan)
    )
    hist_wet7: np.ndarray = field(default_factory=lambda: np.full(config.HISTORY_DAYS, np.nan))
    hist_rain7_q95: np.ndarray = field(default_factory=lambda: np.full(config.HISTORY_DAYS, np.nan))
    # series.json normals (90 values)
    rain30_norm_hist: np.ndarray = field(
        default_factory=lambda: np.full(config.HISTORY_DAYS, np.nan)
    )
    rain30_sd_hist: np.ndarray = field(default_factory=lambda: np.full(config.HISTORY_DAYS, np.nan))
    tmax_norm_hist: np.ndarray = field(default_factory=lambda: np.full(config.HISTORY_DAYS, np.nan))
    tmax_sd_hist: np.ndarray = field(default_factory=lambda: np.full(config.HISTORY_DAYS, np.nan))
    soil_norm_hist: np.ndarray = field(default_factory=lambda: np.full(config.HISTORY_DAYS, np.nan))
    soil_sd_hist: np.ndarray = field(default_factory=lambda: np.full(config.HISTORY_DAYS, np.nan))


def history_days(today: date) -> list[date]:
    n = config.HISTORY_DAYS
    return [today - timedelta(days=n - i) for i in range(n)]


def forecast_days(today: date) -> list[date]:
    return [today + timedelta(days=i) for i in range(config.FORECAST_DAYS)]


def forward_window(x: np.ndarray, h: int, fn) -> np.ndarray:
    """fn over x[i+1 .. i+h] for every i; NaN where the window runs off the end."""
    out = np.full(len(x), np.nan)
    for i in range(len(x) - h):
        out[i] = fn(x[i + 1 : i + 1 + h])
    return out


def wettest(window: np.ndarray, k: int) -> float:
    """Largest k-day total inside the window (NaN if any day is missing)."""
    if np.isnan(window).any() or len(window) < k:
        return np.nan
    c = np.concatenate([[0.0], np.cumsum(window)])
    return float(np.max(c[k:] - c[:-k]))


def seasonal_percentile(values: pd.Series, doys: np.ndarray, q: float) -> np.ndarray:
    """q-th percentile of ``values`` pooled over ±SEASON_HALF_DAYS around each doy."""
    s = values.dropna()
    d = s.index.day_of_year.to_numpy()
    x = s.to_numpy(dtype="float64")
    out = np.full(len(doys), np.nan)
    for k, doy in enumerate(doys):
        diff = np.abs((d - doy + 183) % 366 - 183)
        sel = diff <= SEASON_HALF_DAYS
        if sel.sum() >= SEASON_MIN_N:
            out[k] = np.percentile(x[sel], q)
    return out


def _interp_anchors(series: pd.Series, dates: pd.DatetimeIndex, q: float) -> np.ndarray:
    """Seasonal percentile on every date, evaluated at anchors and interpolated."""
    pos = np.arange(len(dates))
    anchors = np.unique(np.concatenate([pos[::ANCHOR_STEP], [pos[-1]]]))
    vals = seasonal_percentile(series, dates[anchors].day_of_year.to_numpy(), q)
    ok = np.isfinite(vals)
    if ok.sum() == 0:
        return np.full(len(dates), np.nan)
    return np.interp(pos, anchors[ok], vals[ok])


def place_inputs(
    i: int,
    place: pd.Series,
    daily: pd.DataFrame | None,
    forecast: pd.DataFrame | None,
    today: date,
) -> PlaceInputs:
    pi = PlaceInputs(
        idx=i,
        place_id=str(place["id"]),
        name=str(place["name"]),
        pop=int(place["pop"]),
        radius_km=int(place.get("radius_km", config.RADIUS_KM)),
    )
    if daily is None:
        return pi
    pi.has_power = True
    pi.has_forecast = forecast is not None and not forecast.empty
    path, last_obs, _ = build.weather_path(daily, forecast, today)
    pi.last_obs = None if last_obs is None else last_obs.date()
    h = config.HORIZON_DAYS
    hist = pd.DatetimeIndex(history_days(today))
    t_today = pd.Timestamp(today)

    # completeness over the history window, ignoring the POWER lag at the end
    obs_end = min(t_today - pd.Timedelta(days=config.G3_POWER_MAX_AGE_D), hist[-1])
    win = daily.loc[hist[0] : obs_end, ["tmax_c", "rain_mm", "soil_wet"]]
    pi.completeness = float(win.notna().to_numpy().mean()) if len(win) else 0.0

    # thresholds from the place's own record
    tmax_rec = daily["tmax_c"].dropna()
    if len(tmax_rec) >= 365:
        pi.tmax_p95, pi.tmax_p99 = (float(np.percentile(tmax_rec, q)) for q in HEAT_Q)
    rain_rec = daily["rain_mm"]
    wet7_rec = pd.Series(
        forward_window(rain_rec.to_numpy(dtype="float64"), h, lambda w: wettest(w, 7)),
        index=rain_rec.index,
    )
    wet3_rec = pd.Series(
        forward_window(rain_rec.to_numpy(dtype="float64"), h, lambda w: wettest(w, 3)),
        index=rain_rec.index,
    )
    doy_today = np.array([t_today.day_of_year])
    pi.rain7_q95 = float(seasonal_percentile(wet7_rec, doy_today, WET_Q)[0])
    pi.rain3_q95 = float(seasonal_percentile(wet3_rec, doy_today, WET_Q)[0])
    pi.hist_rain7_q95 = _interp_anchors(wet7_rec, hist, WET_Q)
    for w, attr in ((30, "rain30_norm"), (90, "rain90_norm")):
        mean, _ = build.climatology(rain_rec.rolling(w, min_periods=int(w * 0.8)).sum())
        setattr(pi, attr, float(mean[t_today.day_of_year]))

    # forecast path arrays
    fdays = pd.DatetimeIndex(forecast_days(today))
    fc = path.reindex(fdays)
    dsr = build.days_since(path["rain_mm"] >= build.RAIN_DAY_MM)
    fwi = build.fire_weather(path["tmax_c"], path["rh_pct"], path["wind_ms"], dsr)
    pi.fc_tmax = fc["tmax_c"].to_numpy(dtype="float64")
    pi.fc_rain = fc["rain_mm"].to_numpy(dtype="float64")
    pi.fc_rh = fc["rh_pct"].to_numpy(dtype="float64")
    pi.fc_fwi = fwi.reindex(fdays).to_numpy(dtype="float64")
    nxt = pd.date_range(t_today + pd.Timedelta(days=1), periods=h, freq="D")
    pi.next_tmax = path["tmax_c"].reindex(nxt).to_numpy(dtype="float64")
    pi.next_rain = path["rain_mm"].reindex(nxt).to_numpy(dtype="float64")
    pi.next_rh = path["rh_pct"].reindex(nxt).to_numpy(dtype="float64")

    # hindcast inputs over the history window (observed future where it exists)
    span = pd.date_range(hist[0], t_today + pd.Timedelta(days=h), freq="D")
    p_tmax = path["tmax_c"].reindex(span).to_numpy(dtype="float64")
    p_rain = path["rain_mm"].reindex(span).to_numpy(dtype="float64")
    n = len(hist)
    if np.isfinite(pi.tmax_p95):
        above = forward_window(p_tmax, h, lambda w: float(np.nansum(w >= pi.tmax_p95)))
        peak = forward_window(p_tmax, h, lambda w: float(np.nanmax(w) - pi.tmax_p95))
        pi.hist_days_above = above[:n]
        pi.hist_peak_above = peak[:n]
    pi.hist_wet7 = forward_window(p_rain, h, lambda w: wettest(w, 7))[:n]

    # series.json normals
    doy = hist.day_of_year.to_numpy()
    mean, sd = build.climatology(rain_rec.rolling(30, min_periods=24).sum())
    pi.rain30_norm_hist, pi.rain30_sd_hist = mean[doy], sd[doy]
    mean, sd = build.climatology(daily["tmax_c"])
    pi.tmax_norm_hist, pi.tmax_sd_hist = mean[doy], sd[doy]
    mean, sd = build.climatology(daily["soil_wet"])
    pi.soil_norm_hist, pi.soil_sd_hist = mean[doy], sd[doy]
    return pi


def load_all(
    places: pd.DataFrame, data_dir: Path = config.DATA_DIR, today: date | None = None
) -> list[PlaceInputs]:
    today = today or date.today()
    counts = load.load_firms_counts(data_dir)
    forecast_all = load.load_forecast(data_dir)
    out: list[PlaceInputs] = []
    t0 = time.perf_counter()
    for i, place in places.iterrows():
        pid = str(place["id"])
        daily = load.place_daily(pid, load.load_power(pid, data_dir), counts)
        fc = None
        if forecast_all is not None:
            fc = forecast_all[forecast_all["place_id"] == pid]
            fc = fc.dropna(subset=["tmax"]) if not fc.empty else None
        out.append(place_inputs(int(i), place, daily, fc, today))
        if (i + 1) % 100 == 0:
            log.info("place inputs %d/%d · %.1fs", i + 1, len(places), time.perf_counter() - t0)
    n_power = sum(p.has_power for p in out)
    n_fc = sum(p.has_forecast for p in out)
    log.info(
        "place inputs · %d places · %d with POWER · %d with forecast · %.1fs",
        len(out),
        n_power,
        n_fc,
        time.perf_counter() - t0,
    )
    return out


# ---------------------------------------------------------------------------
# shared helpers for the hazard modules
def category(hazard: str, value: float | None) -> str:
    """Category from config.CATEGORY_THRESHOLDS; drought descends (more negative = worse)."""
    if value is None or not np.isfinite(value):
        return "low"
    th = config.CATEGORY_THRESHOLDS[hazard]
    for cat in ("extreme", "high", "elevated"):
        if hazard == "drought":
            if value <= th[cat]:
                return cat
        elif value >= th[cat]:
            return cat
    return "low"


def confidence_from(completeness: float, fresh: bool, has_forecast: bool = True) -> str:
    """Data-completeness level; hazard modules may cap it with a skill term."""
    if completeness >= 0.9 and fresh and has_forecast:
        return "high"
    if completeness >= 0.7 and has_forecast:
        return "medium"
    return "low"


def cap(level: str, max_level: str) -> str:
    order = config.CONFIDENCE_LEVELS  # high, medium, low
    return level if order.index(level) >= order.index(max_level) else max_level


def is_fresh(pi: PlaceInputs, today: date) -> bool:
    return pi.last_obs is not None and (today - pi.last_obs).days <= config.G3_POWER_MAX_AGE_D


def r(x: float | None, nd: int = 3) -> float | None:
    if x is None or not np.isfinite(x):
        return None
    return round(float(x), nd)


def pct_vs_normal(value: float, normal: float) -> str:
    """'48% below normal' / '12% above normal' / 'near normal'."""
    if not (np.isfinite(value) and np.isfinite(normal)) or normal <= 0.5:
        return "no normal available"
    d = (value - normal) / normal
    if abs(d) < 0.05:
        return "near normal"
    return f"{abs(d) * 100:.0f}% {'below' if d < 0 else 'above'} normal"
