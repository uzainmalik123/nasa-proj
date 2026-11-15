"""Stage ``publish``: write the science outputs per docs/contracts.md §3.

  places.json   from ``ctx["places"]`` (places.parquet order, the index every file shares)
  risk.json     ``ctx["risk"]`` from the hazards stage, plus ``movers`` and ``continents``
                (publish/aggregate.py, derived from ``now`` and ``history``)
  series.json   ``ctx["series"]``
  feed.json     alerts (publish/feed.py), persisted across runs via the previous file
  honesty.json  mode "hindcast" from the held-out wildfire metrics + the run ledger

Every per-place array is checked for one entry per place and the fixed
lengths (90 history days, 16 forecast days); probabilities must be in [0, 1]
and ``now`` must not contain NaN. ``trends.json`` and ``freshness.json`` are
written by their own stages; ``fires_24h.json`` and ``run.json`` are S1's.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

import config
from publish import aggregate
from publish.write_json import meta, write_json

log = logging.getLogger("publish")

RUNS_MAX = 10
ISO_MIN = "%Y-%m-%dT%H:%MZ"


def _read(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text()) if path.exists() else None
    except (OSError, ValueError) as e:
        log.warning("could not read %s: %s", path, e)
        return None


def validate_risk(risk: dict, n: int) -> None:
    now = risk["now"]
    if len(now) != n:
        raise ValueError(f"risk.now has {len(now)} entries, expected {n}")
    for i, rec in enumerate(now):
        for h in config.HAZARDS:
            r = rec[h]
            for k, v in r.items():
                if isinstance(v, float) and not np.isfinite(v):
                    raise ValueError(f"risk.now[{i}].{h}.{k} is NaN")
            if "p" in r and not (0.0 <= r["p"] <= 1.0):
                raise ValueError(f"risk.now[{i}].{h}.p = {r['p']} outside [0, 1]")
            if (
                r["category"] not in config.CATEGORIES
                or r["confidence"] not in config.CONFIDENCE_LEVELS
            ):
                raise ValueError(f"risk.now[{i}].{h}: bad category/confidence {r}")
    if len(risk["history_days"]) != config.HISTORY_DAYS:
        raise ValueError("history_days length")
    for h in config.HAZARDS:
        if any(len(row) != config.HISTORY_DAYS for row in risk["history"][h]):
            raise ValueError(f"history.{h}: a row is not {config.HISTORY_DAYS} long")
    if len(risk["forecast_days"]) != config.FORECAST_DAYS:
        raise ValueError("forecast_days length")
    if any(len(row) != config.FORECAST_DAYS for row in risk["fwi_forecast"]):
        raise ValueError("fwi_forecast: a row is not 16 long")
    for h in ("wildfire", "rain"):
        vals = [v for row in risk["history"][h] for v in row if v is not None]
        if vals and (min(vals) < 0 or max(vals) > 1):
            raise ValueError(f"history.{h} outside [0, 1]")
    p = np.array([r["wildfire"]["p"] for r in now])
    if p.std() <= config.G4_MIN_RISK_STD:
        log.warning("wildfire p std %.4f is below the G4 threshold", p.std())


def validate_series(series: dict, n: int) -> None:
    if len(series["days"]) != config.HISTORY_DAYS:
        raise ValueError("series.days length")
    for k, rows in series.items():
        if k == "days":
            continue
        if len(rows) != n or any(len(r) != config.HISTORY_DAYS for r in rows):
            raise ValueError(f"series.{k}: expected {n} rows of {config.HISTORY_DAYS}")


def run(ctx: dict) -> None:
    from publish import feed

    log.info("stage publish · run %s", ctx["run_id"])
    t0 = time.perf_counter()
    data_dir = Path(ctx.get("data_dir", config.DATA_DIR))
    out_dir = data_dir / "out"
    places = ctx["places"]
    n = len(places)
    started: datetime = ctx.get("started") or datetime.now(UTC)
    today = started.date()
    m = meta(ctx)

    # places.json
    # S1 M9 (contracts change log 2026-11-15): + ``tier``, "pk" for the Pakistan rows, null else
    cols = ["id", "name", "country", "continent", "lat", "lon", "pop", "radius_km", "capital"]
    frame = places.assign(tier=places["tier"] if "tier" in places else None)[[*cols, "tier"]]
    frame = frame.astype(object)
    recs = frame.where(frame.notna(), None).to_dict(orient="records")
    write_json(
        "places.json", {"meta": m, "places": recs}, out_dir, n_places=n, per_place=["places"]
    )

    # risk.json
    risk = aggregate.attach(places, ctx["risk"])
    validate_risk(risk, n)
    aggregate.validate(risk, n)
    write_json(
        "risk.json",
        {"meta": m, **risk},
        out_dir,
        n_places=n,
        per_place=[
            "now",
            "drivers",
            "text",
            "fwi_forecast",
            *[f"history.{h}" for h in config.HAZARDS],
        ],
    )

    # series.json
    series = ctx["series"]
    validate_series(series, n)
    write_json(
        "series.json",
        {"meta": m, **series},
        out_dir,
        n_places=n,
        per_place=[k for k in series if k != "days"],
    )

    # feed.json
    previous = _read(out_dir / "feed.json")
    if previous is not None and previous.get("meta", {}).get("run_id") == ctx["run_id"]:
        previous = None
    evidence = _evidence(_read(out_dir / "freshness.json"), ctx)
    alerts = feed.build(
        places,
        risk,
        ctx["zscores"],
        ctx["zdays"],
        today,
        started,
        risk["model"]["version"],
        evidence,
        previous,
    )
    write_json("feed.json", {"meta": m, "alerts": alerts}, out_dir)

    # honesty.json
    prev_h = _read(out_dir / "honesty.json")
    runs = [r for r in (prev_h or {}).get("runs", []) if r.get("run_id") != ctx["run_id"]]
    runs.insert(
        0,
        {
            "run_id": ctx["run_id"],
            "ok": bool(ctx.get("ok", True)),
            "failed_gate": None,
            "duration_s": int((datetime.now(UTC) - started).total_seconds()),
        },
    )
    hc = ctx["honesty"]
    honesty = {
        "meta": m,
        "mode": "hindcast",
        "window": hc["window"],
        "buckets": hc["buckets"],
        "top20_hit_rate": hc["top20_hit_rate"],
        "baseline_top20_hit_rate": hc["baseline_top20_hit_rate"],
        "runs": runs[:RUNS_MAX],
    }
    write_json("honesty.json", honesty, out_dir)
    log.info("stage publish · %.1fs", time.perf_counter() - t0)


def _evidence(freshness: dict | None, ctx: dict) -> list[str]:
    """['power:<valid_for>', 'firms:<valid_for>', 'openmeteo:<valid_for>'] from freshness.json."""
    keys = {"NASA POWER": "power", "NASA FIRMS": "firms", "Open-Meteo": "openmeteo"}
    out: dict[str, str] = {}
    for row in (freshness or {}).get("sources", []):
        tag = keys.get(row.get("name", ""))
        if tag and row.get("valid_for"):
            out[tag] = f"{tag}:{row['valid_for']}"
    if "power" not in out:
        inputs = ctx.get("inputs") or []
        last = max((p.last_obs for p in inputs if p.last_obs), default=None)
        if last:
            out["power"] = f"power:{last.isoformat()}"
    return [out[k] for k in ("power", "firms", "openmeteo") if k in out]
