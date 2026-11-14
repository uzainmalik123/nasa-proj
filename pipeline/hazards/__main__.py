"""Standalone science tail: hazards + publish from an existing feature table.

    uv run python -m hazards            # data/features.parquet, data/out/trends.json
    uv run python -m hazards --synth    # data/synth/
"""

from __future__ import annotations

import logging
import sys
import time
from datetime import UTC, datetime

import config
import hazards
import publish


def main(argv: list[str]) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s: %(message)s")
    synth = "--synth" in argv
    started = datetime.now(UTC)
    ctx: dict = {
        "run_id": started.strftime(config.RUN_ID_FORMAT),
        "started": started,
        "tier": config.PLACE_TIER,
        "timings": {},
        "ok": True,
        "data_dir": config.DATA_DIR / "synth" if synth else config.DATA_DIR,
    }
    t0 = time.perf_counter()
    hazards.run(ctx)
    ctx["timings"]["hazards"] = round(time.perf_counter() - t0, 1)
    t1 = time.perf_counter()
    publish.run(ctx)
    ctx["timings"]["publish"] = round(time.perf_counter() - t1, 1)
    print(f"science tail: {time.perf_counter() - t0:.1f}s · {ctx['timings']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
