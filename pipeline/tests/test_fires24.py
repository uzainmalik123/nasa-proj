import pandas as pd

from ingest import fires24


def test_bins_are_centres_counts_and_max_frp():
    df = pd.DataFrame(
        {
            "lon": [74.30, 74.40, 74.10, -0.1],
            "lat": [31.55, 31.60, 31.30, 51.5],
            "frp": [10.0, 25.5, None, 3.0],
        }
    )
    bins = fires24.bin_detections(df, 0.25)
    assert bins[0] == [74.375, 31.625, 2, 25.5]  # busiest cell first, centre of [74.25, 74.5)
    assert [74.125, 31.375, 1, None] in bins  # NaN frp → null
    assert [-0.125, 51.625, 1, 3.0] in bins  # negative lon floors towards -inf
    assert len(bins) == 3


def test_empty():
    assert fires24.bin_detections(pd.DataFrame(columns=["lon", "lat", "frp"])) == []
