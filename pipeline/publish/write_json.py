"""Write a published JSON file per docs/contracts.md §3.

Every file carries ``meta.run_id``, ``meta.generated_at`` and ``meta.tier``.
``write_json`` converts numpy scalars and NaN/inf to plain JSON (``null`` for
missing, never ``NaN``), checks the gate-G6 size limit, and optionally checks
that per-place arrays have one entry per place.

    from publish.write_json import meta, write_json
    write_json("trends.json", {"meta": meta(ctx), ...}, n_places=n, per_place=["long.slope"])
"""

from __future__ import annotations

import json
import logging
import math
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

import config

log = logging.getLogger("publish")

ISO_S = "%Y-%m-%dT%H:%M:%SZ"


def meta(ctx: dict | None = None, run_id: str | None = None, tier: int | None = None) -> dict:
    """The ``meta`` block. Pass the run context or explicit values."""
    now = datetime.now(UTC)
    ctx = ctx or {}
    return {
        "run_id": run_id or ctx.get("run_id") or now.strftime(config.RUN_ID_FORMAT),
        "generated_at": now.strftime(ISO_S),
        "tier": int(tier if tier is not None else ctx.get("tier", config.PLACE_TIER)),
    }


def clean(obj: Any, ndigits: int | None = None) -> Any:
    """Recursively convert to JSON-safe values: numpy → python, NaN/inf → None."""
    if isinstance(obj, dict):
        return {str(k): clean(v, ndigits) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v, ndigits) for v in obj]
    if isinstance(obj, np.ndarray):
        return [clean(v, ndigits) for v in obj.tolist()]
    if isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    if isinstance(obj, (np.integer, int)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        f = float(obj)
        if math.isnan(f) or math.isinf(f):
            return None
        return round(f, ndigits) if ndigits is not None else f
    if isinstance(obj, datetime):
        return obj.astimezone(UTC).strftime(ISO_S)
    if hasattr(obj, "isoformat"):  # date, pandas Timestamp
        return obj.isoformat()
    return obj


def _get(payload: dict, dotted: str) -> Any:
    cur: Any = payload
    for part in dotted.split("."):
        cur = cur[part]
    return cur


def validate_per_place(payload: dict, n_places: int, per_place: list[str]) -> None:
    """Every dotted path in ``per_place`` must be a list with one entry per place."""
    for path in per_place:
        arr = _get(payload, path)
        if not isinstance(arr, list) or len(arr) != n_places:
            got = len(arr) if isinstance(arr, list) else type(arr).__name__
            raise ValueError(f"{path}: expected {n_places} per-place entries, got {got}")


def write_json(
    name: str,
    payload: dict,
    out_dir: Path = config.OUT_DIR,
    *,
    n_places: int | None = None,
    per_place: list[str] | None = None,
    ndigits: int | None = None,
) -> Path:
    """Clean, validate and write ``out_dir/name``. Returns the path."""
    if "meta" not in payload:
        raise ValueError(f"{name}: payload has no meta block")
    for key in ("run_id", "generated_at", "tier"):
        if key not in payload["meta"]:
            raise ValueError(f"{name}: meta.{key} missing")
    body = clean(payload, ndigits)
    if per_place:
        if n_places is None:
            raise ValueError("n_places is required with per_place")
        validate_per_place(body, n_places, per_place)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / name
    text = json.dumps(body, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    path.write_text(text + "\n")
    size = path.stat().st_size
    if size > config.G6_JSON_MAX_BYTES:
        log.warning("%s is %.1f MB, over the G6 limit", name, size / 1e6)
    log.info("wrote %s (%.1f KB)", path, size / 1024)
    return path
