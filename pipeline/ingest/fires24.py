"""``fires_24h.json`` (contracts §3): the last 24 h of live detections binned to 0.25°.

Reads ``cache/firms_live.parquet`` (written by ``ingest.firms.live``), keeps
the rows of ``config.FIRMS_LIVE_SOURCE`` (the MODIS_NRT rows in that file are
the same fires seen by another sensor and would double count; they are used
only if the VIIRS slice is empty), and writes

    { "meta": {...}, "source": "VIIRS_NOAA21_NRT", "newest_acq": "2026-11-13T15:30Z",
      "bins": [ [lon, lat, count, max_frp] ... ] }

with bin centres on the ``config.FIRMS_BIN_DEG`` grid, sorted by count
descending so a truncating reader keeps the busiest cells.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

import numpy as np
import pandas as pd

import config
from ingest.firms import LIVE_PATH, acq_datetime
from publish.write_json import meta, write_json

log = logging.getLogger("ingest.fires24")

NAME = "fires_24h.json"


def bin_detections(df: pd.DataFrame, deg: float = config.FIRMS_BIN_DEG) -> list[list]:
    """[[lon, lat, count, max_frp], ...] on a ``deg`` grid, centres, count desc."""
    if df.empty:
        return []
    lon = np.floor(df["lon"].to_numpy(dtype="float64") / deg) * deg + deg / 2
    lat = np.floor(df["lat"].to_numpy(dtype="float64") / deg) * deg + deg / 2
    frp = pd.to_numeric(df["frp"], errors="coerce").to_numpy(dtype="float64")
    g = (
        pd.DataFrame({"lon": lon, "lat": lat, "frp": frp})
        .groupby(["lon", "lat"], sort=False)
        .agg(count=("frp", "size"), max_frp=("frp", "max"))
        .reset_index()
        .sort_values(["count", "max_frp"], ascending=False, kind="stable")
    )
    nd = 4  # 0.125-offset centres need three decimals; four keeps any grid exact enough
    out = []
    for r in g.itertuples(index=False):
        mf = None if not np.isfinite(r.max_frp) else round(float(r.max_frp), 1)
        out.append([round(float(r.lon), nd), round(float(r.lat), nd), int(r.count), mf])
    return out


def build(ctx: dict, live: pd.DataFrame | None = None) -> dict:
    if live is None:
        live = pd.read_parquet(LIVE_PATH) if LIVE_PATH.exists() else pd.DataFrame()
    source = config.FIRMS_LIVE_SOURCE
    if not live.empty and "source" in live.columns:
        sel = live[live["source"] == source]
        if sel.empty:
            used = sorted(live["source"].dropna().unique().tolist())
            log.warning("no %s rows in %s; binning %s instead", source, LIVE_PATH.name, used)
            sel = live
        live = sel
    newest = None
    if not live.empty:
        ts = acq_datetime(live)
        if ts.notna().any():
            newest = ts.max().to_pydatetime().astimezone(UTC).strftime("%Y-%m-%dT%H:%MZ")
    bins = bin_detections(live)
    log.info("fires_24h: %d rows of %s → %d bins · newest %s", len(live), source, len(bins), newest)
    return {"meta": meta(ctx), "source": source, "newest_acq": newest, "bins": bins}


def write(ctx: dict, out_dir=None) -> dict:
    payload = build(ctx)
    write_json(NAME, payload, out_dir or config.OUT_DIR)
    return payload


if __name__ == "__main__":  # uv run python -m ingest.fires24
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    logging.basicConfig(level=logging.INFO)
    rid = datetime.now(UTC).strftime(config.RUN_ID_FORMAT)
    p = write({"run_id": rid, "tier": config.PLACE_TIER})
    print(p["source"], p["newest_acq"], len(p["bins"]), p["bins"][:3])
