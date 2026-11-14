"""Stage `trend`. Stub: logs its name. See docs/contracts.md §1 for what lives here."""

from __future__ import annotations

import logging

log = logging.getLogger("trend")


def run(ctx: dict) -> None:
    log.info("stage trend · run %s (stub)", ctx["run_id"])
