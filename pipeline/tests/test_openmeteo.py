from datetime import UTC, date, datetime, timedelta

import pandas as pd
import pytest

import config
from ingest import openmeteo
from ingest._http import RateLimited


def _frame(pid, today, null_days=(), start=-2, v=10.0):
    rows = []
    for k in range(start, 16):
        d = today + timedelta(days=k)
        val = None if k in null_days else v + k
        rows.append({"place_id": pid, "date": d, **{c: val for c in openmeteo.VALUES}})
    return pd.DataFrame(rows)[openmeteo.SCHEMA]


TODAY = date(2026, 11, 14)
PLACES = pd.DataFrame({"id": ["a-aa", "b-bb"], "lat": [1.0, 2.0], "lon": [1.0, 2.0]})
TRIPLES = [("a-aa", 1.0, 1.0), ("b-bb", 2.0, 2.0)]


def test_fill_patches_only_the_null_days(monkeypatch):
    out = pd.concat([_frame("a-aa", TODAY, null_days=(15,)), _frame("b-bb", TODAY)])
    calls = []

    def fake_fetch(batch, pacer, model=None, past_days=2):
        calls.append(([b[0] for b in batch], model, past_days))
        return [_frame(pid, TODAY, v=99.0 - 0) for pid, _, _ in batch]

    monkeypatch.setattr(openmeteo, "fetch_batch", fake_fetch)
    patched, info = openmeteo.fill_missing_days(out, TRIPLES, TODAY, None)
    assert calls == [(["a-aa"], openmeteo.FALLBACK_MODEL, 0)]  # only the place with a hole
    assert info == {"places": 1, "rows": 1, "unfilled": 0}
    a = patched[patched.place_id == "a-aa"].set_index("date")
    assert a.loc[TODAY + timedelta(days=15), "tmax"] == 99.0 + 15  # the hole, from the fallback
    assert a.loc[TODAY + timedelta(days=14), "tmax"] == 24.0  # untouched
    assert openmeteo.missing_forecast_rows(patched, TODAY).empty


def test_fill_noop_when_complete(monkeypatch):
    out = _frame("a-aa", TODAY, null_days=(-2, -1))  # nulls before today are fine
    monkeypatch.setattr(openmeteo, "fetch_batch", lambda *a, **k: pytest.fail("no call"))
    patched, info = openmeteo.fill_missing_days(out, TRIPLES, TODAY, None)
    assert info["places"] == 0 and patched.equals(out)


def test_merge_history_carries_old_analysis_rows_and_drops_all_null():
    prev = _frame("a-aa", TODAY - timedelta(days=3), start=-92)  # the previous run, 3 days ago
    prev.loc[prev.index[:5], openmeteo.VALUES] = None  # oldest rows all-null, as the API sends
    new = _frame("a-aa", TODAY, start=-2)
    out = openmeteo.merge_history(new, prev, TODAY)
    dates = pd.to_datetime(out["date"]).dt.date
    assert dates.min() == TODAY - timedelta(days=90)  # 5 all-null days dropped, floor is 92
    assert dates.max() == TODAY + timedelta(days=15)
    assert dates.is_unique and (dates >= TODAY - timedelta(days=2)).sum() == 18
    # the overlap days come from the new fetch
    assert out.set_index("date").loc[TODAY - timedelta(days=1), "tmax"] == 9.0
    assert openmeteo.past_coverage(out, TODAY) == 90


@pytest.fixture
def cache(tmp_path, monkeypatch):
    monkeypatch.setattr(openmeteo, "FORECAST_DIR", tmp_path)
    monkeypatch.setattr(openmeteo, "MIN_AGE_H", 5.5)
    return tmp_path


def _prev_file(cache, hours_ago, now, null_days=()):
    rid = (now - timedelta(hours=hours_ago)).strftime(config.RUN_ID_FORMAT)
    df = pd.concat([_frame(p, now.date(), start=-92, null_days=null_days) for p in PLACES["id"]])
    df.to_parquet(cache / f"{rid}.parquet", index=False)
    return rid


def test_reuse_still_fills_holes(cache, monkeypatch):
    """A cache fetched before the GFS fill existed (run 43590829949 failed G2 on this)."""
    now = datetime.now(UTC)
    rid = _prev_file(cache, 1, now, null_days=(15,))
    calls = []

    def fake_fetch(batch, pacer, model=None, past_days=2):
        calls.append(model)
        return [_frame(pid, now.date(), v=99.0) for pid, _, _ in batch]

    monkeypatch.setattr(openmeteo, "fetch_batch", fake_fetch)
    res = openmeteo.run(PLACES, "20991231T0000Z")
    assert calls == [openmeteo.FALLBACK_MODEL] and res["reused"] == rid
    assert res["filled"]["rows"] == 2 and res["path"].endswith("20991231T0000Z.parquet")
    out = pd.read_parquet(res["path"])
    assert openmeteo.missing_forecast_rows(out, now.date()).empty
    assert res["retrieved_at"] == openmeteo.run_time(
        rid
    )  # the forecast itself is still the old one


def test_reuse_fill_tolerates_a_ban(cache, monkeypatch):
    now = datetime.now(UTC)
    rid = _prev_file(cache, 1, now, null_days=(15,))

    def banned(*a, **k):
        raise RateLimited("open-meteo", 40000)

    monkeypatch.setattr(openmeteo, "fetch_batch", banned)
    res = openmeteo.run(PLACES, "20991231T0000Z")
    assert res["reused"] == rid and res["filled"]["unfilled"] == 2
    assert res["path"].endswith(f"{rid}.parquet")  # nothing new written


def test_reuses_fresh_cache_without_requests(cache, monkeypatch):
    now = datetime.now(UTC)
    rid = _prev_file(cache, 3, now)
    monkeypatch.setattr(openmeteo, "fetch_batch", lambda *a, **k: pytest.fail("no call"))
    res = openmeteo.run(PLACES, "20991231T0000Z")
    assert (
        res["reused"] == rid and res["ok"] == 2 and res["retrieved_at"] == openmeteo.run_time(rid)
    )
    assert not (cache / "20991231T0000Z.parquet").exists()


def test_incremental_fetch_after_a_stale_cache(cache, monkeypatch):
    now = datetime.now(UTC)
    _prev_file(cache, 7, now)
    seen = []

    def fake_fetch(batch, pacer, model=None, past_days=2):
        seen.append(past_days)
        return [_frame(pid, now.date(), start=-past_days) for pid, _, _ in batch]

    monkeypatch.setattr(openmeteo, "fetch_batch", fake_fetch)
    res = openmeteo.run(PLACES, "20991231T0000Z")
    assert seen == [2] and res["past_days"] == 2 and res["reused"] is None
    out = pd.read_parquet(res["path"])
    assert out.groupby("place_id").size().tolist() == [108, 108]  # 92 past + 16 forecast


def test_ban_falls_back_to_cache_within_g3(cache, monkeypatch):
    now = datetime.now(UTC)
    rid = _prev_file(cache, 7, now)

    def banned(*a, **k):
        raise RateLimited("open-meteo", 47089)

    monkeypatch.setattr(openmeteo, "fetch_batch", banned)
    res = openmeteo.run(PLACES, "20991231T0000Z")
    assert res["reused"] == rid


def test_ban_with_old_cache_fails(cache, monkeypatch):
    now = datetime.now(UTC)
    _prev_file(cache, 14, now)

    def banned(*a, **k):
        raise RateLimited("open-meteo", 47089)

    monkeypatch.setattr(openmeteo, "fetch_batch", banned)
    with pytest.raises(RuntimeError, match="rate limited"):
        openmeteo.run(PLACES, "20991231T0000Z")


def test_incremental_fetch_gives_new_places_the_history(cache, monkeypatch):
    # PRD M9: a place the previous file does not know gets past_days=92 in its own batch
    now = datetime.now(UTC)
    _prev_file(cache, 7, now)
    seen = []

    def fake_fetch(batch, pacer, model=None, past_days=2):
        seen.append((tuple(p for p, _, _ in batch), past_days))
        return [_frame(pid, now.date(), start=-past_days) for pid, _, _ in batch]

    monkeypatch.setattr(openmeteo, "fetch_batch", fake_fetch)
    places = pd.concat([PLACES, pd.DataFrame({"id": ["c-pk"], "lat": [3.0], "lon": [3.0]})])
    res = openmeteo.run(places, "20991231T0000Z")
    assert sorted(seen) == [(("a-aa", "b-bb"), 2), (("c-pk",), openmeteo.PAST_DAYS)]
    out = pd.read_parquet(res["path"])
    assert out.groupby("place_id").size().to_dict() == {"a-aa": 108, "b-bb": 108, "c-pk": 108}


def test_reuse_fetches_places_absent_from_the_cached_run(cache, monkeypatch):
    now = datetime.now(UTC)
    rid = _prev_file(cache, 3, now)
    seen = []

    def fake_fetch(batch, pacer, model=None, past_days=2):
        seen.append((tuple(p for p, _, _ in batch), past_days))
        return [_frame(pid, now.date(), start=-past_days) for pid, _, _ in batch]

    monkeypatch.setattr(openmeteo, "fetch_batch", fake_fetch)
    places = pd.concat([PLACES, pd.DataFrame({"id": ["c-pk"], "lat": [3.0], "lon": [3.0]})])
    res = openmeteo.run(places, "20991231T0000Z")
    assert res["reused"] == rid and res["ok"] == 3
    assert seen == [(("c-pk",), openmeteo.PAST_DAYS)]
    out = pd.read_parquet(cache / "20991231T0000Z.parquet")
    assert set(out["place_id"]) == {"a-aa", "b-bb", "c-pk"}
