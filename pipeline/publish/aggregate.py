"""Cross-place summaries for risk.json (PRD M3 movers, M4 continents).

Both are derived from the per-place ``now`` records and the 90-day ``history``
that the hazards stage already produced, so they add no new science, only the
two aggregations the dashboard would otherwise recompute on every load.

  movers      per hazard: the ten places whose risk rose most and the ten whose
              risk fell most over the last MOVERS_LAG_DAYS days (today's headline
              value minus the hindcast value that many days back)
  continents  per continent: the category tally per hazard, today's mean
              headline value, and the mean hindcast series over the 90 days

Schema in docs/contracts.md §3 (risk.json, note of 2026-11-15). "Up" always
means more risk: for drought, whose index is a deficit (more negative = worse),
a rising mover has a negative ``delta``.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

import config

MOVERS_N = 10
MOVERS_LAG_DAYS = 7

#: the headline field per hazard, the number the ranked table and the chip show
HEADLINE_KEY = {"wildfire": "p", "drought": "index", "heat": "days_above", "rain": "p"}


def _r(x: float | None, nd: int = 3) -> float | None:
    if x is None:
        return None
    f = float(x)
    return round(f, nd) if np.isfinite(f) else None


def _worse(hazard: str, delta: float) -> float:
    """Signed change oriented so that positive = more risk."""
    return -delta if hazard == "drought" else delta


def movers(places: pd.DataFrame, risk: dict, lag: int = MOVERS_LAG_DAYS, n: int = MOVERS_N) -> dict:
    """``{hazard: {key, since, up: [row…], down: [row…]}}``, rows sorted by |change|."""
    days = risk["history_days"]
    if len(days) < lag:
        raise ValueError(f"history has {len(days)} days, need {lag} for movers")
    since = days[-lag]
    ids = places["id"].astype(str).tolist()
    pops = places["pop"].astype("int64").tolist()
    out: dict = {}
    for h in config.HAZARDS:
        key = HEADLINE_KEY[h]
        rows = []
        for i, rec in enumerate(risk["now"]):
            value = rec[h].get(key)
            hist = risk["history"][h][i]
            ago = hist[-lag] if len(hist) >= lag else None
            if value is None or ago is None:
                continue
            delta = float(value) - float(ago)
            if delta == 0.0:
                continue
            rows.append(
                {
                    "place": i,
                    "id": ids[i],
                    "value": _r(value),
                    "ago": _r(ago),
                    "delta": _r(delta),
                    "category": rec[h]["category"],
                    "exposure": pops[i],
                    "_w": _worse(h, delta),
                }
            )
        up = sorted((r for r in rows if r["_w"] > 0), key=lambda r: -r["_w"])[:n]
        down = sorted((r for r in rows if r["_w"] < 0), key=lambda r: r["_w"])[:n]
        strip = lambda r: {k: v for k, v in r.items() if k != "_w"}  # noqa: E731
        out[h] = {
            "key": key,
            "since": since,
            "up": list(map(strip, up)),
            "down": list(map(strip, down)),
        }
    return out


def continents(places: pd.DataFrame, risk: dict) -> dict:
    """Per-continent category counts, today's mean headline and the mean 90-day hindcast."""
    cont = places["continent"].astype(str).to_numpy()
    names = sorted(set(cont.tolist()))
    groups = {c: np.flatnonzero(cont == c) for c in names}
    pops = places["pop"].astype("int64").to_numpy()
    counts: dict = {}
    mean_now: dict = {}
    mean_history: dict = {}
    for h in config.HAZARDS:
        key = HEADLINE_KEY[h]
        now_vals = np.array(
            [np.nan if r[h].get(key) is None else float(r[h][key]) for r in risk["now"]],
            dtype="float64",
        )
        cats = np.array([r[h]["category"] for r in risk["now"]])
        hist = np.array(
            [[np.nan if v is None else float(v) for v in row] for row in risk["history"][h]],
            dtype="float64",
        )
        counts[h], mean_now[h], mean_history[h] = [], [], []
        for c in names:
            idx = groups[c]
            counts[h].append({cat: int(np.sum(cats[idx] == cat)) for cat in config.CATEGORIES})
            with np.errstate(all="ignore"):
                mean_now[h].append(_r(np.nanmean(now_vals[idx])) if len(idx) else None)
                series = (
                    np.nanmean(hist[idx], axis=0) if len(idx) else np.full(hist.shape[1], np.nan)
                )
            mean_history[h].append([_r(v) for v in series])
    return {
        "names": names,
        "n": [len(groups[c]) for c in names],
        "pop": [int(pops[groups[c]].sum()) for c in names],
        "counts": counts,
        "mean_now": mean_now,
        "mean_history": mean_history,
    }


def attach(places: pd.DataFrame, risk: dict) -> dict:
    """``risk`` plus ``movers`` and ``continents`` (a new dict; the input is untouched)."""
    return {**risk, "movers": movers(places, risk), "continents": continents(places, risk)}


def validate(risk: dict, n_places: int) -> None:
    """Shape checks for the two blocks; raises ValueError."""
    mv = risk["movers"]
    for h in config.HAZARDS:
        if set(mv[h]) != {"key", "since", "up", "down"}:
            raise ValueError(f"movers.{h}: keys {sorted(mv[h])}")
        for side in ("up", "down"):
            rows = mv[h][side]
            if len(rows) > MOVERS_N:
                raise ValueError(f"movers.{h}.{side}: {len(rows)} rows")
            for r in rows:
                if not (0 <= r["place"] < n_places) or r["delta"] is None:
                    raise ValueError(f"movers.{h}.{side}: bad row {r}")
    ct = risk["continents"]
    k = len(ct["names"])
    if sum(ct["n"]) != n_places:
        raise ValueError(f"continents.n sums to {sum(ct['n'])}, expected {n_places}")
    for h in config.HAZARDS:
        if len(ct["counts"][h]) != k or len(ct["mean_now"][h]) != k:
            raise ValueError(f"continents.{h}: expected {k} entries")
        for row in ct["mean_history"][h]:
            if len(row) != config.HISTORY_DAYS:
                raise ValueError(f"continents.mean_history.{h}: row != {config.HISTORY_DAYS} long")
        for tally in ct["counts"][h]:
            if set(tally) != set(config.CATEGORIES):
                raise ValueError(f"continents.counts.{h}: {tally}")
