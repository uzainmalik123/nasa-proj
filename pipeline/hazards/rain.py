"""Heavy rain: forecast 3- and 7-day totals against the place's own percentiles.

An "unusually wet week" is a 7-day total at or above the place's seasonal
95th percentile of the wettest 7 days inside any 14-day window (the same
statistic the forecast is scored with, pooled over ±30 calendar days of the
10-year record, so it is a 5 % event by construction).

The forecast is deterministic, so the probability comes from a multiplicative
error model: log(actual + 1) ~ N(log(forecast + 1), SIGMA_LOG). With
SIGMA_LOG = 0.5 a forecast at the threshold gives p = 0.5, 60 % of it gives
0.16, double gives 0.92. It is a stated assumption, not a calibrated
quantity, and the text says so ("not a flood forecast"). Severity is mm of
the forecast week above the 95th-percentile week (≥ 0).
"""

from __future__ import annotations

from datetime import date

import numpy as np
from scipy.stats import norm

from hazards import common

SIGMA_LOG = 0.5
P_MAX = 0.995  # never published as exactly 1


def wet_probability(total: np.ndarray | float, q95: np.ndarray | float) -> np.ndarray:
    total, q95 = np.asarray(total, dtype="float64"), np.asarray(q95, dtype="float64")
    with np.errstate(invalid="ignore", divide="ignore"):
        z = (np.log1p(np.maximum(total, 0)) - np.log1p(np.maximum(q95, 0))) / SIGMA_LOG
        p = norm.cdf(z)
    return np.where(np.isfinite(total) & np.isfinite(q95), p, np.nan)


def assess(pi: common.PlaceInputs, today: date) -> tuple[dict, list, list[dict], str]:
    hist_p = wet_probability(pi.hist_wet7, pi.hist_rain7_q95)
    history = [common.r(v, 3) for v in hist_p]
    if not pi.has_power or not np.isfinite(pi.rain7_q95):
        now = {
            "p": 0.0,
            "severity": 0.0,
            "exposure": pi.pop,
            "confidence": "low",
            "category": "low",
        }
        return now, history, [], f"No rainfall record for {pi.name}; heavy rain not assessed."
    rain = pi.next_rain
    f7 = common.wettest(rain, 7)
    f3 = common.wettest(rain, 3)
    if not np.isfinite(f7):  # partial forecast: use what exists
        filled = np.nan_to_num(rain, nan=0.0)
        f7, f3 = common.wettest(filled, 7), common.wettest(filled, 3)
    p = float(wet_probability(f7, pi.rain7_q95))
    p = min(p, P_MAX) if np.isfinite(p) else 0.0
    sev = float(max(0.0, f7 - pi.rain7_q95))
    cat = common.category("rain", p)
    conf = common.confidence_from(pi.completeness, common.is_fresh(pi, today), pi.has_forecast)
    if not np.isfinite(rain).all():
        conf = common.cap(conf, "medium")
    drivers = [
        {"reason": f"wettest 7 days of the forecast total {f7:.0f} mm"},
        {"reason": f"95th-percentile week for this time of year is {pi.rain7_q95:.0f} mm"},
        {
            "reason": f"wettest 3 days of the forecast total {f3:.0f} mm "
            f"(95th percentile {pi.rain3_q95:.0f} mm)"
        },
    ]
    now = {
        "p": round(p, 3),
        "severity": round(sev, 1),
        "exposure": pi.pop,
        "confidence": conf,
        "category": cat,
    }
    text = (
        f"{p * 100:.0f}% chance of an unusually wet week around {pi.name} ({cat}): the wettest "
        f"7 forecast days total {f7:.0f} mm against a 95th-percentile week of "
        f"{pi.rain7_q95:.0f} mm for this time of year. Not a flood forecast."
    )
    return now, history, drivers, text
