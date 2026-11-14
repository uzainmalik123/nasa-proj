"""Probe which FIRMS NRT source is live today and print row counts.

    uv run python ingest/probe_firms.py

Prints world/1 (today UTC), world/1/<yesterday> and world/2 for each source so
the choice is not fooled by the hour of day: world/1 without a date is nearly
empty before ~06:00 UTC.
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import config

SOURCES = ["VIIRS_NOAA21_NRT", "VIIRS_NOAA20_NRT", "VIIRS_SNPP_NRT", "MODIS_NRT"]


def rows(source: str, window: str) -> int:
    url = f"{config.FIRMS_API}/{config.FIRMS_MAP_KEY}/{source}/world/{window}"
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    return max(0, r.text.count("\n") - 1)


def main() -> None:
    if not config.FIRMS_MAP_KEY:
        raise SystemExit("FIRMS_MAP_KEY missing (pipeline/.env)")
    yday = (datetime.now(UTC) - timedelta(days=1)).strftime("%Y-%m-%d")
    counts: dict[str, dict[str, int]] = {}
    print(f"{'source':18} {'world/1':>9} {'world/1/' + yday:>20} {'world/2':>9}")
    for s in SOURCES:
        c = {"today": rows(s, "1"), "yday": rows(s, f"1/{yday}"), "2d": rows(s, "2")}
        counts[s] = c
        print(f"{s:18} {c['today']:9d} {c['yday']:20d} {c['2d']:9d}")
    viirs = {s: c for s, c in counts.items() if s.startswith("VIIRS")}
    best = max(viirs, key=lambda s: (viirs[s]["today"], viirs[s]["yday"]))
    print(f"\nFIRMS_LIVE_SOURCE choice: {best}  (config.py currently {config.FIRMS_LIVE_SOURCE})")


if __name__ == "__main__":
    main()
