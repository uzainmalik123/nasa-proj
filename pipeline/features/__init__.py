"""Stage ``features``: one row per place per day for the last 13 months → data/features.parquet.

Uses ``ctx["trends"]`` from the trend stage for the slope features and leaves
the table in ``ctx["features"]`` for the hazard modules.
"""

from __future__ import annotations

import logging
import time

import config

log = logging.getLogger("features")


def run(ctx: dict) -> None:
    from features import build
    from trend import load

    log.info("stage features · run %s", ctx["run_id"])
    t0 = time.perf_counter()
    places = ctx.get("places")
    if places is None:
        places = load.load_places(config.DATA_DIR)
        ctx["places"] = places
    df = build.build(places, config.DATA_DIR, trends=ctx.get("trends"))
    config.FEATURES_PARQUET.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(config.FEATURES_PARQUET, index=False)
    ctx["features"] = df
    log.info("stage features · %.1fs\n%s", time.perf_counter() - t0, build.summary(df))
