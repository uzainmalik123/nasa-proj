from datetime import date

import pandas as pd

from ingest import firms


def test_counts_use_each_places_own_radius(tmp_path, monkeypatch):
    # one fire 40 km east of two co-located places: the 50 km place sees it, the 30 km one not
    fires = pd.DataFrame(
        {
            "lat": [30.0],
            "lon": [70.0 + 40 / 96.5],  # ~40 km at 30°N
            "acq_date": [date(2026, 11, 14)],
            "frp": [5.0],
            "type": [0],
            "source": ["MODIS_NRT"],
        }
    )
    monkeypatch.setattr(firms, "load_cached_modis", lambda: fires)
    monkeypatch.setattr(firms, "COUNTS_PATH", tmp_path / "firms_counts.parquet")
    places = pd.DataFrame(
        {
            "id": ["wide-xx", "narrow-pk"],
            "lat": [30.0, 30.0],
            "lon": [70.0, 70.0],
            "radius_km": [50, 30],
        }
    )
    res = firms.counts(places)
    out = pd.read_parquet(tmp_path / "firms_counts.parquet").set_index("place_id")["n"]
    assert res["nonzero"] == 1 and out["wide-xx"] == 1 and out["narrow-pk"] == 0
