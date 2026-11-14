from datetime import date, timedelta

import pandas as pd

from ingest import openmeteo


def _frame(pid, today, null_days=()):
    rows = []
    for k in range(-2, 16):
        d = today + timedelta(days=k)
        v = None if k in null_days else 10.0 + k
        rows.append({"place_id": pid, "date": d, **{c: v for c in openmeteo.VALUES}})
    return pd.DataFrame(rows)[openmeteo.SCHEMA]


def test_fill_patches_only_the_null_days(monkeypatch):
    today = date(2026, 11, 14)
    out = pd.concat([_frame("a-aa", today, null_days=(15,)), _frame("b-bb", today)])
    calls = []

    def fake_fetch(batch, pacer, model=None):
        calls.append(([b[0] for b in batch], model))
        return [
            _frame(pid, today).assign(**{c: 99.0 for c in openmeteo.VALUES}) for pid, _, _ in batch
        ]

    monkeypatch.setattr(openmeteo, "fetch_batch", fake_fetch)
    patched, info = openmeteo.fill_missing_days(
        out, [("a-aa", 1.0, 1.0), ("b-bb", 2.0, 2.0)], today, None
    )
    assert calls == [(["a-aa"], openmeteo.FALLBACK_MODEL)]  # only the place with a hole
    assert info == {"places": 1, "rows": 1, "unfilled": 0}
    a = patched[patched.place_id == "a-aa"].set_index("date")
    assert a.loc[today + timedelta(days=15), "tmax"] == 99.0  # the hole, from the fallback
    assert a.loc[today + timedelta(days=14), "tmax"] == 24.0  # untouched
    assert (
        patched[patched.place_id == "b-bb"]["tmax"].tolist()
        == out[out.place_id == "b-bb"]["tmax"].tolist()
    )
    assert openmeteo.missing_forecast_rows(patched, today).empty


def test_fill_noop_when_complete(monkeypatch):
    today = date(2026, 11, 14)
    out = _frame("a-aa", today, null_days=(-2, -1))  # nulls before today are fine
    monkeypatch.setattr(
        openmeteo, "fetch_batch", lambda *a, **k: (_ for _ in ()).throw(AssertionError("no call"))
    )
    patched, info = openmeteo.fill_missing_days(out, [("a-aa", 1.0, 1.0)], today, None)
    assert info["places"] == 0 and patched.equals(out)
