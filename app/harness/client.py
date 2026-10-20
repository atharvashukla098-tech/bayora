"""Broker clients (blueprint §9.5, D23).

``InProcessBrokerClient`` is Starlette's TestClient over the REAL ASGI app:
httpx in memory, zero sockets, but the FULL middleware stack runs — the rate
and size gates, the no-echo validation handler, and X-Bayora-Run headers are
real HTTP headers. Every offline scenario therefore tests the same code path
as Docker mode. The chunked/no-Content-Length gate is exercised by a raw-ASGI
test (httpx ASGITransport with a streamed body), because TestClient's json=
path always sets Content-Length.
"""

from __future__ import annotations

from typing import Optional, Protocol, runtime_checkable

import httpx


@runtime_checkable
class BrokerClient(Protocol):
    def post_evaluate(self, prompt: str, *, run_id: Optional[str],
                      scenario_id: Optional[str]) -> httpx.Response: ...
    def post_evaluate_raw(self, content: bytes, *, run_id: Optional[str],
                          scenario_id: Optional[str]) -> httpx.Response: ...
    def post_check_destination(self, url: str, *, run_id: Optional[str],
                               scenario_id: Optional[str]) -> httpx.Response: ...


class InProcessBrokerClient:
    """Local demo path (D1 + D23): TestClient(broker_app, raise False)."""

    def __init__(self, broker_app):
        from fastapi.testclient import TestClient
        self._tc = TestClient(broker_app, raise_server_exceptions=False)

    def _headers(self, run_id: Optional[str], scenario_id: Optional[str]) -> dict:
        headers = {}
        if run_id:
            headers["X-Bayora-Run"] = run_id
        if scenario_id:
            headers["X-Bayora-Scenario"] = scenario_id
        return headers

    def post_evaluate(self, prompt: str, *, run_id: Optional[str] = None,
                      scenario_id: Optional[str] = None) -> httpx.Response:
        return self._tc.post("/v1/evaluate", json={"prompt": prompt},
                             headers=self._headers(run_id, scenario_id))

    def post_evaluate_raw(self, content: bytes, *, run_id: Optional[str] = None,
                          scenario_id: Optional[str] = None) -> httpx.Response:
        """Raw-content evaluate (SC-06's oversized/wrong-type bodies)."""
        return self._tc.post("/v1/evaluate", content=content,
                            headers=self._headers(run_id, scenario_id))

    def post_check_destination(self, url: str, *, run_id: Optional[str] = None,
                               scenario_id: Optional[str] = None) -> httpx.Response:
        return self._tc.post("/v1/check-destination", json={"url": url},
                             headers=self._headers(run_id, scenario_id))


class HttpBrokerClient:
    """Docker mode: httpx.Client with fail-closed transport handling."""

    def __init__(self, base_url: str, timeout: float = 10.0):
        self._client = httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout)

    def post_evaluate(self, prompt: str, *, run_id: Optional[str] = None,
                      scenario_id: Optional[str] = None) -> httpx.Response:
        headers = {}
        if run_id:
            headers["X-Bayora-Run"] = run_id
        if scenario_id:
            headers["X-Bayora-Scenario"] = scenario_id
        return self._client.post("/v1/evaluate", json={"prompt": prompt},
                                 headers=headers)

    def post_evaluate_raw(self, content: bytes, *, run_id: Optional[str] = None,
                          scenario_id: Optional[str] = None) -> httpx.Response:
        """Raw-content evaluate for SC-06's wrong-type bodies (Docker parity)."""
        headers = {"content-type": "application/json"}
        if run_id:
            headers["X-Bayora-Run"] = run_id
        if scenario_id:
            headers["X-Bayora-Scenario"] = scenario_id
        return self._client.post("/v1/evaluate", content=content,
                                 headers=headers)

    def post_check_destination(self, url: str, *, run_id: Optional[str] = None,
                               scenario_id: Optional[str] = None) -> httpx.Response:
        headers = {}
        if run_id:
            headers["X-Bayora-Run"] = run_id
        if scenario_id:
            headers["X-Bayora-Scenario"] = scenario_id
        return self._client.post("/v1/check-destination", json={"url": url},
                                 headers=headers)
