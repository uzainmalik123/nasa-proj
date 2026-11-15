import pandas as pd

import config
from places import pakistan


def _global():
    return pd.DataFrame(
        {
            "id": ["lahore-pk", "karachi-pk"],
            "name": ["Lahore", "Karachi"],
            "country": "PK",
            "continent": "Asia",
            "lat": [31.5619, 24.8719],
            "lon": [74.3481, 66.9881],
            "pop": [6577000, 12130000],
            "radius_km": config.RADIUS_KM,
            "capital": False,
        }
    )


def test_pk_rows_have_the_tier_schema_and_radius():
    rows = pakistan.pk_places(_global())
    assert set(pakistan.COLUMNS) == set(rows.columns)
    assert (rows["tier"] == config.PK_TIER).all()
    assert (rows["radius_km"] == config.PK_RADIUS_KM).all()
    assert (rows["country"] == "PK").all() and (rows["continent"] == "Asia").all()
    assert rows["id"].str.endswith("-district-pk").all() and rows["id"].is_unique
    assert rows["pop"].dtype == "int64" and (rows["pop"] > 0).all()
    assert 100 <= len(rows) <= 140


def test_districts_near_a_global_place_or_each_other_are_skipped():
    rows = pakistan.pk_places(_global())
    names = set(rows["name"])
    assert "Lahore" not in names  # 10 km from the global Lahore
    assert not names & {"Karachi Central", "Karachi East", "Karachi South", "Karachi West"}
    from places.build_places import haversine_km

    lat, lon = rows["lat"].to_numpy(), rows["lon"].to_numpy()
    for i in range(len(rows)):
        d = haversine_km(lat[i], lon[i], lat, lon)
        d[i] = 1e9
        assert d.min() >= config.PK_DEDUPE_KM
    # every kept district is at least PK_DEDUPE_KM from both global places
    for g in _global().itertuples():
        assert haversine_km(g.lat, g.lon, lat, lon).min() >= config.PK_DEDUPE_KM


def test_append_is_idempotent_and_keeps_order():
    base = _global()
    once, added = pakistan.append_tier(base)
    assert added > 0 and len(once) == len(base) + added
    assert once["id"].tolist()[: len(base)] == base["id"].tolist()
    assert once["tier"].isna().tolist()[: len(base)] == [True, True]
    twice, added2 = pakistan.append_tier(once)
    assert added2 == 0 and twice["id"].tolist() == once["id"].tolist()
    # survives a parquet round trip (the data branch carries places.parquet)
    import io

    buf = io.BytesIO()
    once.to_parquet(buf, index=False)
    back = pd.read_parquet(io.BytesIO(buf.getvalue()))
    again, added3 = pakistan.append_tier(back)
    assert added3 == 0 and again["tier"].isna().sum() == len(base)
