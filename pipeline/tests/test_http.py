import pytest
import requests

from ingest import _http


class _Resp:
    def __init__(self, status, headers):
        self.status_code, self.headers, self.reason = status, headers, "x"

    def raise_for_status(self):
        pass


def test_long_retry_after_raises_at_once(monkeypatch):
    calls = []

    class S:
        def get(self, url, params=None, timeout=None):
            calls.append(1)
            return _Resp(429, {"Retry-After": "47089"})

    monkeypatch.setattr(_http, "session", lambda: S())
    monkeypatch.setattr(_http.time, "sleep", lambda s: pytest.fail("slept"))
    with pytest.raises(_http.RateLimited) as e:
        _http.get("http://x", label="om")
    assert e.value.retry_after == 47089 and len(calls) == 1
    assert isinstance(e.value, requests.HTTPError)


def test_short_retry_after_still_retries(monkeypatch):
    seq = [_Resp(429, {"Retry-After": "1"}), _Resp(200, {})]
    slept = []

    class S:
        def get(self, url, params=None, timeout=None):
            return seq.pop(0)

    monkeypatch.setattr(_http, "session", lambda: S())
    monkeypatch.setattr(_http.time, "sleep", lambda s: slept.append(s))
    assert _http.get("http://x").status_code == 200 and slept == [1]
