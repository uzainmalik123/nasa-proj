"""Trend engine: Mann-Kendall + Sen's slope per place per variable (PRD §7.2 step 4).

Two windows per variable (docs/contracts.md §3 ``trends.json``):

* ``long``  · 120 monthly means over 10 years. Slope is Sen's slope per month
  x 12, i.e. units per year.
* ``short`` · the last 90 daily values. Slope is Sen's slope per day x 365.25.

Labels: ``rising`` / ``falling`` when p < TREND_P_SIGNIFICANT (direction from
the test statistic's sign), ``stable`` otherwise, ``insufficient`` when fewer
than MIN_LONG / MIN_SHORT valid values exist. A constant series is ``stable`` with slope 0 and p 1.

    uv run python -m trend.mk            # writes data/out/trends.json
    uv run python -m trend.mk --synth    # against data/synth/
"""

from __future__ import annotations

import logging
import sys
import time
import warnings
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pymannkendall as pmk

import config
from trend import load

log = logging.getLogger("trend")

MIN_LONG = 60  # of 120 monthly means
MIN_SHORT = 60  # of 90 daily values
MIN_DAYS_PER_MONTH = 20  # a monthly mean needs this many valid days
POWER_LAG_DAYS = 3  # PRD §6: POWER publishes with ~3 days delay
DAYS_PER_YEAR = 365.25


# ---------------------------------------------------------------------------
# windows
def last_complete_month(today: date, lag_days: int = POWER_LAG_DAYS) -> pd.Period:
    """The newest month whose every day is at or before ``today - lag``."""
    cutoff = today - timedelta(days=lag_days)
    period = pd.Period(cutoff, freq="M")
    if cutoff == period.end_time.date():
        return period
    return period - 1


def long_months(today: date, n: int = config.LONG_WINDOW_MONTHS) -> pd.PeriodIndex:
    end = last_complete_month(today)
    return pd.period_range(end=end, periods=n, freq="M")


def short_days(today: date, n: int = config.SHORT_WINDOW_DAYS) -> pd.DatetimeIndex:
    """The ``n`` calendar days ending yesterday (today's FIRMS day is partial)."""
    end = pd.Timestamp(today) - pd.Timedelta(days=1)
    return pd.date_range(end=end, periods=n, freq="D")


# ---------------------------------------------------------------------------
# the test
def mk_test(
    values: np.ndarray, min_n: int, per_year: float
) -> tuple[float | None, float | None, str]:
    """(slope per year, p, label) for one series. NaNs are skipped."""
    x = np.asarray(values, dtype="float64")
    x = x[np.isfinite(x)]
    if len(x) < min_n:
        return None, None, "insufficient"
    if np.ptp(x) == 0:
        return 0.0, 1.0, "stable"
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        res = pmk.original_test(x, alpha=config.TREND_P_SIGNIFICANT)
    p = float(res.p)
    slope = float(res.slope) * per_year
    if not np.isfinite(p) or not np.isfinite(slope):
        return None, None, "insufficient"
    # direction from the test statistic, not the slope: on tied count data the
    # Sen median can be 0 while the test is clearly one-sided
    label = {"increasing": "rising", "decreasing": "falling"}.get(res.trend, "stable")
    return slope, p, label


def monthly_means(daily: pd.DataFrame, months: pd.PeriodIndex) -> pd.DataFrame:
    """Monthly mean of each daily variable; NaN where fewer than MIN_DAYS_PER_MONTH."""
    sub = daily.loc[(daily.index >= months[0].start_time) & (daily.index <= months[-1].end_time)]
    grp = sub.groupby(sub.index.to_period("M"))
    mean = grp.mean()
    cnt = grp.count()
    mean = mean.mask(cnt < MIN_DAYS_PER_MONTH)
    return mean.reindex(months)


def place_trends(
    daily: pd.DataFrame | None, months: pd.PeriodIndex, days: pd.DatetimeIndex
) -> dict:
    """Trend results for one place: long/short slope, p, label lists + series_long."""
    nvar = len(config.VARIABLES)
    out = {
        "long": {"slope": [None] * nvar, "p": [None] * nvar, "label": ["insufficient"] * nvar},
        "short": {"slope": [None] * nvar, "p": [None] * nvar, "label": ["insufficient"] * nvar},
        "series_long": [[None] * len(months) for _ in range(nvar)],
    }
    if daily is None or daily.empty:
        return out
    mm = monthly_means(daily, months)
    short = daily.reindex(days)
    for j, var in enumerate(config.VARIABLES):
        series = mm[var].to_numpy(dtype="float64")
        out["series_long"][j] = [None if not np.isfinite(v) else round(float(v), 3) for v in series]
        s, p, lab = mk_test(series, MIN_LONG, 12.0)
        out["long"]["slope"][j], out["long"]["p"][j], out["long"]["label"][j] = s, p, lab
        s, p, lab = mk_test(short[var].to_numpy(dtype="float64"), MIN_SHORT, DAYS_PER_YEAR)
        out["short"]["slope"][j], out["short"]["p"][j], out["short"]["label"][j] = s, p, lab
    return out


# ---------------------------------------------------------------------------
# all places
def run_trends(
    places: pd.DataFrame,
    data_dir: Path = config.DATA_DIR,
    today: date | None = None,
) -> dict:
    """``trends.json`` body (everything but ``meta``) for every place, in order."""
    today = today or datetime.now(UTC).date()
    months = long_months(today)
    days = short_days(today)
    counts = load.load_firms_counts(data_dir)
    n = len(places)
    long = {"window": "10y", "slope": [], "p": [], "label": []}
    short = {"window": "90d", "slope": [], "p": [], "label": []}
    series_long = []
    missing = 0
    t0 = time.perf_counter()
    for i, pid in enumerate(places["id"]):
        power = load.load_power(pid, data_dir)
        daily = load.place_daily(pid, power, counts)
        if daily is None:
            missing += 1
        res = place_trends(daily, months, days)
        for key in ("slope", "p", "label"):
            long[key].append(res["long"][key])
            short[key].append(res["short"][key])
        series_long.append(res["series_long"])
        if (i + 1) % 100 == 0:
            log.info("trends %d/%d · %.1fs", i + 1, n, time.perf_counter() - t0)
    log.info(
        "trends done · %d places · %d without POWER cache · %.1fs",
        n,
        missing,
        time.perf_counter() - t0,
    )
    return {
        "variables": list(config.VARIABLES),
        "units": list(config.VARIABLE_UNITS),
        "long": long,
        "short": short,
        "series_long": series_long,
        "months": [str(m) for m in months],
    }


def summary(payload: dict) -> str:
    """One line per variable: label counts for both windows (for logs/handback)."""
    lines = []
    for j, var in enumerate(payload["variables"]):
        for win in ("long", "short"):
            labs = pd.Series([row[j] for row in payload[win]["label"]]).value_counts().to_dict()
            lines.append(f"{var:9} {win:5} {labs}")
    return "\n".join(lines)


def main(argv: list[str]) -> None:
    from publish.write_json import meta, write_json

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s: %(message)s")
    data_dir = config.DATA_DIR / "synth" if "--synth" in argv else config.DATA_DIR
    out_dir = data_dir / "out"
    places = load.load_places(data_dir)
    t0 = time.perf_counter()
    body = run_trends(places, data_dir)
    payload = {"meta": meta(), **body}
    write_json(
        "trends.json",
        payload,
        out_dir,
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
    print(f"trend stage: {time.perf_counter() - t0:.1f}s for {len(places)} places")
    print(summary(body))


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    main(sys.argv[1:])
