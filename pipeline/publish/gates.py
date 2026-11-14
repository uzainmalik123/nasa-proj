"""Stage ``gates``: grade the run against PRD §13.1 and write ``run.json``.

Runs last, even after an earlier stage raised, so every run leaves a
``run.json`` (contracts §3) that says what passed:

  G1 time       incremental < 15 min, cold run (no POWER cache at start) < 60 min
  G2 coverage   ≥ 98 % of places with POWER through 4 days ago, a full 16-day
                forecast and a FIRMS count
  G3 freshness  FIRMS ≤ 6 h, POWER ≤ 4 days, forecast ≤ 12 h (freshness.json)
  G4 sanity     FIRMS live rows > 1,000, risks in [0, 1], no NaN, wildfire p std
                across places > 0.01, trend p in [0, 1]
  G5 model      held-out PR-AUC above the fire-weather baseline, Brier at or below it
  G6 output     every JSON under 5 MB, every file from this run and newer than
                the previous run
  G7 deploy     null here; the workflow checks the live run.json after the push

Each gate is ``{"value", "pass", "detail"}`` (``detail`` is additive to the
contract). ``ctx["ok"]`` becomes False on any failed gate, so ``run.py`` exits
non-zero and the workflow skips the data push and the deploy. On success the
risk actually published is snapshotted to ``cache/published/{run_id}.parquet``
for the day-2 honesty check, and ``honesty.json`` ``runs[0]`` gets the final
ok / failed_gate / duration_s (last 10 kept).

    uv run python -m publish.gates [--data-dir D]   # standalone, from the files on disk
"""

from __future__ import annotations

import json
import logging
import time
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

import config
from publish.write_json import clean

log = logging.getLogger("gates")

ISO_MIN = "%Y-%m-%dT%H:%MZ"
RUNS_MAX = 10
PUBLISHED = [
    "places.json",
    "trends.json",
    "risk.json",
    "series.json",
    "fires_24h.json",
    "feed.json",
    "freshness.json",
    "honesty.json",
]
GATE_NAMES = [
    "G1_time",
    "G2_coverage",
    "G3_freshness",
    "G4_sanity",
    "G5_model",
    "G6_output",
    "G7_deploy",
]


def _now() -> datetime:
    return datetime.now(UTC)


def _gate(value, ok: bool | None, detail: str) -> dict:
    v = None if value is None else float(value)
    if v is not None and not np.isfinite(v):
        v = None
    return {"value": v, "pass": ok, "detail": detail}


def _read(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text()) if path.exists() else None
    except (OSError, ValueError) as e:
        log.warning("could not read %s: %s", path, e)
        return None


def _parse_ts(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        if len(s) == 10:  # a date
            return datetime.fromisoformat(s).replace(tzinfo=UTC)
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError:
        return None


# ---- gates -------------------------------------------------------------------


def g1_time(duration_s: float, cold: bool) -> dict:
    limit = config.G1_COLD_MAX_S if cold else config.G1_INCREMENTAL_MAX_S
    kind = "cold" if cold else "incremental"
    return _gate(round(duration_s, 1), duration_s < limit, f"{kind} run, limit {limit} s")


def g2_coverage(places: pd.DataFrame | None, data_dir: Path, today: date, run_id: str) -> dict:
    if places is None or len(places) == 0:
        return _gate(0.0, False, "no places")
    ids = places["id"].tolist()
    n = len(ids)
    cache = data_dir / "cache"
    # POWER through 4 days ago
    power_cut = today - timedelta(days=config.G3_POWER_MAX_AGE_D)
    power_ok: set[str] = set()
    for pid in ids:
        p = cache / "power" / f"{pid}.parquet"
        if not p.exists():
            continue
        try:
            d = pd.read_parquet(p, columns=["date"])["date"]
        except Exception:
            continue
        if len(d) and pd.Timestamp(d.max()).date() >= power_cut:
            power_ok.add(pid)
    # a full forecast: a value on all FORECAST_DAYS days from today, from this run's file
    fc_ok: set[str] = set()
    fdir = cache / "forecast"
    fpath = fdir / f"{run_id}.parquet"
    if not fpath.exists() and fdir.exists():
        files = sorted(fdir.glob("*.parquet"))
        fpath = files[-1] if files else fpath
    if fpath.exists():
        fc = pd.read_parquet(fpath, columns=["place_id", "date", "tmax"])
        fc = fc[(pd.to_datetime(fc["date"]).dt.date >= today) & fc["tmax"].notna()]
        cnt = fc.groupby("place_id").size()
        fc_ok = set(cnt[cnt >= config.FORECAST_DAYS].index)
    # a FIRMS count on the newest counted date
    firms_ok: set[str] = set()
    cpath = cache / "firms_counts.parquet"
    if cpath.exists():
        fc_counts = pd.read_parquet(cpath, columns=["place_id", "date"])
        if len(fc_counts):
            newest = fc_counts["date"].max()
            firms_ok = set(fc_counts.loc[fc_counts["date"] == newest, "place_id"])
    full = [pid for pid in ids if pid in power_ok and pid in fc_ok and pid in firms_ok]
    frac = len(full) / n
    detail = (
        f"{len(full)}/{n} places complete · power {len(power_ok)} · "
        f"forecast {len(fc_ok)} ({fpath.name if fpath.exists() else 'missing'}) · "
        f"firms {len(firms_ok)}"
    )
    return _gate(round(frac, 4), frac >= config.G2_MIN_COVERAGE, detail)


def g3_freshness(freshness: dict | None, now: datetime) -> dict:
    if not freshness:
        return _gate(None, False, "freshness.json missing")
    rows = {r.get("name"): r for r in freshness.get("sources", [])}
    firms = _parse_ts((rows.get("NASA FIRMS") or {}).get("valid_for"))
    power = _parse_ts((rows.get("NASA POWER") or {}).get("valid_for"))
    om = _parse_ts((rows.get("Open-Meteo") or {}).get("retrieved_at"))
    firms_h = (now - firms).total_seconds() / 3600 if firms else None
    power_d = (now.date() - power.date()).days if power else None
    om_h = (now - om).total_seconds() / 3600 if om else None
    ok = (
        firms_h is not None
        and firms_h <= config.G3_FIRMS_MAX_AGE_H
        and power_d is not None
        and power_d <= config.G3_POWER_MAX_AGE_D
        and om_h is not None
        and om_h <= config.G3_FORECAST_MAX_AGE_H
    )
    f = lambda v, u: "missing" if v is None else f"{v:.1f} {u}"  # noqa: E731
    detail = (
        f"firms {f(firms_h, 'h')} (≤ {config.G3_FIRMS_MAX_AGE_H} h) · "
        f"power {f(power_d, 'd')} (≤ {config.G3_POWER_MAX_AGE_D} d) · "
        f"forecast {f(om_h, 'h')} (≤ {config.G3_FORECAST_MAX_AGE_H} h)"
    )
    return _gate(None if firms_h is None else round(firms_h, 2), bool(ok), detail)


def _finite_in_unit(vals) -> tuple[bool, bool]:
    """(no NaN, all within [0, 1]) over a flat list that may hold None."""
    arr = np.array([v for v in vals if v is not None], dtype="float64")
    if arr.size == 0:
        return True, True
    finite = bool(np.isfinite(arr).all())
    return finite, bool(finite and arr.min() >= 0.0 and arr.max() <= 1.0)


def g4_sanity(firms_rows: int | None, risk: dict | None, trends: dict | None) -> dict:
    problems: list[str] = []
    std = None
    if firms_rows is None or firms_rows <= config.G4_FIRMS_MIN_ROWS:
        problems.append(f"firms rows {firms_rows} ≤ {config.G4_FIRMS_MIN_ROWS}")
    if not risk or "now" not in risk:
        problems.append("risk missing")
    else:
        now_rows = risk["now"]
        nan = False
        for rec in now_rows:
            for h in config.HAZARDS:
                for v in (rec.get(h) or {}).values():
                    if isinstance(v, float) and not np.isfinite(v):
                        nan = True
        if nan:
            problems.append("NaN in risk.now")
        for h in ("wildfire", "rain"):
            p = [rec[h].get("p") for rec in now_rows if h in rec]
            _, unit = _finite_in_unit(p)
            if not unit:
                problems.append(f"{h} p outside [0, 1]")
            hist = [v for row in (risk.get("history") or {}).get(h, []) for v in row]
            _, unit = _finite_in_unit(hist)
            if not unit:
                problems.append(f"history.{h} outside [0, 1]")
        wp = np.array([rec["wildfire"]["p"] for rec in now_rows], dtype="float64")
        std = float(wp.std()) if wp.size else 0.0
        if not std > config.G4_MIN_RISK_STD:
            problems.append(f"wildfire p std {std:.4f} ≤ {config.G4_MIN_RISK_STD}")
    if not trends:
        problems.append("trends missing")
    else:
        for w in ("long", "short"):
            pv = [v for row in (trends.get(w) or {}).get("p", []) for v in row]
            _, unit = _finite_in_unit(pv)
            if not unit:
                problems.append(f"trends.{w}.p outside [0, 1]")
    detail = (
        "; ".join(problems)
        if problems
        else (f"firms rows {firms_rows} · wildfire p std {std:.4f} · risks and trend p in [0, 1]")
    )
    return _gate(None if std is None else round(std, 4), not problems, detail)


def g5_model(metrics: dict | None) -> dict:
    if not metrics or "pr_auc" not in metrics:
        return _gate(None, False, "metrics missing")
    pr, base = float(metrics["pr_auc"]), float(metrics.get("baseline_pr_auc", np.nan))
    brier = float(metrics.get("brier", np.nan))
    base_brier = metrics.get("baseline_brier")
    ok = np.isfinite(pr) and np.isfinite(base) and pr > base and np.isfinite(brier)
    detail = f"PR-AUC {pr:.3f} vs baseline {base:.3f} · Brier {brier:.4f}"
    if base_brier is not None:
        ok = ok and brier <= float(base_brier)
        detail += f" vs baseline {float(base_brier):.4f}"
    return _gate(round(pr, 4), bool(ok), detail)


def g6_output(out_dir: Path, run_id: str, prev: dict | None) -> dict:
    problems: list[str] = []
    prev_started = _parse_ts((prev or {}).get("started"))
    biggest = 0.0
    for name in PUBLISHED:
        p = out_dir / name
        if not p.exists():
            problems.append(f"{name} missing")
            continue
        mb = p.stat().st_size / 1e6
        biggest = max(biggest, mb)
        if p.stat().st_size > config.G6_JSON_MAX_BYTES:
            problems.append(f"{name} {mb:.1f} MB")
        m = (_read(p) or {}).get("meta") or {}
        if m.get("run_id") != run_id:
            problems.append(f"{name} from run {m.get('run_id')}")
        gen = _parse_ts(m.get("generated_at"))
        if prev_started and gen and gen <= prev_started:
            problems.append(f"{name} generated_at {m.get('generated_at')} not after previous run")
    detail = (
        "; ".join(problems)
        if problems
        else (
            f"{len(PUBLISHED)} files · largest {biggest:.2f} MB"
            + (f" · previous run {prev.get('run_id')}" if prev else " · first run")
        )
    )
    return _gate(round(biggest, 3), not problems, detail)


# ---- side outputs ------------------------------------------------------------


def snapshot(places: pd.DataFrame, risk: dict, run_id: str, cache_dir: Path) -> Path:
    """``cache/published/{run_id}.parquet``: one flat row per place of the risk published."""
    rows = []
    for pid, rec in zip(places["id"], risk["now"], strict=True):
        r = {"run_id": run_id, "place_id": pid, "valid_from": risk["valid_from"],
             "valid_to": risk["valid_to"]}  # fmt: skip
        for h in config.HAZARDS:
            for k, v in rec[h].items():
                r[f"{h}_{k}"] = v
        rows.append(r)
    df = pd.DataFrame(rows)
    df["model_version"] = risk["model"]["version"]
    pdir = cache_dir / "published"
    pdir.mkdir(parents=True, exist_ok=True)
    path = pdir / f"{run_id}.parquet"
    df.to_parquet(path, index=False)
    return path


def update_honesty(out_dir: Path, entry: dict) -> bool:
    """Put ``entry`` at runs[0] of honesty.json (replacing the same run_id), keep 10."""
    path = out_dir / "honesty.json"
    h = _read(path)
    if h is None:
        return False
    runs = [r for r in h.get("runs", []) if r.get("run_id") != entry["run_id"]]
    h["runs"] = [entry, *runs][:RUNS_MAX]
    path.write_text(json.dumps(clean(h), ensure_ascii=False, separators=(",", ":")) + "\n")
    return True


# ---- stage -------------------------------------------------------------------


def run(ctx: dict) -> dict:
    t0 = time.perf_counter()
    run_id = ctx["run_id"]
    log.info("stage gates · run %s", run_id)
    data_dir = Path(ctx.get("data_dir", config.DATA_DIR))
    out_dir = data_dir / "out"
    cache_dir = data_dir / "cache"
    out_dir.mkdir(parents=True, exist_ok=True)
    now = _now()
    started: datetime = ctx.get("started") or now
    today = started.date()
    prev = _read(out_dir / "run.json")
    if prev and prev.get("run_id") == run_id:
        prev = None

    places = ctx.get("places")
    if places is None and (data_dir / "places.parquet").exists():
        places = pd.read_parquet(data_dir / "places.parquet")
    freshness = ctx.get("freshness") or _read(out_dir / "freshness.json")
    risk = ctx.get("risk") or _read(out_dir / "risk.json")
    trends = ctx.get("trends") or _read(out_dir / "trends.json")
    metrics = ctx.get("metrics") or _read(data_dir / "model" / "metrics.json")
    firms_rows = None
    live = (ctx.get("ingest") or {}).get("firms", {}).get("live")
    if live:
        firms_rows = live.get("rows_24h")
    elif freshness:
        rows = freshness.get("sources", [])
        firms_rows = next((r.get("records") for r in rows if r.get("name") == "NASA FIRMS"), None)

    duration = (now - started).total_seconds()
    gates = {
        "G1_time": g1_time(duration, bool(ctx.get("cold", False))),
        "G2_coverage": g2_coverage(places, data_dir, today, run_id),
        "G3_freshness": g3_freshness(freshness, now),
        "G4_sanity": g4_sanity(firms_rows, risk, trends),
        "G5_model": g5_model(metrics),
        "G6_output": g6_output(out_dir, run_id, prev),
        "G7_deploy": _gate(None, None, "checked by the workflow against the live run.json"),
    }
    failed = [k for k, g in gates.items() if g["pass"] is False]
    failed_stage = ctx.get("failed_stage")
    ok = bool(ctx.get("ok", True)) and not failed
    failed_gate = failed[0] if failed else None
    ctx["ok"] = ok
    ctx["failed_gate"] = failed_gate

    finished = _now()
    duration_s = int((finished - started).total_seconds())
    m = metrics or {}
    body = {
        "run_id": run_id,
        "tier": int(ctx.get("tier", config.PLACE_TIER)),
        "n_places": len(places) if places is not None else 0,
        "started": started.astimezone(UTC).strftime(ISO_MIN),
        "finished": finished.strftime(ISO_MIN),
        "duration_s": duration_s,
        "gates": gates,
        "ok": ok,
        "metrics": {
            "pr_auc": m.get("pr_auc"),
            "baseline_pr_auc": m.get("baseline_pr_auc"),
            "brier": m.get("brier"),
        },
        # additive to contracts §3
        "failed_gate": failed_gate,
        "failed_stage": failed_stage,
        "cold": bool(ctx.get("cold", False)),
        "timings": ctx.get("timings", {}),
    }
    (out_dir / "run.json").write_text(
        json.dumps(clean(body), ensure_ascii=False, separators=(",", ":")) + "\n"
    )
    ledger = {"run_id": run_id, "ok": ok, "failed_gate": failed_gate, "duration_s": duration_s}
    if not update_honesty(out_dir, ledger):
        log.warning("honesty.json missing; run ledger not updated")
    if ok and places is not None and risk:
        path = snapshot(places, risk, run_id, cache_dir)
        log.info("published snapshot → %s", path)

    for k, g in gates.items():
        mark = {True: "PASS", False: "FAIL", None: "skip"}[g["pass"]]
        log.info("%-12s %s  value=%s  %s", k, mark, g["value"], g["detail"])
    log.info(
        "stage gates · %.1fs · ok=%s%s%s",
        time.perf_counter() - t0,
        ok,
        f" · failed gate {failed_gate}" if failed_gate else "",
        f" · failed stage {failed_stage}" if failed_stage else "",
    )
    return body


if __name__ == "__main__":  # uv run python -m publish.gates [--data-dir D] [--run-id R]
    import argparse
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default=str(config.DATA_DIR))
    ap.add_argument("--run-id", default=None)
    ap.add_argument("--cold", action="store_true")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    d = Path(a.data_dir)
    risk_meta = ((_read(d / "out" / "risk.json") or {}).get("meta")) or {}
    rid = a.run_id or risk_meta.get("run_id") or datetime.now(UTC).strftime(config.RUN_ID_FORMAT)
    started = _parse_ts(risk_meta.get("generated_at")) or datetime.now(UTC)
    ctx = {"run_id": rid, "started": started, "tier": config.PLACE_TIER, "data_dir": str(d),
           "cold": a.cold, "ok": True, "timings": {}}  # fmt: skip
    out = run(ctx)
    print(json.dumps({k: out[k] for k in ("run_id", "ok", "failed_gate", "duration_s")}))
    raise SystemExit(0 if out["ok"] else 1)
