"""Stage ``trend``: Mann-Kendall + Sen's slope per place per variable → trends.json.

Reads the S1 caches under ``config.DATA_DIR``, writes ``data/out/trends.json``
and leaves the body in ``ctx["trends"]`` for the feature builder.
"""

from __future__ import annotations

import logging
import time

import config

log = logging.getLogger("trend")


def run(ctx: dict) -> None:
    from publish.write_json import meta, write_json
    from trend import load, mk

    log.info("stage trend · run %s", ctx["run_id"])
    t0 = time.perf_counter()
    places = ctx.get("places")
    if places is None:
        places = load.load_places(config.DATA_DIR)
        ctx["places"] = places
    body = mk.run_trends(places, config.DATA_DIR)
    payload = {"meta": meta(ctx), **body}
    write_json(
        "trends.json",
        payload,
        config.OUT_DIR,
        n_places=len(places),
        per_place=[
            "long.slope",
            "long.p",
            "long.label",
            "short.slope",
            "short.p",
            "short.label",
            "series_long",
        ],
    )
    ctx["trends"] = payload
    log.info("stage trend · %.1fs\n%s", time.perf_counter() - t0, mk.summary(body))
