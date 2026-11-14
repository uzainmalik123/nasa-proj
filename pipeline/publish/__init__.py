"""Stage `publish`. Stub: logs its name. See docs/contracts.md §1 for what lives here."""

from __future__ import annotations

import logging

log = logging.getLogger("publish")


def run(ctx: dict) -> None:
    log.info("stage publish · run %s (stub)", ctx["run_id"])
