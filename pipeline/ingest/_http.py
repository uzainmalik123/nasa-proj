"""Shared HTTP helpers for the ingest modules: retry with backoff and a pacer.

Every upstream (FIRMS, POWER, Open-Meteo) gets the same treatment: up to
``tries`` attempts, exponential backoff on 429/5xx and on connection errors,
and a global per-host pacer so N worker threads never exceed one request per
``pace_s`` seconds in aggregate.
"""

from __future__ import annotations

import logging
import threading
import time

import requests

log = logging.getLogger("ingest.http")

RETRY_STATUS = {429, 500, 502, 503, 504}
# a 429 whose Retry-After is longer than this is a quota ban (Open-Meteo answers
# with the seconds until midnight UTC); raise at once instead of retrying
RETRY_AFTER_MAX_S = 300


class RateLimited(requests.HTTPError):
    """429 with a Retry-After beyond ``RETRY_AFTER_MAX_S``: do not retry this run."""

    def __init__(self, label: str, retry_after: int, response=None) -> None:
        super().__init__(f"{label}: rate limited for {retry_after} s", response=response)
        self.retry_after = retry_after


UA = "earth-trend-detective/0.1 (hackathon pipeline; github.com/uzainmalik123/nasa-proj)"


class Pacer:
    """Enforce a minimum interval between request *starts* across threads."""

    def __init__(self, interval_s: float) -> None:
        self.interval = max(0.0, interval_s)
        self._lock = threading.Lock()
        self._next = 0.0

    def wait(self) -> None:
        if self.interval <= 0:
            return
        with self._lock:
            now = time.monotonic()
            start = max(now, self._next)
            self._next = start + self.interval
        delay = start - time.monotonic()
        if delay > 0:
            time.sleep(delay)


_session_local = threading.local()


def session() -> requests.Session:
    s = getattr(_session_local, "s", None)
    if s is None:
        s = requests.Session()
        s.headers["User-Agent"] = UA
        _session_local.s = s
    return s


def get(
    url: str,
    *,
    params: dict | None = None,
    timeout: float = 120,
    tries: int = 3,
    backoff_s: float = 2.0,
    pacer: Pacer | None = None,
    label: str = "",
) -> requests.Response:
    """GET with retries on 429/5xx and network errors. Raises after ``tries``."""
    last: Exception | None = None
    for attempt in range(1, tries + 1):
        if pacer is not None:
            pacer.wait()
        try:
            r = session().get(url, params=params, timeout=timeout)
        except requests.RequestException as e:  # connection reset, timeout, ...
            last = e
            log.warning("%s attempt %d/%d: %s", label or url, attempt, tries, e)
        else:
            if r.status_code not in RETRY_STATUS:
                r.raise_for_status()
                return r
            last = requests.HTTPError(f"{r.status_code} {r.reason}", response=r)
            retry_after = r.headers.get("Retry-After")
            log.warning(
                "%s attempt %d/%d: HTTP %d%s",
                label or url,
                attempt,
                tries,
                r.status_code,
                f" (Retry-After {retry_after})" if retry_after else "",
            )
            if retry_after and retry_after.isdigit():
                if r.status_code == 429 and int(retry_after) > RETRY_AFTER_MAX_S:
                    raise RateLimited(label or url, int(retry_after), response=r)
                time.sleep(min(int(retry_after), 120))
                continue
        if attempt < tries:
            time.sleep(backoff_s * (2 ** (attempt - 1)))
    assert last is not None
    raise last
