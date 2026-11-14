"""The one entrypoint the cron calls.

    uv run --project pipeline python pipeline/run.py        # from the repo root
    cd pipeline && uv run python run.py                      # or from here

Stages run in a fixed order and share one context dict. Each stage module
exposes ``run(ctx: dict) -> None``. A stage that raises aborts the run; the
gates stage decides whether the deploy may proceed by writing ``run.json``.
"""

from __future__ import annotations

import logging
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import config
import features
import hazards
import ingest
import places
import publish
import trend
from publish import gates

STAGES = [
    ("ingest", ingest.run),
    ("places", places.run),
    ("trend", trend.run),
    ("features", features.run),
    ("hazards", hazards.run),
    ("publish", publish.run),
    ("gates", gates.run),
]

log = logging.getLogger("run")


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    started = datetime.now(UTC)
    ctx: dict = {
        "run_id": started.strftime(config.RUN_ID_FORMAT),
        "started": started,
        "tier": config.PLACE_TIER,
        "timings": {},
        "ok": True,
    }
    for d in (config.CACHE_DIR, config.OUT_DIR, config.RAW_DIR):
        d.mkdir(parents=True, exist_ok=True)
    log.info(
        "run %s · tier %d · live source %s",
        ctx["run_id"],
        ctx["tier"],
        config.FIRMS_LIVE_SOURCE,
    )

    for name, fn in STAGES:
        t0 = time.perf_counter()
        try:
            fn(ctx)
        except Exception:
            log.exception("stage %s failed", name)
            ctx["ok"] = False
            ctx["failed_stage"] = name
            break
        finally:
            ctx["timings"][name] = round(time.perf_counter() - t0, 3)

    total = (datetime.now(UTC) - started).total_seconds()
    log.info("done in %.2fs · ok=%s · %s", total, ctx["ok"], ctx["timings"])
    return 0 if ctx["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
