"""Generate the full mock data set (contracts §3) for the first N places.

    uv run python publish/mock.py

Reads data/places.parquet (build_places.py first), takes the first
config.MOCK_N_PLACES places, and writes every file the pipeline publishes into
dashboard/public/data/ with plausible, seeded random values. The dashboard
sessions render against this before real data exists.
"""

from __future__ import annotations

import itertools
import json
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import config
from publish import aggregate

RNG = np.random.default_rng(20261114)
N = config.MOCK_N_PLACES
H = config.HAZARDS
V = config.VARIABLES
HIST = config.HISTORY_DAYS
FCST = config.FORECAST_DAYS
MONTHS = config.LONG_WINDOW_MONTHS

NOW = datetime.now(UTC).replace(second=0, microsecond=0)
RUN_ID = NOW.strftime(config.RUN_ID_FORMAT)
TODAY = NOW.date()
ISO = "%Y-%m-%dT%H:%MZ"
ISO_S = "%Y-%m-%dT%H:%M:%SZ"
MODEL_VERSION = NOW.strftime(ISO)

SHAP_FEATURES = [
    ("rain_anom_30d", "30-day rainfall anomaly"),
    ("tmax_anom_7d", "7-day max temperature anomaly"),
    ("rh_anom_7d", "7-day humidity anomaly"),
    ("soil_wet_change_30d", "30-day soil wetness change"),
    ("fwi_14d", "forecast fire weather index"),
    ("fires_30d", "detections in the last 30 days"),
    ("days_since_fire", "days since last detection"),
    ("rain_trend_90d", "90-day rainfall trend"),
]


def meta() -> dict:
    return {"run_id": RUN_ID, "generated_at": NOW.strftime(ISO_S), "tier": config.PLACE_TIER}


def r3(x: float) -> float:
    return float(round(float(x), 3))


def days_back(n: int, end: date) -> list[str]:
    return [(end - timedelta(days=n - 1 - i)).isoformat() for i in range(n)]


def days_fwd(n: int, start: date) -> list[str]:
    return [(start + timedelta(days=i)).isoformat() for i in range(n)]


def category(hazard: str, value: float) -> str:
    th = config.CATEGORY_THRESHOLDS[hazard]
    if hazard == "drought":  # deficit index, lower is worse
        for cat in ("extreme", "high", "elevated"):
            if value <= th[cat]:
                return cat
        return "low"
    for cat in ("extreme", "high", "elevated"):
        if value >= th[cat]:
            return cat
    return "low"


def label(slope: float, p: float) -> str:
    if p >= config.TREND_P_SIGNIFICANT:
        return "stable"
    return "rising" if slope > 0 else "falling"


def confidence() -> str:
    return str(RNG.choice(config.CONFIDENCE_LEVELS, p=[0.5, 0.35, 0.15]))


def smooth_walk(n: int, lo: float, hi: float) -> np.ndarray:
    x = np.cumsum(RNG.normal(0, 1.0, n))
    x = x - x.min()
    x = x / (x.max() + 1e-9)
    return lo + x * (hi - lo)


# ---------------------------------------------------------------------------
def mock_places(places: pd.DataFrame) -> dict:
    return {"meta": meta(), "places": places.to_dict(orient="records")}


def mock_trends(places: pd.DataFrame) -> dict:
    n = len(places)
    first = TODAY.replace(day=1)
    months = [
        (first - pd.DateOffset(months=MONTHS - 1 - i)).strftime("%Y-%m") for i in range(MONTHS)
    ]
    base = {
        "rain_mm": (60, 40),
        "tmax_c": (28, 6),
        "rh_pct": (60, 15),
        "wind_ms": (3.5, 1.0),
        "soil_wet": (0.45, 0.15),
        "fires": (4, 4),
    }
    slope_scale = {
        "rain_mm": 2.0,
        "tmax_c": 0.08,
        "rh_pct": 0.5,
        "wind_ms": 0.03,
        "soil_wet": 0.006,
        "fires": 0.4,
    }

    def window(name: str, mult: float) -> dict:
        slope = [[r3(RNG.normal(0, slope_scale[v] * mult)) for v in V] for _ in range(n)]
        p = [[r3(RNG.beta(0.7, 2.5)) for _ in V] for _ in range(n)]
        lab = [[label(slope[i][j], p[i][j]) for j in range(len(V))] for i in range(n)]
        for i in range(n):  # a few insufficient cells so the UI handles them
            if RNG.random() < 0.05:
                j = int(RNG.integers(len(V)))
                slope[i][j], p[i][j], lab[i][j] = None, None, "insufficient"
        return {"window": name, "slope": slope, "p": p, "label": lab}

    series_long = []
    for _ in range(n):
        per_var = []
        for v in V:
            mu, sd = base[v]
            season = np.sin(np.arange(MONTHS) / 12 * 2 * np.pi + RNG.uniform(0, 6.28))
            vals = mu + sd * 0.6 * season + RNG.normal(0, sd * 0.25, MONTHS)
            vals = vals + np.linspace(0, RNG.normal(0, sd * 0.3), MONTHS)
            if v == "fires":
                vals = np.clip(vals, 0, None).round(0)
            elif v != "tmax_c":
                vals = np.clip(vals, 0, None)
            per_var.append([r3(x) for x in vals])
        series_long.append(per_var)
    return {
        "meta": meta(),
        "variables": list(V),
        "units": list(config.VARIABLE_UNITS),
        "long": window("10y", 1.0),
        "short": window("90d", 6.0),
        "series_long": series_long,
        "months": months,
    }


def mock_risk(places: pd.DataFrame) -> dict:
    n = len(places)
    now, history, fwi, drivers, text = [], {h: [] for h in H}, [], [], []
    for i in range(n):
        pop = int(places.iloc[i]["pop"])
        name = str(places.iloc[i]["name"])
        p_fire = r3(RNG.beta(1.2, 6))
        d_index = r3(RNG.normal(-0.3, 1.0))
        days_above = int(RNG.poisson(1.5))
        p_rain = r3(RNG.beta(1.0, 7))
        now.append(
            {
                "wildfire": {
                    "p": p_fire,
                    "severity": r3(RNG.beta(2, 3)),
                    "exposure": pop,
                    "confidence": confidence(),
                    "category": category("wildfire", p_fire),
                },
                "drought": {
                    "index": d_index,
                    "severity": r3(abs(min(d_index, 0)) / 2.5),
                    "exposure": pop,
                    "confidence": confidence(),
                    "category": category("drought", d_index),
                },
                "heat": {
                    "days_above": days_above,
                    "severity": r3(max(0.0, RNG.normal(1.0, 1.2))) if days_above else 0.0,
                    "exposure": pop,
                    "confidence": confidence(),
                    "category": category("heat", days_above),
                },
                "rain": {
                    "p": p_rain,
                    "severity": r3(max(0.0, RNG.normal(10, 12))),
                    "exposure": pop,
                    "confidence": confidence(),
                    "category": category("rain", p_rain),
                },
            }
        )
        history["wildfire"].append([r3(x) for x in smooth_walk(HIST, 0.0, p_fire * 1.4)])
        history["drought"].append([r3(x) for x in smooth_walk(HIST, d_index - 0.8, d_index + 0.4)])
        history["heat"].append([int(x) for x in np.clip(smooth_walk(HIST, 0, 6).round(), 0, 10)])
        history["rain"].append([r3(x) for x in smooth_walk(HIST, 0.0, p_rain * 1.5)])
        fwi.append([r3(x) for x in np.clip(smooth_walk(FCST, 0.05, 0.9), 0, 1)])
        feats = RNG.choice(len(SHAP_FEATURES), 5, replace=False)
        peak, day = r3(RNG.uniform(30, 44)), int(RNG.integers(1, 14))
        drivers.append(
            {
                "wildfire": [
                    {
                        "feature": SHAP_FEATURES[k][0],
                        "label": SHAP_FEATURES[k][1],
                        "shap": r3(RNG.normal(0, 0.3)),
                        "value": r3(RNG.normal(0, 1.5)),
                    }
                    for k in feats
                ],
                "drought": [
                    {"reason": f"90-day rainfall {int(RNG.uniform(10, 60))}% below normal"},
                    {"reason": f"soil wetness {r3(RNG.uniform(0.5, 2.0))} sd below normal"},
                ],
                "heat": [
                    {"reason": f"{days_above} forecast days above the 95th percentile"},
                    {"reason": f"peak {peak} C on day {day}"},
                ],
                "rain": [
                    {"reason": f"7-day forecast total {int(RNG.uniform(20, 180))} mm"},
                    {"reason": f"{int(RNG.uniform(80, 99))}th percentile of the place's own weeks"},
                ],
            }
        )
        text.append(
            {
                "wildfire": (
                    f"Risk {int(p_fire * 100)}% for the next two weeks around {name}. "
                    f"Rainfall is {int(RNG.uniform(10, 60))}% below normal over the last 30 days; "
                    f"max temperature is running {r3(RNG.uniform(0.5, 2.5))} sd hot. "
                    f"Main driver: {SHAP_FEATURES[feats[0]][1]}."
                ),
                "drought": f"Drought index {d_index} ({category('drought', d_index)}).",
                "heat": f"{days_above} days above the 95th percentile in the next 14 days.",
                "rain": (
                    f"{int(p_rain * 100)}% chance of an unusually wet week. Not a flood forecast."
                ),
            }
        )
    return {
        "meta": meta(),
        "hazards": list(H),
        "valid_from": TODAY.isoformat(),
        "valid_to": (TODAY + timedelta(days=config.HORIZON_DAYS)).isoformat(),
        "now": now,
        "history_days": days_back(HIST, TODAY - timedelta(days=1)),
        "history": history,
        "forecast_days": days_fwd(FCST, TODAY),
        "fwi_forecast": fwi,
        "drivers": drivers,
        "text": text,
        "model": {
            "name": "xgb_wildfire",
            "version": MODEL_VERSION,
            "pr_auc": 0.31,
            "baseline_pr_auc": 0.19,
            "brier": 0.041,
            "holdout": [
                (TODAY - timedelta(weeks=config.HOLDOUT_WEEKS)).isoformat(),
                (TODAY - timedelta(days=1)).isoformat(),
            ],
        },
    }


def mock_series(places: pd.DataFrame) -> dict:
    n = len(places)
    out: dict = {"meta": meta(), "days": days_back(HIST, TODAY - timedelta(days=1))}
    specs = {"rain_30d": (60, 50, 20), "tmax": (28, 6, 2.5), "soil_wet": (0.45, 0.2, 0.08)}
    for key, (mu, amp, sd) in specs.items():
        vals, norm, sds = [], [], []
        for _ in range(n):
            base = mu + RNG.normal(0, amp * 0.5)
            phase = RNG.uniform(0, 6)
            season = base + amp * 0.3 * np.sin(np.arange(HIST) / 365 * 2 * np.pi + phase)
            obs = season + np.cumsum(RNG.normal(0, sd * 0.15, HIST))
            if key != "tmax":
                obs, season = np.clip(obs, 0, None), np.clip(season, 0, None)
            vals.append([r3(x) for x in obs])
            norm.append([r3(x) for x in season])
            sds.append([r3(sd * RNG.uniform(0.8, 1.2))] * HIST)
        out[key] = vals
        out[f"{key}_norm"] = norm
        out[f"{key}_sd"] = sds
    out["fires_7d"] = [[int(x) for x in RNG.poisson(RNG.uniform(0, 4), HIST)] for _ in range(n)]
    return out


def snap(x: float) -> float:
    """Snap a coordinate to a 0.25° bin centre."""
    return r3(np.floor(x / config.FIRMS_BIN_DEG) * config.FIRMS_BIN_DEG + config.FIRMS_BIN_DEG / 2)


def mock_fires(places: pd.DataFrame) -> dict:
    bins = []
    for _, p in places.iterrows():  # clusters near watched places
        for _ in range(int(RNG.integers(0, 6))):
            lon, lat = p["lon"] + RNG.normal(0, 1.5), p["lat"] + RNG.normal(0, 1.5)
            bins.append([snap(lon), snap(lat), int(RNG.integers(1, 40)), r3(RNG.uniform(2, 180))])
    for _ in range(600):  # scattered global background, tropics-heavy
        lon, lat = RNG.uniform(-180, 180), RNG.normal(10, 25)
        if abs(lat) > 70:
            continue
        bins.append([snap(lon), snap(lat), int(RNG.integers(1, 15)), r3(RNG.uniform(1, 90))])
    return {
        "meta": meta(),
        "source": config.FIRMS_LIVE_SOURCE,
        "newest_acq": (NOW - timedelta(hours=3)).strftime(ISO),
        "bins": bins,
    }


def mock_feed(places: pd.DataFrame, risk: dict) -> dict:
    alerts = []
    for k in range(30):
        i = int(RNG.integers(len(places)))
        h = str(RNG.choice(H))
        issued = NOW - timedelta(hours=int(3 * k + RNG.integers(0, 3)))
        rec = risk["now"][i][h]
        anomalies = [a for a in ("rain", "soil", "tmax") if RNG.random() < 0.5] or ["rain"]
        alerts.append(
            {
                "id": f"{issued.strftime(ISO)}-{places.iloc[i]['id']}-{h}",
                "hazard": h,
                "place": i,
                "place_id": str(places.iloc[i]["id"]),
                "issued_at": issued.strftime(ISO),
                "valid_from": issued.date().isoformat(),
                "valid_to": (issued.date() + timedelta(days=config.HORIZON_DAYS)).isoformat(),
                "trigger": str(RNG.choice(["category_up", "z_above_2", "new_anomaly"])),
                "probability": rec.get("p"),
                "severity": rec["severity"],
                "exposure": rec["exposure"],
                "confidence": rec["confidence"],
                "category": rec["category"],
                "evidence": [
                    f"power:{(issued.date() - timedelta(days=3)).isoformat()}",
                    f"firms:{(issued - timedelta(hours=2)).strftime(ISO)}",
                    f"openmeteo:{issued.replace(hour=issued.hour // 6 * 6).strftime(ISO)}",
                ],
                "anomalies": anomalies,
                "explanation": risk["text"][i][h],
                "status": "active" if k < 6 else ("updated" if k < 12 else "expired"),
                "model_version": MODEL_VERSION,
            }
        )
    return {"meta": meta(), "alerts": alerts[: config.FEED_MAX]}


def mock_freshness() -> dict:
    t = NOW
    firms_url = "https://firms.modaps.eosdis.nasa.gov/"
    rows = [
        ("NASA FIRMS", "observation", config.FIRMS_LIVE_SOURCE, 3, 48211, "~3 h", firms_url),
        (
            "NASA POWER",
            "observation",
            "daily point, AG",
            72,
            N * 3650,
            "~3 days",
            "https://power.larc.nasa.gov/",
        ),
        (
            "Open-Meteo",
            "forecast",
            "16-day daily",
            1,
            N * FCST,
            "hourly",
            "https://open-meteo.com/",
        ),
        (
            "NASA GIBS",
            "observation",
            "IMERG · LST · NDVI",
            24,
            None,
            "~1 day",
            "https://gibs.earthdata.nasa.gov/",
        ),
        (
            "Natural Earth",
            "observation",
            "ne_10m_populated_places",
            6,
            N,
            "static",
            "https://www.naturalearthdata.com/",
        ),
    ]
    return {
        "meta": meta(),
        "sources": [
            {
                "name": name,
                "kind": kind,
                "product": product,
                "valid_for": (t - timedelta(hours=age_h)).strftime(ISO),
                "retrieved_at": (t - timedelta(minutes=int(RNG.integers(5, 40)))).strftime(ISO),
                "records": records,
                "latency_doc": latency,
                "status": "ok",
                "url": url,
            }
            for name, kind, product, age_h, records, latency, url in rows
        ],
    }


def mock_honesty() -> dict:
    edges = [0, 0.05, 0.1, 0.2, 0.35, 0.5, 1.0]
    buckets = []
    for lo, hi in itertools.pairwise(edges):
        pred = (lo + hi) / 2
        buckets.append(
            {
                "lo": lo,
                "hi": hi,
                "n": int(RNG.integers(20, 1500) * (1 if lo < 0.3 else 0.2) + 5),
                "pred": r3(pred),
                "obs": r3(max(0.0, pred + RNG.normal(0, pred * 0.25 + 0.01))),
            }
        )
    runs = []
    for k in range(10):
        ok = bool(RNG.random() > 0.1)
        runs.append(
            {
                "run_id": (NOW - timedelta(hours=3 * k)).strftime(config.RUN_ID_FORMAT),
                "ok": ok,
                "failed_gate": None if ok else str(RNG.choice(["G3_freshness", "G4_sanity"])),
                "duration_s": int(RNG.integers(300, 800)),
            }
        )
    return {
        "meta": meta(),
        "mode": "hindcast",
        "window": [
            (TODAY - timedelta(weeks=config.HOLDOUT_WEEKS)).isoformat(),
            (TODAY - timedelta(days=1)).isoformat(),
        ],
        "buckets": buckets,
        "top20_hit_rate": 0.45,
        "baseline_top20_hit_rate": 0.25,
        "runs": runs,
    }


def mock_run(n_places: int) -> dict:
    started = NOW - timedelta(minutes=9)
    return {
        "run_id": RUN_ID,
        "tier": config.PLACE_TIER,
        "n_places": n_places,
        "started": started.strftime(ISO_S),
        "finished": NOW.strftime(ISO_S),
        "duration_s": 540,
        "gates": {
            "G1_time": {"value": 540, "pass": True},
            "G2_coverage": {"value": 0.995, "pass": True},
            "G3_freshness": {"value": 3.1, "pass": True},
            "G4_sanity": {"value": 48211, "pass": True},
            "G5_model": {"value": 0.31, "pass": True},
            "G6_output": {"value": 4.2, "pass": True},
            "G7_deploy": {"value": None, "pass": None},
        },
        "ok": True,
        "metrics": {"pr_auc": 0.31, "baseline_pr_auc": 0.19, "brier": 0.041},
    }


def write(name: str, payload: dict, out_dir: Path) -> None:
    path = out_dir / name
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"  {name:16} {path.stat().st_size / 1024:8.1f} KB")


def main(out_dir: Path = config.DASHBOARD_DATA_DIR) -> None:
    if not config.PLACES_PARQUET.exists():
        raise SystemExit(f"{config.PLACES_PARQUET} missing; run places/build_places.py first")
    places = pd.read_parquet(config.PLACES_PARQUET).head(N).reset_index(drop=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"mock data for {len(places)} places → {out_dir}")
    risk = aggregate.attach(places, mock_risk(places))
    write("places.json", mock_places(places), out_dir)
    write("trends.json", mock_trends(places), out_dir)
    write("risk.json", risk, out_dir)
    write("series.json", mock_series(places), out_dir)
    write("fires_24h.json", mock_fires(places), out_dir)
    write("feed.json", mock_feed(places, risk), out_dir)
    write("freshness.json", mock_freshness(), out_dir)
    write("honesty.json", mock_honesty(), out_dir)
    write("run.json", mock_run(len(places)), out_dir)


if __name__ == "__main__":
    main()
