"""Alert feed (PRD §7.2 step 9): events persisted in feed.json.

A place raises an alert for a hazard when, on a given day,
  * ``category_up``: its category moves up into "high" or "extreme"
  * ``z_above_2``: its risk value is more than ALERT_Z sd above its own
    trailing 90-day mean (and the category is not "low")
  * ``new_anomaly``: a |z| > ANOMALY_Z anomaly flag (30-day rain, soil
    wetness, 7-day max temperature) appears that was absent the day before
    (dry rain / soil → drought, wet rain → rain, hot → heat; category not "low")

in that priority, at most one per place per hazard per ALERT_COOLDOWN_DAYS.
The first run seeds the feed by replaying the last SEED_DAYS days of the
hindcast history; later runs read the previous feed.json (restored from the
data branch), expire old alerts, and mark a re-triggered alert "updated".
Replayed alerts carry the current run's severity / exposure / confidence,
which the explanation says.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

import numpy as np

import config
from hazards import common

log = logging.getLogger("publish.feed")

SEED_DAYS = 30
Z_MIN_HISTORY = 30
ISO_MIN = "%Y-%m-%dT%H:%MZ"
ID_FMT = "%Y%m%dT%H%MZ"
VALUE_KEY = {"wildfire": "p", "drought": "index", "heat": "days_above", "rain": "p"}
CAT_RANK = {c: k for k, c in enumerate(config.CATEGORIES)}
TRIGGER_WORDS = {
    "category_up": "crossed up into",
    "z_above_2": "jumped more than 2 sd above its 90-day mean, now",
    "new_anomaly": "gained a new anomaly flag, now",
}
HAZARD_WORDS = {
    "wildfire": "Wildfire risk",
    "drought": "Drought index",
    "heat": "Heat (days above the 95th percentile)",
    "rain": "Heavy-rain chance",
}


def _value_matrix(risk: dict, hazard: str) -> np.ndarray:
    """(n_places, 91): the 90 history values then today's value, NaN for null."""
    hist = np.array(
        [[np.nan if v is None else v for v in row] for row in risk["history"][hazard]],
        dtype="float64",
    )
    now = np.array([r[hazard][VALUE_KEY[hazard]] for r in risk["now"]], dtype="float64")
    return np.column_stack([hist, now])


def _risk_direction(hazard: str, v: np.ndarray) -> np.ndarray:
    return -v if hazard == "drought" else v


def _anomaly_flags(zscores: dict, i: int, t: int) -> dict[str, str]:
    """{'rain': 'dry'|'wet', 'soil': 'dry'|'wet', 'tmax': 'hot'|'cold'} at day t."""
    out = {}
    for k, z in zscores.items():
        v = z[i, t]
        if not np.isfinite(v) or abs(v) <= config.ANOMALY_Z:
            continue
        if k == "tmax":
            out[k] = "hot" if v > 0 else "cold"
        else:
            out[k] = "wet" if v > 0 else "dry"
    return out


def _anomaly_hazards(flags: dict[str, str]) -> set[str]:
    out = set()
    if flags.get("rain") == "dry" or flags.get("soil") == "dry":
        out.add("drought")
    if flags.get("rain") == "wet":
        out.add("rain")
    if flags.get("tmax") == "hot":
        out.add("heat")
    return out


def _trigger(hazard: str, vals: np.ndarray, t: int, flags_t: dict, flags_prev: dict) -> str | None:
    v, prev = vals[t], vals[t - 1] if t > 0 else np.nan
    if not np.isfinite(v):
        return None
    cat = common.category(hazard, v)
    cat_prev = common.category(hazard, prev) if np.isfinite(prev) else "low"
    if CAT_RANK[cat] >= CAT_RANK["high"] and CAT_RANK[cat] > CAT_RANK[cat_prev]:
        return "category_up"
    if cat == "low":
        return None
    lo = max(0, t - config.HISTORY_DAYS)
    win = _risk_direction(hazard, vals[lo:t])
    win = win[np.isfinite(win)]
    if len(win) >= Z_MIN_HISTORY:
        sd = float(win.std())
        if sd > 1e-6 and _risk_direction(hazard, v) > win.mean() + config.ALERT_Z * sd:
            return "z_above_2"
    new = _anomaly_hazards(flags_t) - _anomaly_hazards(flags_prev)
    if hazard in new:
        return "new_anomaly"
    return None


def _fmt_value(hazard: str, v: float) -> str:
    if hazard in ("wildfire", "rain"):
        return f"{v * 100:.0f}%"
    if hazard == "drought":
        return f"{v:+.1f}"
    return f"{int(v)} days"


def build(
    places,
    risk: dict,
    zscores: dict[str, np.ndarray],
    zdays: list[str],
    today: date,
    issued_now: datetime,
    model_version: str,
    evidence: list[str],
    previous: dict | None,
) -> list[dict]:
    n = len(places)
    days = [date.fromisoformat(d) for d in zdays]
    t_today = len(days) - 1
    values = {h: _value_matrix(risk, h) for h in config.HAZARDS}
    assert all(values[h].shape == (n, len(days)) for h in config.HAZARDS)

    # previous alerts, keyed by (place, hazard) → newest
    alerts: dict[str, dict] = {}
    last_for: dict[tuple[int, str], dict] = {}
    for a in (previous or {}).get("alerts", []):
        a = dict(a)
        a["status"] = "expired" if date.fromisoformat(a["valid_to"]) < today else a["status"]
        alerts[a["id"]] = a
        key = (int(a["place"]), a["hazard"])
        if key not in last_for or a["issued_at"] > last_for[key]["issued_at"]:
            last_for[key] = a
    n_prev = len(alerts)

    start_t = max(1, t_today - SEED_DAYS) if previous is None else t_today
    n_new = n_updated = 0
    for t in range(start_t, t_today + 1):
        day = days[t]
        is_today = t == t_today
        issued = issued_now if is_today else datetime.combine(day, datetime.min.time())
        for i in range(n):
            flags_t = _anomaly_flags(zscores, i, t)
            flags_prev = _anomaly_flags(zscores, i, t - 1) if t > 0 else {}
            for h in config.HAZARDS:
                trig = _trigger(h, values[h][i], t, flags_t, flags_prev)
                if trig is None:
                    continue
                key = (i, h)
                prev_alert = last_for.get(key)
                if prev_alert is not None:
                    since = (day - date.fromisoformat(prev_alert["valid_from"])).days
                    if since < config.ALERT_COOLDOWN_DAYS:
                        if is_today and prev_alert["id"] in alerts:
                            a = alerts[prev_alert["id"]]
                            a.update(_fields(risk, i, h, values[h][i, t], trig, is_today, day))
                            a["status"] = "updated"
                            a["evidence"] = evidence
                            a["model_version"] = model_version
                            n_updated += 1
                        continue
                a = {
                    "id": f"{issued.strftime(ID_FMT)}-{places.iloc[i]['id']}-{h}",
                    "hazard": h,
                    "place": i,
                    "place_id": str(places.iloc[i]["id"]),
                    "issued_at": issued.strftime(ISO_MIN),
                    "valid_from": day.isoformat(),
                    "valid_to": (day + timedelta(days=config.HORIZON_DAYS)).isoformat(),
                    "trigger": trig,
                    **_fields(risk, i, h, values[h][i, t], trig, is_today, day),
                    "evidence": evidence,
                    "anomalies": sorted(flags_t),
                    "status": "active"
                    if day + timedelta(days=config.HORIZON_DAYS) >= today
                    else "expired",
                    "model_version": model_version,
                }
                alerts[a["id"]] = a
                last_for[key] = a
                n_new += 1
    out = sorted(
        alerts.values(),
        key=lambda a: (a["issued_at"], CAT_RANK[a["category"]], a["exposure"], a["id"]),
        reverse=True,
    )
    out = out[: config.FEED_MAX]
    log.info(
        "feed · %d previous · %d new · %d updated · %d kept (max %d) · replayed from %s",
        n_prev,
        n_new,
        n_updated,
        len(out),
        config.FEED_MAX,
        days[start_t].isoformat(),
    )
    return out


def _fields(risk: dict, i: int, h: str, v: float, trig: str, is_today: bool, day: date) -> dict:
    rec = risk["now"][i][h]
    cat = common.category(h, v)
    place_text = risk["text"][i][h]
    if is_today:
        explanation = place_text
    else:
        explanation = (
            f"{HAZARD_WORDS[h]} {TRIGGER_WORDS[trig]} {cat} ({_fmt_value(h, v)}) on "
            f"{day.isoformat()}, from the 90-day hindcast replayed when the feed was seeded; "
            f"severity, exposure and confidence are the current run's."
        )
    return {
        "probability": round(float(v), 3) if h in ("wildfire", "rain") else None,
        "severity": rec["severity"],
        "exposure": rec["exposure"],
        "confidence": rec["confidence"],
        "category": cat,
        "explanation": explanation,
    }
