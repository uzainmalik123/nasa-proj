"""Dense Pakistan tier (PRD M9): district centroids appended to the watched places.

``pk_districts.csv`` (built once by ``build_pk.py`` from GADM 4.1 level 3 and
the 2017 census) holds the candidates. ``append_tier`` adds the ones that are
not yet in ``places.parquet`` as rows with ``tier = "pk"``, ``radius_km =
PK_RADIUS_KM`` and ``capital = False``, after the global rows (whose ``tier``
is null), so every per-place array keeps its order and the new places simply
extend it. A district whose centroid lies within ``PK_DEDUPE_KM`` of a global
place (Lahore, Karachi, ...) or of a more populous district already taken is
left out: its watch circle would sit inside the other one. The selection is
deterministic, so a second run adds nothing.
"""

from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd

import config
from places.build_places import haversine_km, slugify

log = logging.getLogger("places.pakistan")

PK_CSV = Path(__file__).resolve().parent / "pk_districts.csv"
COLUMNS = [
    "id",
    "name",
    "country",
    "continent",
    "lat",
    "lon",
    "pop",
    "radius_km",
    "capital",
    "tier",
]


def pk_places(global_places: pd.DataFrame, csv_path: Path = PK_CSV) -> pd.DataFrame:
    """The tier's rows (places.parquet schema plus ``tier``), de-duplicated."""
    src = pd.read_csv(csv_path)
    src = src.sort_values(["pop", "name"], ascending=[False, True]).reset_index(drop=True)
    g_lat = global_places["lat"].to_numpy(dtype=float)
    g_lon = global_places["lon"].to_numpy(dtype=float)
    lat, lon = src["lat"].to_numpy(dtype=float), src["lon"].to_numpy(dtype=float)
    keep: list[int] = []
    too_close = config.PK_DEDUPE_KM
    for i in range(len(src)):
        if len(g_lat) and (haversine_km(lat[i], lon[i], g_lat, g_lon) < too_close).any():
            continue
        if keep and (haversine_km(lat[i], lon[i], lat[keep], lon[keep]) < too_close).any():
            continue
        keep.append(i)
    out = src.iloc[keep]
    places = pd.DataFrame(
        {
            "id": [f"{slugify(n)}-district-pk" for n in out["name"]],
            "name": out["name"].to_numpy(),
            "country": "PK",
            "continent": "Asia",
            "lat": out["lat"].round(4).to_numpy(),
            "lon": out["lon"].round(4).to_numpy(),
            "pop": out["pop"].astype("int64").to_numpy(),
            "radius_km": config.PK_RADIUS_KM,
            "capital": False,
            "tier": config.PK_TIER,
        }
    )
    if not places["id"].is_unique:
        dup = places.loc[places["id"].duplicated(), "id"].tolist()
        raise ValueError(f"duplicate pk ids {dup}; rename in {csv_path.name}")
    return places.reset_index(drop=True)


def append_tier(places: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """``places`` plus any pk rows not yet present; returns (frame, rows added)."""
    places = places.copy()
    if "tier" not in places.columns:
        places["tier"] = None
    new = pk_places(places[places["tier"].isna()])
    new = new[~new["id"].isin(set(places["id"]))]
    if new.empty:
        return places, 0
    out = pd.concat([places[COLUMNS], new[COLUMNS]], ignore_index=True)
    log.info("places: +%d %s-tier rows → %d (PRD M9)", len(new), config.PK_TIER, len(out))
    return out, len(new)
