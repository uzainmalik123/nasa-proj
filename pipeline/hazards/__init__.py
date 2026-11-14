"""Stage ``hazards``: four hazard modules on the feature table → risk records (PRD §7.2 steps 6-8).

Reads ``ctx["features"]`` (or ``data/features.parquet``), ``ctx["trends"]``
(or ``data/out/trends.json``) and the S1 caches, trains and saves the
wildfire model, and leaves in the context:

  ctx["risk"]      the risk.json body minus ``meta`` (now, history, drivers, text, model …)
  ctx["series"]    the series.json body minus ``meta``
  ctx["honesty"]   window / buckets / hit rates for honesty.json (mode "hindcast")
  ctx["metrics"]   the full wildfire metrics dict
  ctx["zscores"]   {"rain": (n, 91), "soil": …, "tmax": …} anomaly z per place per day
                   (history days + today) for the alert feed

    uv run python -m hazards            # standalone: hazards + publish on data/
    uv run python -m hazards --synth    # on data/synth/
"""

from __future__ import annotations

import json
import logging
import time
from datetime import UTC, date, datetime
from pathlib import Path

import numpy as np
import pandas as pd

import config

log = logging.getLogger("hazards")

MODEL_VERSION_FMT = "%Y-%m-%dT%H:%MZ"
ZCOLS = {"rain": "rain_anom_30d", "soil": "soil_anom", "tmax": "tmax_anom_7d"}


def _matrix(df: pd.DataFrame, col: str, n_places: int, days: list[str]) -> np.ndarray:
    """(n_places, len(days)) float matrix of ``col`` from the long feature table."""
    piv = df.pivot_table(index="place", columns="date", values=col, aggfunc="first")
    piv = piv.reindex(index=range(n_places), columns=days)
    return piv.to_numpy(dtype="float64")


def compute(
    places: pd.DataFrame,
    df: pd.DataFrame,
    trends: dict | None,
    today: date,
    version: str,
    data_dir: Path = config.DATA_DIR,
) -> dict:
    from hazards import common, drought, heat, rain, wildfire

    t0 = time.perf_counter()
    n = len(places)
    hdays = [d.isoformat() for d in common.history_days(today)]
    fdays = [d.isoformat() for d in common.forecast_days(today)]
    today_s = today.isoformat()

    # ---- wildfire model --------------------------------------------------
    model = wildfire.train(df, version)
    wildfire.save(model, data_dir / "model")
    t_model = time.perf_counter()

    # today's rows (one per place, NaN row where a place has none) and the history rows
    today_rows = df[df["date"] == today_s].set_index("place").reindex(range(n))
    hist = df[df["date"].isin(hdays)]
    p_today = model.score(today_rows)
    p_today = np.where(np.isfinite(p_today), p_today, 0.0)
    hist_scored = hist.assign(_p=model.score(hist))
    p_hist = _matrix(hist_scored, "_p", n, hdays)
    drivers_fire = wildfire.explain(model, today_rows)
    label_rate = df[df["label_valid"]].groupby("place")["label"].mean().reindex(range(n)).fillna(0)
    t_fire = time.perf_counter()
    log.info(
        "wildfire scored · today mean p %.3f · history %dx%d · shap %d rows · %.1fs",
        float(np.mean(p_today)),
        *p_hist.shape,
        len(drivers_fire),
        t_fire - t_model,
    )

    # ---- per-place inputs for the threshold hazards -----------------------
    inputs = common.load_all(places, data_dir, today)
    hist_by_place = {i: g.set_index("date").reindex(hdays) for i, g in hist.groupby("place")}
    empty_hist = pd.DataFrame(index=hdays, columns=df.columns).astype(
        {c: "float64" for c in ZCOLS.values()}
    )

    now, drivers, text = [], [], []
    history = {h: [] for h in config.HAZARDS}
    fwi_forecast = []
    series = {k: [] for k in (
        "rain_30d", "rain_30d_norm", "rain_30d_sd", "tmax", "tmax_norm", "tmax_sd",
        "soil_wet", "soil_wet_norm", "soil_wet_sd", "fires_7d",
    )}  # fmt: skip
    for i, pi in enumerate(inputs):
        row = today_rows.loc[i] if np.isfinite(today_rows.loc[i, "lat"]) else None
        ph = hist_by_place.get(i, empty_hist)
        # wildfire
        p = float(p_today[i])
        cat = common.category("wildfire", p)
        sev = float(row["fwi_14d"]) if row is not None and np.isfinite(row["fwi_14d"]) else 0.0
        conf = wildfire.confidence(pi, today, model.metrics, float(label_rate[i]))
        d_fire = drivers_fire[i] if row is not None else []
        fire_now = {
            "p": round(p, 3),
            "severity": round(sev, 3),
            "exposure": pi.pop,
            "confidence": conf if row is not None else "low",
            "category": cat,
        }
        fire_text = wildfire.text(
            pi, p, row if row is not None else pd.Series(dtype=float), d_fire, cat
        )
        d_now, d_hist, d_drv, d_text = drought.assess(pi, row, ph, today, trends)
        h_now, h_hist, h_drv, h_text = heat.assess(pi, today)
        r_now, r_hist, r_drv, r_text = rain.assess(pi, today)
        now.append({"wildfire": fire_now, "drought": d_now, "heat": h_now, "rain": r_now})
        drivers.append({"wildfire": d_fire, "drought": d_drv, "heat": h_drv, "rain": r_drv})
        text.append({"wildfire": fire_text, "drought": d_text, "heat": h_text, "rain": r_text})
        history["wildfire"].append([common.r(v, 3) for v in p_hist[i]])
        history["drought"].append(d_hist)
        history["heat"].append(h_hist)
        history["rain"].append(r_hist)
        fwi_forecast.append([common.r(v, 3) for v in pi.fc_fwi])
        # series.json
        series["rain_30d"].append(
            [common.r(v, 1) for v in ph["rain_30d"].to_numpy(dtype="float64")]
        )
        series["rain_30d_norm"].append([common.r(v, 1) for v in pi.rain30_norm_hist])
        series["rain_30d_sd"].append([common.r(v, 1) for v in pi.rain30_sd_hist])
        series["tmax"].append([common.r(v, 1) for v in ph["tmax"].to_numpy(dtype="float64")])
        series["tmax_norm"].append([common.r(v, 1) for v in pi.tmax_norm_hist])
        series["tmax_sd"].append([common.r(v, 2) for v in pi.tmax_sd_hist])
        series["soil_wet"].append(
            [common.r(v, 3) for v in ph["soil_wet"].to_numpy(dtype="float64")]
        )
        series["soil_wet_norm"].append([common.r(v, 3) for v in pi.soil_norm_hist])
        series["soil_wet_sd"].append([common.r(v, 3) for v in pi.soil_sd_hist])
        f7 = ph["fires_7d"].to_numpy(dtype="float64")
        series["fires_7d"].append([int(v) if np.isfinite(v) else None for v in f7])

    # anomaly z per place per day (history + today) for the feed
    zdays = [*hdays, today_s]
    zframe = df[df["date"].isin(zdays)]
    zscores = {k: _matrix(zframe, col, n, zdays) for k, col in ZCOLS.items()}

    m = model.metrics
    risk = {
        "hazards": list(config.HAZARDS),
        "valid_from": today_s,
        "valid_to": (today + pd.Timedelta(days=config.HORIZON_DAYS)).isoformat(),
        "now": now,
        "history_days": hdays,
        "history": history,
        "forecast_days": fdays,
        "fwi_forecast": fwi_forecast,
        "drivers": drivers,
        "text": text,
        "model": {
            "name": m["name"],
            "version": m["version"],
            "pr_auc": round(m["pr_auc"], 4),
            "baseline_pr_auc": round(m["baseline_pr_auc"], 4),
            "brier": round(m["brier"], 4),
            "holdout": m["holdout"],
        },
    }
    series_body = {"days": hdays, **series}
    log.info("hazards assembled · %d places · %.1fs total", n, time.perf_counter() - t0)
    return {
        "risk": risk,
        "series": series_body,
        "honesty": m["hindcast"],
        "metrics": m,
        "zscores": zscores,
        "zdays": zdays,
        "inputs": inputs,
    }


def summary(risk: dict) -> str:
    lines = []
    for h in config.HAZARDS:
        cats = pd.Series([r[h]["category"] for r in risk["now"]]).value_counts().to_dict()
        confs = pd.Series([r[h]["confidence"] for r in risk["now"]]).value_counts().to_dict()
        key = next(k for k in ("p", "index", "days_above") if k in risk["now"][0][h])
        vals = np.array([r[h][key] for r in risk["now"]], dtype="float64")
        lines.append(
            f"  {h:8} {key:10} mean {np.nanmean(vals):.3f} sd {np.nanstd(vals):.3f} "
            f"max {np.nanmax(vals):.3f} · categories {cats} · confidence {confs}"
        )
    m = risk["model"]
    lines.append(
        f"  model PR-AUC {m['pr_auc']:.3f} vs baseline {m['baseline_pr_auc']:.3f} · "
        f"Brier {m['brier']:.4f} · holdout {m['holdout']}"
    )
    return "\n".join(lines)


def run(ctx: dict) -> None:
    from trend import load

    log.info("stage hazards · run %s", ctx["run_id"])
    t0 = time.perf_counter()
    data_dir = Path(ctx.get("data_dir", config.DATA_DIR))
    started: datetime = ctx.get("started") or datetime.now(UTC)
    today = started.date()
    places = ctx.get("places")
    if places is None:
        places = load.load_places(data_dir)
        ctx["places"] = places
    df = ctx.get("features")
    if df is None:
        fpath = data_dir / "features.parquet"
        df = pd.read_parquet(fpath)
        log.info("features from %s · %d rows", fpath, len(df))
    trends = ctx.get("trends")
    if trends is None:
        tpath = data_dir / "out" / "trends.json"
        if tpath.exists():
            trends = json.loads(tpath.read_text())
    out = compute(places, df, trends, today, started.strftime(MODEL_VERSION_FMT), data_dir)
    ctx.update(out)
    log.info("stage hazards · %.1fs\n%s", time.perf_counter() - t0, summary(out["risk"]))
