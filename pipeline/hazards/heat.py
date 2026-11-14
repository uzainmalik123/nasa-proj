"""Heat: forecast max temperature against the place's own 95th / 99th percentiles.

* thresholds: percentiles of daily POWER ``T2M_MAX`` over the whole 10-year
  record (absolute heat for that place, not seasonal), so a mid-latitude
  place shows no heat hazard in its winter
* ``days_above``: forecast days (d+1 .. d+14) at or above the 95th percentile
* severity: °C of the hottest forecast day above the 95th percentile (≥ 0)
* category from ``config.CATEGORY_THRESHOLDS["heat"]`` on ``days_above``, capped at
  "elevated" when the hottest day is less than MIN_SEVERITY_C over the threshold
* drivers also carry the days above the 99th percentile and the peak heat
  index (Rothfusz regression from max temperature and mean humidity, only
  quoted when the day is ≥ 27 °C)
* history: the same count along the observed record (perfect prognosis)
"""

from __future__ import annotations

from datetime import date

import numpy as np

import config
from hazards import common

HI_MIN_C = 27.0
MIN_SEVERITY_C = 1.0  # "high" / "extreme" need the hottest day ≥ 1 °C over the 95th percentile


def heat_index_c(t_c: np.ndarray, rh: np.ndarray) -> np.ndarray:
    """NOAA heat index in °C (Rothfusz), only meaningful at ≥ 27 °C."""
    t = t_c * 9 / 5 + 32
    hi = (
        -42.379
        + 2.04901523 * t
        + 10.14333127 * rh
        - 0.22475541 * t * rh
        - 6.83783e-3 * t * t
        - 5.481717e-2 * rh * rh
        + 1.22874e-3 * t * t * rh
        + 8.5282e-4 * t * rh * rh
        - 1.99e-6 * t * t * rh * rh
    )
    hi = np.where(t_c >= HI_MIN_C, hi, t)
    return (hi - 32) * 5 / 9


def assess(pi: common.PlaceInputs, today: date) -> tuple[dict, list, list[dict], str]:
    history = [common.r(v, 0) if np.isfinite(v) else None for v in pi.hist_days_above]
    history = [int(v) if v is not None else None for v in history]
    if not pi.has_power or not np.isfinite(pi.tmax_p95):
        now = {
            "days_above": 0,
            "severity": 0.0,
            "exposure": pi.pop,
            "confidence": "low",
            "category": "low",
        }
        return now, history, [], f"No temperature record for {pi.name}; heat not assessed."
    t = pi.next_tmax
    ok = np.isfinite(t)
    days95 = int(np.sum(t[ok] >= pi.tmax_p95))
    days99 = int(np.sum(t[ok] >= pi.tmax_p99))
    peak = float(np.nanmax(t)) if ok.any() else np.nan
    peak_day = int(np.nanargmax(t)) + 1 if ok.any() else None
    sev = float(max(0.0, peak - pi.tmax_p95)) if np.isfinite(peak) else 0.0
    cat = common.category("heat", days95)
    if sev < MIN_SEVERITY_C:  # a narrow record (Lima: p95 25.3 °C) must not read as extreme
        cat = "elevated" if cat != "low" else cat
    conf = common.confidence_from(pi.completeness, common.is_fresh(pi, today), pi.has_forecast)
    if ok.sum() < config.HORIZON_DAYS:
        conf = common.cap(conf, "medium")
    drivers = [
        {
            "reason": f"{days95} of the next 14 forecast days at or above the 95th percentile "
            f"({pi.tmax_p95:.1f} °C)"
        },
        {"reason": f"{days99} days at or above the 99th percentile ({pi.tmax_p99:.1f} °C)"},
    ]
    if np.isfinite(peak):
        drivers.append({"reason": f"peak {peak:.1f} °C on day {peak_day}"})
        rh = pi.next_rh
        if ok.any() and np.isfinite(rh).any():
            hi = heat_index_c(np.nan_to_num(t, nan=0.0), np.nan_to_num(rh, nan=50.0))
            hi_peak = float(np.max(hi[ok]))
            if peak >= HI_MIN_C and hi_peak > peak + 0.5:
                drivers.append({"reason": f"peak heat index {hi_peak:.0f} °C with humidity"})
    now = {
        "days_above": days95,
        "severity": round(sev, 1),
        "exposure": pi.pop,
        "confidence": conf,
        "category": cat,
    }
    if days95 == 0:
        text = (
            f"No forecast day above {pi.name}'s 95th-percentile max temperature "
            f"({pi.tmax_p95:.1f} °C) in the next 14 days"
            + (f"; peak {peak:.1f} °C." if np.isfinite(peak) else ".")
        )
    else:
        text = (
            f"{days95} of the next 14 days at or above {pi.name}'s 95th-percentile max "
            f"temperature ({pi.tmax_p95:.1f} °C), {days99} above the 99th ({cat}). "
            f"Peak {peak:.1f} °C on day {peak_day}, {sev:.1f} °C over the threshold."
            + (
                f" Capped at elevated: less than {MIN_SEVERITY_C:.0f} °C over the threshold."
                if sev < MIN_SEVERITY_C and days95 >= config.CATEGORY_THRESHOLDS["heat"]["high"]
                else ""
            )
        )
    return now, history, drivers, text
