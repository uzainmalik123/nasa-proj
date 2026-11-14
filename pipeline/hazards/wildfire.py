"""Wildfire: XGBoost on the feature table (PRD §7.2 step 6), calibrated, explained.

  * train rows: ``split == "train"``; the last ES_WEEKS of them are the
    early-stopping set (time-ordered); ``split == "holdout"`` (final
    HOLDOUT_WEEKS of valid labels) is never seen in training
  * isotonic calibration fitted on the holdout; PR-AUC is reported on the raw
    scores (isotonic is monotone, so it only ties ranks) and Brier on the
    calibrated scores, both on the holdout, next to the same numbers for the
    fire weather index baseline (``fwi_14d`` calibrated the same way) and for
    persistence (``fires_30d``)
  * the published Brier and the honesty buckets use a cross-fitted
    calibration (isotonic fitted on each time-ordered half of the holdout and
    applied to the other), so they are out of sample for the calibrator too;
    ``brier_insample`` is the optimistic number
  * SHAP (TreeExplainer) top-5 drivers per place for today's row
  * ``score`` returns calibrated probabilities for any feature rows (today and
    the 90-day history)

Artifacts: ``data/model/xgb_wildfire.json`` (booster) and
``data/model/metrics.json`` (metrics + isotonic breakpoints).
"""

from __future__ import annotations

import itertools
import json
import logging
import time
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import average_precision_score, brier_score_loss

import config
from features.build import FEATURE_COLS
from hazards import common

log = logging.getLogger("hazards.wildfire")

MODEL_NAME = "xgb_wildfire"
MODEL_DIR = config.DATA_DIR / "model"
ES_WEEKS = 4
PARAMS = {
    "objective": "binary:logistic",
    "tree_method": "hist",
    "eval_metric": "aucpr",
    "max_depth": 6,
    "eta": 0.05,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "min_child_weight": 20,
    "reg_lambda": 2.0,
    "seed": 20261114,
    "nthread": 0,
}
MAX_ROUNDS = 1500
EARLY_STOP = 60
TOP_K = 5
P_CLIP = (0.002, 0.995)  # a calibrated probability is never published as exactly 0 or 1
CAL_BUCKETS = [0.0, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.7, 1.0]

FEATURE_LABELS = {
    "rain_7d": "7-day rainfall",
    "rain_30d": "30-day rainfall",
    "rain_90d": "90-day rainfall",
    "rain_anom_7d": "7-day rainfall anomaly",
    "rain_anom_30d": "30-day rainfall anomaly",
    "rain_anom_90d": "90-day rainfall anomaly",
    "tmax": "max temperature",
    "tmax_anom_7d": "7-day max temperature anomaly",
    "rh": "humidity",
    "rh_anom_7d": "7-day humidity anomaly",
    "soil_wet": "root-zone soil wetness",
    "soil_anom": "soil wetness anomaly",
    "soil_wet_change_30d": "30-day soil wetness change",
    "days_since_rain": "days since rain",
    "fwi_obs_7d": "observed fire weather, last 7 days",
    "fwi_14d": "forecast fire weather, next 14 days",
    "fwi_14d_max": "peak forecast fire weather",
    "fires_7d": "detections in the last 7 days",
    "fires_30d": "detections in the last 30 days",
    "days_since_fire": "days since last detection",
    "rain_trend_10y": "10-year rainfall trend",
    "tmax_trend_10y": "10-year temperature trend",
    "rh_trend_10y": "10-year humidity trend",
    "soil_trend_10y": "10-year soil wetness trend",
    "rain_trend_90d": "90-day rainfall trend",
    "tmax_trend_90d": "90-day temperature trend",
    "rh_trend_90d": "90-day humidity trend",
    "soil_trend_90d": "90-day soil wetness trend",
    "fires_trend_90d": "90-day fire trend",
    "lat": "latitude",
    "lon": "longitude",
    "doy_sin": "season (sin)",
    "doy_cos": "season (cos)",
}


class WildfireModel:
    def __init__(self, booster: xgb.Booster, iso: IsotonicRegression, metrics: dict):
        self.booster = booster
        self.iso = iso
        self.metrics = metrics

    def raw(self, X: pd.DataFrame) -> np.ndarray:
        return self.booster.predict(xgb.DMatrix(X[FEATURE_COLS], missing=np.nan))

    def score(self, X: pd.DataFrame) -> np.ndarray:
        """Calibrated probability per row (NaN cells allowed; XGBoost handles missing)."""
        if len(X) == 0:
            return np.array([])
        return np.clip(self.iso.predict(self.raw(X)), P_CLIP[0], P_CLIP[1])


def _dmatrix(df: pd.DataFrame) -> xgb.DMatrix:
    return xgb.DMatrix(df[FEATURE_COLS], label=df["label"].astype(int), missing=np.nan)


def _fit_iso(x: np.ndarray, y: np.ndarray) -> IsotonicRegression:
    iso = IsotonicRegression(y_min=0.0, y_max=1.0, out_of_bounds="clip")
    iso.fit(x, y)
    return iso


def _cross_fit(raw: np.ndarray, y: np.ndarray, dates: np.ndarray) -> np.ndarray:
    """Calibrated scores with the isotonic map fitted on the *other* half of the holdout.

    The holdout is split in two time-ordered halves; each half is scored by a
    map fitted on the other, so the published Brier and calibration buckets
    are out of sample for the calibrator as well as for the trees.
    """
    cut = np.sort(dates)[len(dates) // 2]
    a, b = dates <= cut, dates > cut
    if a.sum() < 100 or b.sum() < 100:
        return np.clip(_fit_iso(raw, y).predict(raw), P_CLIP[0], P_CLIP[1])
    out = np.empty(len(raw))
    out[a] = _fit_iso(raw[b], y[b]).predict(raw[a])
    out[b] = _fit_iso(raw[a], y[a]).predict(raw[b])
    return np.clip(out, P_CLIP[0], P_CLIP[1])


def train(df: pd.DataFrame, version: str) -> WildfireModel:
    t0 = time.perf_counter()
    tr = df[df["split"] == "train"].sort_values("date")
    ho = df[df["split"] == "holdout"].sort_values("date")
    if len(tr) < 1000 or len(ho) < 200 or ho["label"].sum() < 10:
        raise RuntimeError(f"not enough labelled rows: train {len(tr)}, holdout {len(ho)}")
    es_cut = pd.Timestamp(tr["date"].max()) - pd.Timedelta(weeks=ES_WEEKS)
    fit = tr[pd.to_datetime(tr["date"]) <= es_cut]
    es = tr[pd.to_datetime(tr["date"]) > es_cut]
    d_fit, d_es, d_ho = _dmatrix(fit), _dmatrix(es), _dmatrix(ho)
    booster = xgb.train(
        PARAMS,
        d_fit,
        num_boost_round=MAX_ROUNDS,
        evals=[(d_es, "es")],
        early_stopping_rounds=EARLY_STOP,
        verbose_eval=False,
    )
    best = int(booster.best_iteration) + 1
    booster = booster[:best]  # drop the rounds after the best one
    raw = booster.predict(d_ho)
    y = ho["label"].to_numpy(dtype=int)
    dates = pd.to_datetime(ho["date"]).to_numpy()
    iso = _fit_iso(raw, y)  # the map used at inference: all of the holdout
    cal_in = np.clip(iso.predict(raw), P_CLIP[0], P_CLIP[1])
    cal = _cross_fit(raw, y, dates)  # what gets reported
    fwi = ho["fwi_14d"].fillna(0).to_numpy(dtype="float64")
    pers = ho["fires_30d"].fillna(0).to_numpy(dtype="float64")
    fwi_cal = _cross_fit(fwi, y, dates)
    metrics = {
        "name": MODEL_NAME,
        "version": version,
        "pr_auc": float(average_precision_score(y, raw)),
        "baseline_pr_auc": float(average_precision_score(y, fwi)),
        "persistence_pr_auc": float(average_precision_score(y, pers)),
        "brier": float(brier_score_loss(y, cal)),  # cross-fitted calibration
        "brier_raw": float(brier_score_loss(y, raw)),
        "brier_insample": float(brier_score_loss(y, cal_in)),
        "baseline_brier": float(brier_score_loss(y, fwi_cal)),
        "climatology_brier": float(brier_score_loss(y, np.full(len(y), y.mean()))),
        "holdout": [str(ho["date"].min()), str(ho["date"].max())],
        "holdout_base_rate": float(y.mean()),
        "n_train": len(fit),
        "n_early_stop": len(es),
        "n_holdout": len(ho),
        "best_iteration": best,
        "features": FEATURE_COLS,
        "train_s": round(time.perf_counter() - t0, 1),
    }
    log.info(
        "wildfire · %d rounds · PR-AUC %.3f (fwi %.3f, persistence %.3f, base rate %.3f) · "
        "Brier %.4f (raw %.4f, in-sample %.4f, fwi %.4f, climatology %.4f) · %.1fs",
        best,
        metrics["pr_auc"],
        metrics["baseline_pr_auc"],
        metrics["persistence_pr_auc"],
        metrics["holdout_base_rate"],
        metrics["brier"],
        metrics["brier_raw"],
        metrics["brier_insample"],
        metrics["baseline_brier"],
        metrics["climatology_brier"],
        metrics["train_s"],
    )
    model = WildfireModel(booster, iso, metrics)
    model.metrics["hindcast"] = hindcast(ho, cal, fwi_cal)
    return model


def hindcast(ho: pd.DataFrame, cal: np.ndarray, baseline: np.ndarray) -> dict:
    """honesty.json body for mode "hindcast": calibration buckets + top-20 hit rates.

    ``cal`` and ``baseline`` are the cross-fitted calibrated scores on the holdout.
    """
    y = ho["label"].to_numpy(dtype=int)
    buckets = []
    for lo, hi in itertools.pairwise(CAL_BUCKETS):
        sel = (cal >= lo) & ((cal < hi) if hi < 1 else (cal <= hi))
        if sel.sum() == 0:
            continue
        buckets.append(
            {
                "lo": lo,
                "hi": hi,
                "n": int(sel.sum()),
                "pred": round(float(cal[sel].mean()), 4),
                "obs": round(float(y[sel].mean()), 4),
            }
        )
    frame = pd.DataFrame({"date": ho["date"].to_numpy(), "y": y, "p": cal, "b": baseline})
    hits, bhits = [], []
    for _, g in frame.groupby("date"):
        if len(g) < 20:
            continue
        hits.append(g.nlargest(20, "p")["y"].mean())
        bhits.append(g.nlargest(20, "b")["y"].mean())
    return {
        "window": [str(ho["date"].min()), str(ho["date"].max())],
        "buckets": buckets,
        "top20_hit_rate": round(float(np.mean(hits)), 4) if hits else None,
        "baseline_top20_hit_rate": round(float(np.mean(bhits)), 4) if bhits else None,
    }


def save(model: WildfireModel, model_dir: Path = MODEL_DIR) -> None:
    model_dir.mkdir(parents=True, exist_ok=True)
    model.booster.save_model(model_dir / f"{MODEL_NAME}.json")
    body = dict(model.metrics)
    body["isotonic"] = {
        "x": [float(v) for v in model.iso.X_thresholds_],
        "y": [float(v) for v in model.iso.y_thresholds_],
    }
    (model_dir / "metrics.json").write_text(json.dumps(body, indent=1) + "\n")
    log.info("saved %s.json and metrics.json under %s", MODEL_NAME, model_dir)


def explain(model: WildfireModel, X: pd.DataFrame) -> list[list[dict]]:
    """Top-TOP_K SHAP drivers per row (log-odds units of the raw model)."""
    import shap

    if len(X) == 0:
        return []
    expl = shap.TreeExplainer(model.booster)
    vals = np.asarray(expl.shap_values(X[FEATURE_COLS]))
    if vals.ndim == 3:  # some shap versions return (n, features, classes)
        vals = vals[:, :, -1]
    out: list[list[dict]] = []
    feats = X[FEATURE_COLS].to_numpy(dtype="float64")
    for row, fv in zip(vals, feats, strict=True):
        order = np.argsort(-np.abs(row))[:TOP_K]
        out.append(
            [
                {
                    "feature": FEATURE_COLS[j],
                    "label": FEATURE_LABELS.get(FEATURE_COLS[j], FEATURE_COLS[j]),
                    "shap": common.r(row[j], 3),
                    "value": common.r(fv[j], 3),
                }
                for j in order
            ]
        )
    return out


def confidence(pi: common.PlaceInputs, today: date, metrics: dict, place_label_rate: float) -> str:
    level = common.confidence_from(pi.completeness, common.is_fresh(pi, today), pi.has_forecast)
    lift = metrics["pr_auc"] / max(metrics["baseline_pr_auc"], 1e-6)
    if lift < 1.0 or metrics["brier"] > metrics["baseline_brier"]:
        level = common.cap(level, "low")
    elif lift < 1.15:
        level = common.cap(level, "medium")
    if place_label_rate == 0.0:  # the model never saw a fire fortnight here
        level = common.cap(level, "medium")
    return level


def text(pi: common.PlaceInputs, p: float, row: pd.Series, drivers: list[dict], cat: str) -> str:
    if not pi.has_power:
        return f"No observation record for {pi.name}; wildfire risk not assessed."
    bits = [
        f"{p * 100:.0f}% chance of 3 or more fire detections within 50 km of {pi.name} "
        f"in the next 14 days ({cat})."
    ]
    r30 = row.get("rain_anom_30d")
    if r30 is not None and np.isfinite(r30) and abs(r30) >= 1.0:
        bits.append(
            f"30-day rainfall is {abs(r30):.1f} sd {'below' if r30 < 0 else 'above'} normal."
        )
    fwi = row.get("fwi_14d")
    if fwi is not None and np.isfinite(fwi):
        bits.append(f"Forecast fire weather index {fwi:.2f} (0-1).")
    f30 = row.get("fires_30d")
    if f30 is not None and np.isfinite(f30) and f30 > 0:
        bits.append(f"{int(f30)} detections in the last 30 days.")
    if drivers:
        d = drivers[0]
        bits.append(f"Main driver: {d['label']} ({'raises' if d['shap'] > 0 else 'lowers'} risk).")
    return " ".join(bits)
