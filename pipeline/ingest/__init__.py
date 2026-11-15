"""Stage ``ingest``: FIRMS + POWER + Open-Meteo caches, freshness.json and fires_24h.json.

The three upstreams are independent, so they run in three threads (each with
its own pacing). Places come from ``data/places.parquet``; in CI that file does
not exist on a cold run (``pipeline/data`` is gitignored), so it is built with
``places.build_places.build()`` on the fly; the dense Pakistan tier (PRD M9,
``places.pakistan``) is appended whenever its rows are missing. ``PLACE_LIMIT=<n>`` keeps the n
most populous places (the PRD §10 fallback if POWER throttles).
"""

from __future__ import annotations

import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pandas as pd

import config
from ingest import fires24, firms, openmeteo, power
from ingest._http import get

log = logging.getLogger("ingest")

FRESHNESS_PATH = config.OUT_DIR / "freshness.json"
# Probe tile: MODIS Terra true colour for yesterday (verified 14 Nov; IMERG
# layer ids differ per projection, M-GIBS on day 2 picks the real layers).
GIBS_PROBE = (
    "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/"
    "MODIS_Terra_CorrectedReflectance_TrueColor/default/{date}/GoogleMapsCompatible_Level9/2/1/1.jpg"
)


def load_places() -> pd.DataFrame:
    if config.PLACES_PARQUET.exists():
        places = pd.read_parquet(config.PLACES_PARQUET)
        log.info("places: %d from %s", len(places), config.PLACES_PARQUET.name)
    else:
        from places import build_places

        log.info("places: %s missing; building from Natural Earth", config.PLACES_PARQUET.name)
        places = build_places.build(config.TIER_MIN_POP[config.PLACE_TIER])
        config.PLACES_PARQUET.parent.mkdir(parents=True, exist_ok=True)
        places.to_parquet(config.PLACES_PARQUET, index=False)
        log.info("places: built %d", len(places))
    # PRD M9: the dense Pakistan tier is appended after the global rows and
    # written back, so the data branch carries it from the first run on
    from places import pakistan

    places, added = pakistan.append_tier(places)
    if added:
        places.to_parquet(config.PLACES_PARQUET, index=False)
    limit = int(os.environ.get("PLACE_LIMIT", "0") or 0)
    if limit and limit < len(places):
        places = places.sort_values("pop", ascending=False).head(limit)
        places = places.sort_index().reset_index(drop=True)
        log.warning(
            "PLACE_LIMIT=%d: ingesting the %d most populous places only", limit, len(places)
        )
    return places.reset_index(drop=True)


def _iso(ts) -> str | None:
    if ts is None:
        return None
    if isinstance(ts, datetime):
        return ts.astimezone(UTC).strftime("%Y-%m-%dT%H:%MZ")
    return str(ts)


def _status(valid_for: datetime | None, max_age: timedelta, now: datetime) -> str:
    if valid_for is None:
        return "missing"
    return "ok" if now - valid_for <= max_age else "stale"


def probe_gibs(now: datetime) -> dict:
    d = (now - timedelta(days=1)).date()
    try:
        r = get(GIBS_PROBE.format(date=d.isoformat()), timeout=30, tries=2, label="gibs probe")
        ok = r.headers.get("content-type", "").startswith("image/")
    except Exception as e:
        log.warning("gibs probe failed: %s", e)
        ok = False
    return {"valid_for": d.isoformat(), "ok": ok}


def build_freshness(ctx: dict, places: pd.DataFrame, res: dict, now: datetime) -> dict:
    fr = res["firms"]["live"]
    po = res["power"]
    om = res["openmeteo"]
    firms_newest = fr.get("newest")
    # POWER is date-granular: "through 4 days ago" counts calendar days, not hours
    power_newest = (
        datetime.fromisoformat(po["newest"]).replace(tzinfo=UTC) if po.get("newest") else None
    )
    power_age_ok = power_newest is not None and (now.date() - power_newest.date()).days <= (
        config.G3_POWER_MAX_AGE_D
    )
    gibs = probe_gibs(now)
    ne_mtime = datetime.fromtimestamp(config.PLACES_PARQUET.stat().st_mtime, UTC)
    rows = [
        {
            "name": "NASA FIRMS",
            "kind": "observation",
            "product": config.FIRMS_LIVE_SOURCE,
            "valid_for": _iso(firms_newest),
            "retrieved_at": _iso(fr["retrieved_at"]),
            "records": fr["rows_24h"],
            "latency_doc": "~3 h",
            "status": _status(firms_newest, timedelta(hours=config.G3_FIRMS_MAX_AGE_H), now),
            "url": "https://firms.modaps.eosdis.nasa.gov/",
        },
        {
            "name": "NASA POWER",
            "kind": "observation",
            "product": "daily point, MERRA-2/GEOS, community AG",
            "valid_for": po.get("newest"),
            "retrieved_at": _iso(po["retrieved_at"]),
            "records": po["rows"],
            "latency_doc": "~3 days",
            "status": "missing" if power_newest is None else ("ok" if power_age_ok else "stale"),
            "url": "https://power.larc.nasa.gov/",
        },
        {
            "name": "Open-Meteo",
            "kind": "forecast",
            "product": "16-day daily forecast (non-NASA supplement)"
            + (f", cached run {om['reused']}" if om.get("reused") else ""),
            "valid_for": _iso(om["retrieved_at"]),
            "retrieved_at": _iso(om["retrieved_at"]),
            "records": om["rows"],
            "latency_doc": "model runs hourly",
            "status": "missing"
            if not om["ok"]
            else _status(om["retrieved_at"], timedelta(hours=config.G3_FORECAST_MAX_AGE_H), now),
            "url": "https://open-meteo.com/",
        },
        {
            "name": "NASA GIBS",
            "kind": "observation",
            "product": "WMTS tiles (probe: MODIS_Terra_CorrectedReflectance_TrueColor)",
            "valid_for": gibs["valid_for"],
            "retrieved_at": _iso(now),
            "records": None,
            "latency_doc": "~1 day, tiles fetched live by the dashboard",
            "status": "ok" if gibs["ok"] else "missing",
            "url": "https://gibs.earthdata.nasa.gov/",
        },
        {
            "name": "Natural Earth",
            "kind": "observation",
            "product": "ne_10m_populated_places",
            "valid_for": _iso(ne_mtime),
            "retrieved_at": _iso(ne_mtime),
            "records": len(places),
            "latency_doc": "static",
            "status": "ok",
            "url": "https://www.naturalearthdata.com/",
        },
    ]
    return {
        "meta": {
            "run_id": ctx["run_id"],
            "generated_at": _iso(now),
            "tier": ctx["tier"],
        },
        "sources": rows,
    }


def run(ctx: dict) -> None:
    log.info("stage ingest · run %s", ctx["run_id"])
    places = load_places()
    ctx["places"] = places
    # G1 budget: a run that starts without a POWER cache, or with at least
    # POWER_COLD_MIN_NEW places lacking one (a new tier), is cold (60 min, else 15)
    power_dir = config.CACHE_DIR / "power"
    uncached = sum(not (power_dir / f"{pid}.parquet").exists() for pid in places["id"])
    ctx["cold"] = uncached >= min(len(places), config.POWER_COLD_MIN_NEW)
    if ctx["cold"]:
        log.warning(
            "%d/%d places without a POWER cache: cold run (G1 budget %d s)",
            uncached,
            len(places),
            config.G1_COLD_MAX_S,
        )
    res: dict = {}
    with ThreadPoolExecutor(max_workers=3, thread_name_prefix="ingest") as ex:
        futs = {
            "firms": ex.submit(firms.run, places),
            "power": ex.submit(power.run, places),
            "openmeteo": ex.submit(openmeteo.run, places, ctx["run_id"]),
        }
        errors = {}
        for name, f in futs.items():
            try:
                res[name] = f.result()
            except Exception as e:
                log.exception("%s ingest failed", name)
                errors[name] = e
    if errors:
        raise RuntimeError(f"ingest failed: {', '.join(f'{k}: {v}' for k, v in errors.items())}")
    now = datetime.now(UTC)
    config.OUT_DIR.mkdir(parents=True, exist_ok=True)
    freshness = build_freshness(ctx, places, res, now)
    FRESHNESS_PATH.write_text(json.dumps(freshness, indent=1) + "\n")
    ctx["ingest"] = res
    ctx["freshness"] = freshness
    ctx["fires_24h"] = fires24.write(ctx)
    for s in freshness["sources"]:
        log.info(
            "freshness %-14s %-7s valid_for=%s records=%s",
            s["name"],
            s["status"],
            s["valid_for"],
            s["records"],
        )
