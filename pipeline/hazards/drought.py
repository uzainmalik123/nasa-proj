"""Drought: standardised deficit index from the place's own climatology (PRD §7.2 step 6).

  index = 0.40 · z(90-day rain) + 0.25 · z(30-day rain) + 0.35 · z(root-zone soil wetness)

where every z is the anomaly against the place's own 10-year normal for that
calendar window (``features.parquet`` columns ``rain_anom_90d``,
``rain_anom_30d``, ``soil_anom``). Missing terms are dropped and the weights
renormalised. Negative is dry; categories from ``config.CATEGORY_THRESHOLDS``
("elevated" at -0.5, "high" at -1.0, "extreme" at -1.5). Severity is the
90-day deficit as a fraction of normal (0 = at or above normal, 1 = no rain).
"""

from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

import config
from hazards import common

WEIGHTS = {"rain_anom_90d": 0.40, "rain_anom_30d": 0.25, "soil_anom": 0.35}
INDEX_CLIP = 4.0


def index(frame: pd.DataFrame) -> np.ndarray:
    """Drought index per row, NaN where no term is available."""
    num = np.zeros(len(frame))
    den = np.zeros(len(frame))
    for col, w in WEIGHTS.items():
        v = frame[col].to_numpy(dtype="float64")
        ok = np.isfinite(v)
        num[ok] += w * v[ok]
        den[ok] += w
    with np.errstate(invalid="ignore", divide="ignore"):
        out = np.where(den > 0, num / den, np.nan)
    return np.clip(out, -INDEX_CLIP, INDEX_CLIP)


def _trend_reason(trends: dict | None, i: int) -> str | None:
    if not trends:
        return None
    j = config.VARIABLES.index("rain_mm")
    k = config.VARIABLES.index("soil_wet")
    for window, name in (("short", "90-day"), ("long", "10-year")):
        for var, jj, unit in (("rainfall", j, "mm/day per yr"), ("soil wetness", k, "per yr")):
            label = trends[window]["label"][i][jj]
            slope = trends[window]["slope"][i][jj]
            if label == "falling":
                if slope is None or abs(slope) < 1e-4:  # Sen's slope ties at zero on dry records
                    return f"{name} {var} trend falling (p < 0.05)"
                return f"{name} {var} trend falling ({slope:+.3g} {unit}, p < 0.05)"
    return None


def assess(
    pi: common.PlaceInputs,
    row: pd.Series | None,
    hist: pd.DataFrame,
    today: date,
    trends: dict | None,
) -> tuple[dict, list, list[dict], str]:
    hist_idx = index(hist) if len(hist) else np.full(config.HISTORY_DAYS, np.nan)
    if row is None or not pi.has_power:
        now = {
            "index": 0.0,
            "severity": 0.0,
            "exposure": pi.pop,
            "confidence": "low",
            "category": "low",
        }
        return now, [None] * config.HISTORY_DAYS, [], f"No observation record for {pi.name}."
    idx = float(index(row.to_frame().T)[0])
    if not np.isfinite(idx):
        idx = 0.0
    cat = common.category("drought", idx)
    r90, r30 = float(row.get("rain_90d", np.nan)), float(row.get("rain_30d", np.nan))
    sev = 0.0
    if np.isfinite(r90) and np.isfinite(pi.rain90_norm) and pi.rain90_norm > 0.5:
        sev = float(np.clip((pi.rain90_norm - r90) / pi.rain90_norm, 0, 1))
    conf = common.confidence_from(pi.completeness, common.is_fresh(pi, today))
    drivers: list[dict] = []
    if np.isfinite(r90):
        drivers.append(
            {"reason": f"90-day rainfall {r90:.0f} mm, {common.pct_vs_normal(r90, pi.rain90_norm)}"}
        )
    if np.isfinite(r30):
        drivers.append(
            {"reason": f"30-day rainfall {r30:.0f} mm, {common.pct_vs_normal(r30, pi.rain30_norm)}"}
        )
    z_soil = float(row.get("soil_anom", np.nan))
    if np.isfinite(z_soil):
        drivers.append(
            {
                "reason": f"root-zone soil wetness {abs(z_soil):.1f} sd "
                f"{'below' if z_soil < 0 else 'above'} normal"
            }
        )
    t = _trend_reason(trends, pi.idx)
    if t:
        drivers.append({"reason": t})
    now = {
        "index": round(idx, 2),
        "severity": round(sev, 3),
        "exposure": pi.pop,
        "confidence": conf,
        "category": cat,
    }
    text = (
        f"Drought index {idx:+.1f} for {pi.name} ({cat}). "
        f"90-day rainfall is {common.pct_vs_normal(r90, pi.rain90_norm)}"
        + (
            f"; soil wetness {abs(z_soil):.1f} sd {'below' if z_soil < 0 else 'above'} normal."
            if np.isfinite(z_soil)
            else "."
        )
        + (f" {t[0].upper() + t[1:]}." if t else "")
    )
    history = [common.r(v, 2) for v in hist_idx]
    return now, history, drivers, text
