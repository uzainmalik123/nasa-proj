"""Stage `gates`: grades the run (PRD §13.1) and writes run.json. Stub for now."""

from __future__ import annotations

import logging

log = logging.getLogger("gates")


def run(ctx: dict) -> None:
    log.info("stage gates · run %s (stub)", ctx["run_id"])
