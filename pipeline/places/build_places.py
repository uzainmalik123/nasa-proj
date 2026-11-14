"""Build the watched place list from Natural Earth ne_10m_populated_places.

    uv run python places/build_places.py

Selection (PRD §7.1, tier 1): national capitals plus every place with
pop_max >= 1,000,000, de-duplicated within 50 km keeping the larger population.
Writes data/places.parquet and dashboard/public/data/places.json and prints the
count. Only the .dbf attribute table is read (it carries LATITUDE/LONGITUDE),
so no shapefile library is needed.
"""

from __future__ import annotations

import io
import json
import re
import struct
import sys
import unicodedata
import zipfile
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import config

NE_URL = "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_populated_places.zip"
NE_DIR = config.RAW_DIR / "natural_earth"
NE_ZIP = NE_DIR / "ne_10m_populated_places.zip"

# ADM0_A3 → continent. Covers every country that has a capital or a 1M+ city
# in Natural Earth 5.x; the build fails loudly if a code is missing.
_CONTINENTS = {
    "Africa": """AGO BDI BEN BFA BWA CAF CIV CMR COD COG COM CPV DJI DZA EGY ERI ETH GAB GHA
        GIN GMB GNB GNQ KEN LBR LBY LSO MAR MDG MLI MOZ MRT MUS MWI NAM NER NGA RWA SAH SDN
        SEN SLE SOL SOM SSD STP SWZ SYC TCD TGO TUN TZA UGA ZAF ZMB ZWE""",
    "Asia": """AFG ARE ARM AZE BGD BHR BRN BTN CHN CYP GEO HKG IDN IND IRN IRQ ISR JOR JPN
        KAZ KGZ KHM KOR KWT LAO LBN LKA MAC MDV MMR MNG MYS NPL OMN PAK PHL PRK QAT SAU
        SGP SYR THA TJK TKM TLS TUR TWN UZB VNM YEM PSX""",
    "Europe": """ALB AND AUT BEL BGR BIH BLR CHE CZE DEU DNK ESP EST FIN FRA GBR GRC HRV HUN
        IRL ISL ITA KOS LIE LTU LUX LVA MCO MDA MKD MLT MNE NLD NOR POL PRT ROU RUS SMR SRB
        SVK SVN SWE UKR VAT""",
    "North America": """ATG BHS BLZ BRB CAN CRI CUB DMA DOM GRD GTM HND HTI JAM KNA LCA MEX
        NIC PAN PRI SLV TTO USA VCT GRL BMU CYM""",
    "South America": "ARG BOL BRA CHL COL ECU GUY PER PRY SUR URY VEN FLK",
    "Oceania": "AUS FJI FSM KIR MHL NZL PLW PNG SLB TON TUV VUT WSM NRU",
}
CONTINENT_BY_A3 = {a3: cont for cont, codes in _CONTINENTS.items() for a3 in codes.split()}

# ISO_A2 is "-99" for a few territories in Natural Earth.
ISO2_FALLBACK = {"KOS": "XK", "SOL": "SO", "SAH": "EH", "PSX": "PS", "FRA": "FR", "NOR": "NO"}


def read_dbf(data: bytes) -> pd.DataFrame:
    """Minimal dBASE III reader: header, field descriptors, fixed-width records."""
    n_records, header_len, record_len = struct.unpack("<IHH", data[4:12])
    fields: list[tuple[str, str, int]] = []
    pos = 32
    while data[pos] != 0x0D:
        desc = data[pos : pos + 32]
        name = desc[:11].split(b"\0")[0].decode("ascii")
        fields.append((name, chr(desc[11]), desc[16]))
        pos += 32
    rows = []
    pos = header_len
    for _ in range(n_records):
        rec = data[pos : pos + record_len]
        pos += record_len
        if rec[:1] == b"*":  # deleted
            continue
        row, off = [], 1
        for _name, ftype, flen in fields:
            raw = rec[off : off + flen]
            off += flen
            text = raw.decode("utf-8", "replace").strip()
            if ftype in ("N", "F"):
                try:
                    row.append(float(text))
                except ValueError:  # "", "-" or "****" overflow markers
                    row.append(np.nan)
            else:
                row.append(text)
        rows.append(row)
    return pd.DataFrame(rows, columns=[f[0] for f in fields])


def slugify(name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")
    return slug or "place"


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi = p2 - p1
    dlmb = np.radians(lon2 - lon1)
    a = np.sin(dphi / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dlmb / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(a))


def download() -> bytes:
    NE_DIR.mkdir(parents=True, exist_ok=True)
    if not NE_ZIP.exists():
        print(f"downloading {NE_URL}")
        r = requests.get(NE_URL, timeout=300)
        r.raise_for_status()
        NE_ZIP.write_bytes(r.content)
    with zipfile.ZipFile(io.BytesIO(NE_ZIP.read_bytes())) as z:
        name = next(n for n in z.namelist() if n.endswith(".dbf"))
        return z.read(name)


def build(min_pop: int = config.TIER_MIN_POP[1]) -> pd.DataFrame:
    df = read_dbf(download())
    df["pop"] = df["POP_MAX"].fillna(0).astype(int)
    df["capital"] = (df["FEATURECLA"].str.startswith("Admin-0 capital")) | (df["ADM0CAP"] == 1)
    cand = df[df["capital"] | (df["pop"] >= min_pop)].copy()
    cand = cand[cand["LATITUDE"].notna() & cand["LONGITUDE"].notna()]

    # dedupe within DEDUPE_KM, keeping the larger population (capitals tie-break)
    cand = cand.sort_values(["pop", "capital"], ascending=[False, False]).reset_index(drop=True)
    lat, lon = cand["LATITUDE"].to_numpy(), cand["LONGITUDE"].to_numpy()
    keep: list[int] = []
    for i in range(len(cand)):
        if keep:
            d = haversine_km(lat[i], lon[i], lat[keep], lon[keep])
            if (d < config.DEDUPE_KM).any():
                continue
        keep.append(i)
    out = cand.iloc[keep].copy()

    iso2 = out["ISO_A2"].where(~out["ISO_A2"].isin(["-99", ""]), np.nan)
    iso2 = iso2.fillna(out["ADM0_A3"].map(ISO2_FALLBACK))
    missing_iso = out.loc[iso2.isna(), "ADM0_A3"].unique().tolist()
    if missing_iso:
        raise SystemExit(f"no ISO2 for {missing_iso}; extend ISO2_FALLBACK")
    out["country"] = iso2.str.upper()

    continent = out["ADM0_A3"].map(CONTINENT_BY_A3)
    missing = out.loc[continent.isna(), "ADM0_A3"].unique().tolist()
    if missing:
        raise SystemExit(f"no continent for {missing}; extend _CONTINENTS")
    # Russia straddles the Urals; places east of 60°E are in Asia.
    continent = continent.where(~((out["ADM0_A3"] == "RUS") & (out["LONGITUDE"] > 60)), "Asia")
    out["continent"] = continent

    out["name"] = out["NAME"].where(out["NAME"] != "", out["NAMEASCII"])
    out["id"] = [
        f"{slugify(n)}-{c.lower()}" for n, c in zip(out["name"], out["country"], strict=True)
    ]
    dup = out["id"].duplicated(keep="first")
    out.loc[dup, "id"] = (
        out.loc[dup, "id"] + "-" + (out.loc[dup].groupby("id").cumcount() + 2).astype(str)
    )
    assert out["id"].is_unique

    places = pd.DataFrame(
        {
            "id": out["id"].to_numpy(),
            "name": out["name"].to_numpy(),
            "country": out["country"].to_numpy(),
            "continent": out["continent"].to_numpy(),
            "lat": out["LATITUDE"].round(4).to_numpy(),
            "lon": out["LONGITUDE"].round(4).to_numpy(),
            "pop": out["pop"].to_numpy(),
            "radius_km": config.RADIUS_KM,
            "capital": out["capital"].astype(bool).to_numpy(),
        }
    )
    # stable, readable order: by continent then population desc
    places = places.sort_values(["continent", "pop"], ascending=[True, False]).reset_index(
        drop=True
    )
    return places


def write(
    places: pd.DataFrame, json_path: Path = config.DASHBOARD_DATA_DIR / "places.json"
) -> None:
    config.PLACES_PARQUET.parent.mkdir(parents=True, exist_ok=True)
    places.to_parquet(config.PLACES_PARQUET, index=False)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    now = datetime.now(UTC)
    payload = {
        "meta": {
            "run_id": now.strftime(config.RUN_ID_FORMAT),
            "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "tier": config.PLACE_TIER,
        },
        "places": places.to_dict(orient="records"),
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")


def main() -> None:
    places = build()
    write(places)
    n_cap = int(places["capital"].sum())
    print(f"{len(places)} places ({n_cap} capitals) → {config.PLACES_PARQUET} and places.json")
    print(places["continent"].value_counts().to_string())


if __name__ == "__main__":
    main()
