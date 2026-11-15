"""One-off generator for the dense Pakistan tier (PRD M9): places/pk_districts.csv.

    uv run python places/build_pk.py

Sources, both downloaded into data/raw/pakistan/ and read from there:

* GADM 4.1 level 3 for Pakistan (141 districts as polygons; GADM's level 2 is
  the 32 divisions). The centroid of each district's largest polygon is the
  watch point.
* OCHA COD-PS Pakistan, admin-2 (district) totals of the 2017 census, from HDX,
  for the exposure. GADM's district vintage is older than the census list, so
  the names are matched through ``ALIASES``; districts the census file does
  not carry (Azad Kashmir, Gilgit-Baltistan) take the rounded 2017 figures in
  ``POP_FALLBACK``; a district carved out after GADM's vintage is counted in
  its parent (undercount, documented in docs/handback/m-pakistan.md).

The committed CSV is what the pipeline reads (``places/pakistan.py``), so a
run never depends on these two hosts. Re-run this only to refresh the CSV.
"""

from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

import numpy as np
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import config

GADM_URL = "https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_PAK_3.json"
HDX_URL = (
    "https://data.humdata.org/dataset/9d48b019-3dd3-4284-ac11-200a70370447/resource/"
    "2fe439f1-8c17-4d5b-92d4-909858fc233b/download/pak_admpop_adm2_v2.csv"
)
RAW_DIR = config.RAW_DIR / "pakistan"
OUT_CSV = Path(__file__).resolve().parent / "pk_districts.csv"

# GADM NAME_3 (camel-case split) → display name: current spelling, or the
# district's present name where GADM carries an older one.
NAME_FIX = {
    "Karachiwest": "Karachi West",
    "Dera Ghazi Kha": "Dera Ghazi Khan",
    "Attok": "Attock",
    "Jakobabad": "Jacobabad",
    "Mirphurkhas": "Mirpur Khas",
    "Gujarat": "Gujrat",
    "Kholu": "Kohlu",
    "N. Waziristan": "North Waziristan",
    "S. Waziristan": "South Waziristan",
    "Tando M. Khan": "Tando Muhammad Khan",
    "Battagram": "Batagram",
    "Qilla Abdullah": "Killa Abdullah",
    "Qilla Saifullah": "Killa Saifullah",
    "Naushahro Firoz": "Naushahro Feroze",
    "Nawab Shah": "Nawabshah",
    "Chilas": "Diamer",
    "Mithi": "Tharparkar",
    "Largha Shirani": "Sherani",
    "Bolan": "Kachhi",
    "Jafarabad": "Jaffarabad",
    "Sudhnati": "Sudhnoti",
    "Malakand P. A.": "Malakand",
}
# display name → census admin2Name_en (one or several, summed) where they differ
ALIASES: dict[str, tuple[str, ...]] = {
    "Sherani": ("Sheerani",),
    "Adam Khel": ("FR Kohat",),
    "Bhittani": ("FR Tank",),
    "Dir": ("Upper Dir", "Lower Dir"),
    "Nawabshah": ("Shaheed Benazirabad",),
    "Malakand": ("Malakand PA",),
}
# Karachi's five GADM districts share one census row; the share is by the
# 2017 district totals (Central 2.97 M, East 2.91 M, South 1.79 M, West 3.91 M,
# Malir 2.0 M; all five sit inside the global Karachi place's radius anyway).
KARACHI_SHARE = {
    "Karachi Central": 0.22,
    "Karachi East": 0.21,
    "Karachi South": 0.13,
    "Karachi West": 0.29,
    "Malir": 0.15,
}
# 2017 census (PBS), rounded; districts the HDX admin-2 file does not carry.
POP_FALLBACK = {
    "Bagh": 371_000,
    "Bhimber": 421_000,
    "Kotli": 774_000,
    "Mirpur": 456_000,
    "Muzaffarabad": 650_000,
    "Neelum": 191_000,
    "Poonch": 501_000,
    "Sudhnoti": 298_000,
    "Diamer": 270_000,
    "Gilgit": 330_000,
    "Gilgit (Tribal Territory)": 200_000,  # Hunza-Nagar
}
# GADM draws Pakistan's claim; these are India-administered or uninhabited.
EXCLUDE = {
    "Disputed Area",  # GADM "DisputedArea1" / "DisputedArea2"
    "Kargil",
    "Ladakh (Leh)",
    "Kupwara (Gilgit Wazarat)",
    "Rannof Kutch",
}
PROVINCE = {
    "AzadKashmir": "Azad Kashmir",
    "Balochistan": "Balochistan",
    "FederallyAdministeredTribalAr": "Khyber Pakhtunkhwa",  # merged 2018
    "Gilgit-Baltistan": "Gilgit-Baltistan",
    "Islamabad": "Islamabad",
    "Khyber-Pakhtunkhwa": "Khyber Pakhtunkhwa",
    "Punjab": "Punjab",
    "Sindh": "Sindh",
}


def _norm(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())


def _download(url: str, name: str) -> Path:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    p = RAW_DIR / name
    if not p.exists():
        print(f"downloading {url}")
        r = requests.get(url, timeout=300)
        r.raise_for_status()
        p.write_bytes(r.content)
    return p


def ring_area_centroid(ring: list[list[float]]) -> tuple[float, float, float]:
    """Shoelace area (deg², sign dropped) and centroid of one closed lon/lat ring."""
    xy = np.asarray(ring, dtype=float)
    x, y = xy[:, 0], xy[:, 1]
    x1, y1 = np.roll(x, -1), np.roll(y, -1)
    cross = x * y1 - x1 * y
    a = cross.sum() / 2.0
    if abs(a) < 1e-12:
        return 0.0, float(x.mean()), float(y.mean())
    cx = ((x + x1) * cross).sum() / (6.0 * a)
    cy = ((y + y1) * cross).sum() / (6.0 * a)
    return abs(a), float(cx), float(cy)


def centroid(geometry: dict) -> tuple[float, float]:
    """Centroid of the largest polygon (exterior ring) of a (Multi)Polygon."""
    polys = geometry["coordinates"]
    if geometry["type"] == "Polygon":
        polys = [polys]
    best = max((ring_area_centroid(p[0]) for p in polys), key=lambda t: t[0])
    return round(best[2], 4), round(best[1], 4)  # lat, lon


def population(name: str, census: dict[str, int]) -> tuple[int, str]:
    if name in KARACHI_SHARE:
        return round(census[_norm("Karachi City")] * KARACHI_SHARE[name]), "census-2017-share"
    keys = ALIASES.get(name, (name,))
    try:
        return sum(census[_norm(k)] for k in keys), "census-2017"
    except KeyError:
        if name in POP_FALLBACK:
            return POP_FALLBACK[name], "census-2017-rounded"
        raise SystemExit(f"no population for {name!r}; extend ALIASES or POP_FALLBACK") from None


def main() -> None:
    gadm = json.loads(_download(GADM_URL, "gadm41_PAK_3.json").read_text())
    with _download(HDX_URL, "pak_admpop_adm2_v2.csv").open(encoding="utf-8-sig") as f:
        census = {_norm(r["admin2Name_en"]): int(r["T_TL"]) for r in csv.DictReader(f)}
    # GADM splits a few districts into numbered exclave pieces ("Gujranwala 1",
    # "Okara 1"); merge the pieces: one row, the largest piece's centroid.
    pieces: dict[tuple[str, str], list[dict]] = {}
    for feat in gadm["features"]:
        p = feat["properties"]
        name = re.sub(r"(?<=[a-z.])(?=[A-Z0-9(])", " ", p["NAME_3"])
        name = NAME_FIX.get(name, name)
        name = NAME_FIX.get(re.sub(r" \d+$", "", name), re.sub(r" \d+$", "", name))
        if name in EXCLUDE:
            continue
        pieces.setdefault((PROVINCE[p["NAME_1"]], name), []).append(feat)
    rows = []
    for (province, name), feats in pieces.items():
        lat, lon = centroid(
            {
                "type": "MultiPolygon",
                "coordinates": [
                    poly
                    for f in feats
                    for poly in (
                        [f["geometry"]["coordinates"]]
                        if f["geometry"]["type"] == "Polygon"
                        else f["geometry"]["coordinates"]
                    )
                ],
            }
        )
        pop, src = population(name, census)
        rows.append(
            {
                "gid": feats[0]["properties"]["GID_3"],
                "name": name,
                "province": province,
                "lat": lat,
                "lon": lon,
                "pop": pop,
                "pop_source": src,
            }
        )
    rows.sort(key=lambda r: (r["province"], r["name"]))
    with OUT_CSV.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print(f"{len(rows)} districts → {OUT_CSV}")


if __name__ == "__main__":
    main()
