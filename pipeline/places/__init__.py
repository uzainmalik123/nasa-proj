"""Stage `places`. Stub: logs its name. See docs/contracts.md §1 for what lives here."""

from __future__ import annotations

import logging

log = logging.getLogger("places")


def run(ctx: dict) -> None:
    log.info("stage places · run %s (stub)", ctx["run_id"])
