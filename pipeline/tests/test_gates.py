"""Gates on a tiny synthetic run: 3 places, every file present, then each gate broken in turn."""

import json
from datetime import UTC, datetime, timedelta

import numpy as np
import pandas as pd
import pytest

import config
from publish import gates

RUN = "20261114T1200Z"
N = 3


def _write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj))


@pytest.fixture
def world(tmp_path):
    now = datetime(2026, 11, 14, 12, 10, tzinfo=UTC)  # the patched gates._now
    today = now.date()
    d = tmp_path
    ids = ["a-aa", "b-bb", "c-cc"]
    places = pd.DataFrame({"id": ids, "lat": [1.0, 2.0, 3.0], "lon": [1.0, 2.0, 3.0]})
    # caches
    for pid in ids:
        dates = pd.date_range(end=today - timedelta(days=3), periods=30).date
        pd.DataFrame({"date": dates, "t2m": 20.0}).to_parquet(
            d / "cache" / "power" / f"{pid}.parquet", index=False
        ) if (d / "cache" / "power").mkdir(parents=True, exist_ok=True) is None else None
    fc_rows = []
    for pid in ids:
        for k in range(-5, config.FORECAST_DAYS):
            fc_rows.append({"place_id": pid, "date": today + timedelta(days=k), "tmax": 25.0})
    (d / "cache" / "forecast").mkdir(parents=True)
    pd.DataFrame(fc_rows).to_parquet(d / "cache" / "forecast" / f"{RUN}.parquet", index=False)
    pd.DataFrame(
        {"place_id": ids * 2, "date": [today - timedelta(days=1)] * 3 + [today] * 3, "n": 0}
    ).to_parquet(d / "cache" / "firms_counts.parquet", index=False)
    # published files
    meta = {"run_id": RUN, "generated_at": "2026-11-14T12:05:00Z", "tier": 1}
    freshness = {
        "meta": meta,
        "sources": [
            {"name": "NASA FIRMS", "valid_for": "2026-11-14T10:00Z", "records": 5000},
            {"name": "NASA POWER", "valid_for": (today - timedelta(days=3)).isoformat()},
            {"name": "Open-Meteo", "retrieved_at": "2026-11-14T12:01Z"},
        ],
    }
    risk = {
        "meta": meta,
        "valid_from": today.isoformat(),
        "valid_to": (today + timedelta(days=14)).isoformat(),
        "now": [
            {
                "wildfire": {"p": p, "severity": 0.5, "exposure": 1, "confidence": "high", "category": "low"},
                "drought": {"index": -0.2, "severity": 0.1, "exposure": 1, "confidence": "high", "category": "low"},
                "heat": {"days_above": 0, "severity": 0.0, "exposure": 1, "confidence": "high", "category": "low"},
                "rain": {"p": 0.1, "severity": 1.0, "exposure": 1, "confidence": "high", "category": "low"},
            }
            for p in (0.1, 0.5, 0.9)
        ],
        "history": {"wildfire": [[0.1, 0.2]] * N, "rain": [[0.0, 1.0]] * N},
        "model": {"version": "2026-11-14T12:00Z"},
    }  # fmt: skip
    trends = {"meta": meta, "long": {"p": [[0.01, None]] * N}, "short": {"p": [[0.5, 1.0]] * N}}
    for name in gates.PUBLISHED:
        _write(d / "out" / name, {"meta": meta})
    _write(d / "out" / "freshness.json", freshness)
    _write(d / "out" / "risk.json", risk)
    _write(d / "out" / "trends.json", trends)
    _write(
        d / "out" / "honesty.json",
        {"meta": meta, "runs": [{"run_id": RUN, "ok": True, "failed_gate": None, "duration_s": 1}]},
    )
    _write(d / "out" / "run.json", {"run_id": "20261114T0900Z", "started": "2026-11-14T09:00Z"})
    metrics = {"pr_auc": 0.6, "baseline_pr_auc": 0.4, "brier": 0.1, "baseline_brier": 0.2}
    ctx = {
        "run_id": RUN, "started": now - timedelta(seconds=600), "tier": 1, "data_dir": str(d),
        "places": places, "freshness": freshness, "risk": risk, "trends": trends,
        "metrics": metrics, "ok": True, "timings": {"ingest": 1.0},
        "ingest": {"firms": {"live": {"rows_24h": 5000}}},
    }  # fmt: skip
    return d, ctx


def test_green_run(world, monkeypatch):
    d, ctx = world
    monkeypatch.setattr(gates, "_now", lambda: datetime(2026, 11, 14, 12, 10, tzinfo=UTC))
    body = gates.run(ctx)
    assert body["ok"] is True and ctx["ok"] is True and body["failed_gate"] is None
    assert [g for g, v in body["gates"].items() if v["pass"] is False] == []
    assert body["gates"]["G7_deploy"]["pass"] is None
    assert body["n_places"] == N and body["metrics"]["pr_auc"] == 0.6
    run = json.loads((d / "out" / "run.json").read_text())
    assert run["run_id"] == RUN and run["ok"] is True
    runs = json.loads((d / "out" / "honesty.json").read_text())["runs"]
    assert runs[0] == {"run_id": RUN, "ok": True, "failed_gate": None, "duration_s": 600}
    snap = pd.read_parquet(d / "cache" / "published" / f"{RUN}.parquet")
    assert list(snap["place_id"]) == ["a-aa", "b-bb", "c-cc"]
    assert snap["wildfire_p"].tolist() == [0.1, 0.5, 0.9] and snap["drought_index"].iloc[0] == -0.2


@pytest.mark.parametrize(
    "mutate, gate",
    [
        (lambda c: c.update(started=c["started"] - timedelta(seconds=400)), "G1_time"),
        (lambda c: (c["cache"] / "power" / "a-aa.parquet").unlink(), "G2_coverage"),
        (lambda c: c["freshness"]["sources"][0].update(valid_for="2026-11-14T02:00Z"), "G3_freshness"),
        (lambda c: c["ingest"]["firms"]["live"].update(rows_24h=10), "G4_sanity"),
        (lambda c: [r["wildfire"].update(p=0.3) for r in c["risk"]["now"]], "G4_sanity"),
        (lambda c: c["risk"]["now"][0]["rain"].update(p=1.5), "G4_sanity"),
        (lambda c: c["trends"]["long"]["p"][0].__setitem__(0, 2.0), "G4_sanity"),
        (lambda c: c["metrics"].update(pr_auc=0.3), "G5_model"),
        (lambda c: c["metrics"].update(brier=0.3), "G5_model"),
        (lambda c: (c["out"] / "series.json").unlink(), "G6_output"),
        (lambda c: _write(c["out"] / "feed.json", {"meta": {"run_id": "old", "generated_at": "2026-11-14T08:00:00Z"}}), "G6_output"),
    ],
)  # fmt: skip
def test_each_gate_fails(world, monkeypatch, mutate, gate):
    d, ctx = world
    monkeypatch.setattr(gates, "_now", lambda: datetime(2026, 11, 14, 12, 10, tzinfo=UTC))
    ctx["cache"], ctx["out"] = d / "cache", d / "out"
    mutate(ctx)
    body = gates.run(ctx)
    assert body["gates"][gate]["pass"] is False, body["gates"][gate]
    assert body["ok"] is False and ctx["ok"] is False and body["failed_gate"] == gate
    assert not (d / "cache" / "published" / f"{RUN}.parquet").exists()
    runs = json.loads((d / "out" / "honesty.json").read_text())["runs"]
    assert runs[0]["ok"] is False and runs[0]["failed_gate"] == gate


def test_cold_run_budget(world, monkeypatch):
    d, ctx = world
    monkeypatch.setattr(gates, "_now", lambda: datetime(2026, 11, 14, 12, 10, tzinfo=UTC))
    ctx["started"] -= timedelta(seconds=1800)
    ctx["cold"] = True
    assert gates.run(ctx)["gates"]["G1_time"]["pass"] is True


def test_failed_stage_still_writes_run_json(world, monkeypatch):
    d, ctx = world
    monkeypatch.setattr(gates, "_now", lambda: datetime(2026, 11, 14, 12, 10, tzinfo=UTC))
    ctx.update(ok=False, failed_stage="hazards")
    body = gates.run(ctx)
    assert body["ok"] is False and body["failed_stage"] == "hazards"
    assert json.loads((d / "out" / "run.json").read_text())["failed_stage"] == "hazards"


def test_nan_in_risk(world, monkeypatch):
    d, ctx = world
    monkeypatch.setattr(gates, "_now", lambda: datetime(2026, 11, 14, 12, 10, tzinfo=UTC))
    ctx["risk"]["now"][1]["heat"]["severity"] = float(np.nan)
    assert gates.run(ctx)["failed_gate"] == "G4_sanity"


def _null_forecast_day(d, offset, places=("a-aa", "b-bb", "c-cc")):
    """Blank tmax on today+offset for the given places in this run's forecast file."""
    path = d / "cache" / "forecast" / f"{RUN}.parquet"
    fc = pd.read_parquet(path)
    target = datetime(2026, 11, 14, tzinfo=UTC).date() + timedelta(days=offset)
    hit = (pd.to_datetime(fc["date"]).dt.date == target) & fc["place_id"].isin(places)
    assert hit.sum() == len(places)
    fc.loc[hit, "tmax"] = np.nan
    fc.to_parquet(path, index=False)


def test_g2_tolerates_null_forecast_tail(world, monkeypatch):
    """Open-Meteo has no day 16 (today+15) from any model early in the UTC day; the hazards
    only read today and the next HORIZON_DAYS, so that tail must not fail the run."""
    d, ctx = world
    monkeypatch.setattr(gates, "_now", lambda: datetime(2026, 11, 14, 12, 10, tzinfo=UTC))
    _null_forecast_day(d, config.FORECAST_DAYS - 1)
    body = gates.run(ctx)
    assert body["gates"]["G2_coverage"]["pass"] is True, body["gates"]["G2_coverage"]
    assert body["ok"] is True and body["failed_gate"] is None


@pytest.mark.parametrize("offset", [0, 7, config.HORIZON_DAYS])
def test_g2_fails_on_null_day_inside_horizon(world, monkeypatch, offset):
    """A hole on today or any of the next HORIZON_DAYS days is a real gap, even when the
    place still has 15 of 16 forecast days."""
    d, ctx = world
    monkeypatch.setattr(gates, "_now", lambda: datetime(2026, 11, 14, 12, 10, tzinfo=UTC))
    _null_forecast_day(d, offset, places=("b-bb",))
    body = gates.run(ctx)
    g = body["gates"]["G2_coverage"]
    assert g["pass"] is False and "forecast 2" in g["detail"], g
    assert body["failed_gate"] == "G2_coverage"
