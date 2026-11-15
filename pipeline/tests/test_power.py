from datetime import date

import pandas as pd

import config
from ingest import power

TODAY = date(2026, 11, 15)


def _cache(newest: date) -> pd.DataFrame:
    return pd.DataFrame({"date": [newest], **{c: [1.0] for c in power.COLUMNS.values()}})


def test_global_places_are_always_due():
    assert power.is_due(None, _cache(TODAY), TODAY, hour=3)
    assert power.is_due(pd.NA, _cache(TODAY), TODAY, hour=3)


def test_tier_place_without_cache_is_due():
    assert power.is_due(config.PK_TIER, None, TODAY, hour=3)
    assert power.is_due(config.PK_TIER, pd.DataFrame(columns=power.SCHEMA), TODAY, hour=3)


def test_tier_place_refreshes_every_second_run():
    fresh = _cache(TODAY - pd.Timedelta(days=3).to_pytimedelta())
    assert power.is_due(config.PK_TIER, fresh, TODAY, hour=6)
    assert power.is_due(config.PK_TIER, fresh, TODAY, hour=0)
    assert not power.is_due(config.PK_TIER, fresh, TODAY, hour=3)
    assert not power.is_due(config.PK_TIER, fresh, TODAY, hour=9)


def test_tier_place_about_to_fail_g2_is_due_on_any_run():
    ok = _cache(TODAY - pd.Timedelta(days=config.G3_POWER_MAX_AGE_D).to_pytimedelta())
    stale = _cache(TODAY - pd.Timedelta(days=config.G3_POWER_MAX_AGE_D + 1).to_pytimedelta())
    assert not power.is_due(config.PK_TIER, ok, TODAY, hour=3)
    assert power.is_due(config.PK_TIER, stale, TODAY, hour=3)
