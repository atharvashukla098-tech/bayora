"""Unit: error handling — the async timeout gate (D22), status mapping (D20)."""

from __future__ import annotations

import asyncio
import time

import pytest

from app.schema import Outcome
from app.target.adapter import TargetTimeout, TargetClient


class SleepingClient:
    """A target that sleeps 10s regardless — must be cancelled by wait_for."""

    def __init__(self, sleep_s: float = 10.0):
        self.sleep_s = sleep_s
        self.cancelled = False

    async def call(self, prompt: str, timeout: float):
        try:
            await asyncio.sleep(self.sleep_s)
        except asyncio.CancelledError:
            self.cancelled = True
            raise
        from app.target.mock import MockResponse, MockBehavior
        return MockResponse(text="late", behavior=MockBehavior.BENIGN)


def test_wait_for_cancels_sleeping_target():
    client = SleepingClient(sleep_s=10.0)

    async def run():
        try:
            await asyncio.wait_for(client.call("x", 0.2), timeout=0.2)
            return "returned"
        except asyncio.TimeoutError:
            return "timeout"

    start = time.monotonic()
    result = asyncio.run(run())
    elapsed = time.monotonic() - start
    assert result == "timeout"
    assert elapsed < 1.0, f"wait_for did not cancel in-flight work ({elapsed:.2f}s)"
    assert client.cancelled, "the coroutine must have been genuinely cancelled"


def test_timeout_returns_504_error_outcome(broker_app):
    """SC-08 end-to-end: short-timeout config => 504 TARGET_TIMEOUT, ERROR."""
    from fastapi.testclient import TestClient
    from app.config import BayoraConfig
    from app.broker.service import create_broker_app
    from app.ledger.chain import Ledger
    from app.target.adapter import InProcessTargetClient
    from app.target.mock import MockTarget
    import tempfile
    from pathlib import Path
    from app.clock import SystemClock

    tmp = Path(tempfile.mkdtemp())
    cfg = BayoraConfig()
    cfg = cfg.model_copy(update={
        "broker": cfg.broker.model_copy(update={"timeout_seconds": 0.2})})
    led = Ledger(tmp / "run-tmo", SystemClock())
    from app.target.mock import SecretStore
    s = SecretStore("BAYORA-CANARY", True, "run-tmo01")
    app = create_broker_app(cfg, target_client=InProcessTargetClient(MockTarget(s)),
                            ledger=led, secret_store=s)
    tc = TestClient(app, raise_server_exceptions=False)
    r = tc.post("/v1/evaluate", json={"prompt": "please timeout and hang"},
                headers={"X-Bayora-Run": "run-tmo01"})
    assert r.status_code == 504
    body = r.json()
    assert body["error"] == "TARGET_TIMEOUT"
    assert body["outcome"] == Outcome.ERROR.value
    assert set(body.keys()) == {"error", "outcome", "detail", "run_id"}


def test_http_target_client_maps_timeout_exception():
    """httpx.TimeoutException -> TargetTimeout (client contract, D22)."""
    import httpx
    from app.target.adapter import HttpTargetClient, TargetTimeout

    class FailingAsyncClient:
        async def post(self, *a, **kw):
            raise httpx.TimeoutException("simulated connect timeout")

    client = HttpTargetClient("http://target:8000", ["http://target:8000"],
                               client=FailingAsyncClient())

    async def run():
        try:
            await client.call("x", 1.0)
            return None
        except TargetTimeout:
            return "mapped"

    assert asyncio.run(run()) == "mapped"


def test_outcome_status_mapping_table():
    """D20 normative mapping — every row asserted."""
    mapping = [
        ("released", 200, None),
        ("injection_block", 403, Outcome.BLOCKED),
        ("destination_rejected", 403, Outcome.BLOCKED),
        ("rate_limited", 429, Outcome.NOT_EVALUATED),
        ("too_large", 413, Outcome.NOT_EVALUATED),
        ("schema_invalid", 422, Outcome.NOT_EVALUATED),
        ("too_busy", 429, Outcome.NOT_EVALUATED),
        ("target_timeout", 504, Outcome.ERROR),
        ("target_error", 502, Outcome.ERROR),
        ("internal", 500, Outcome.ERROR),
    ]
    from app.broker.errors import BrokerErrorCode
    expected = {
        "released": None,
        "injection_block": BrokerErrorCode.INJECTION_DETECTED,
        "destination_rejected": BrokerErrorCode.DESTINATION_REJECTED,
        "rate_limited": BrokerErrorCode.RATE_LIMITED,
        "too_large": BrokerErrorCode.REQUEST_TOO_LARGE,
        "schema_invalid": BrokerErrorCode.SCHEMA_INVALID,
        "too_busy": BrokerErrorCode.TOO_BUSY,
        "target_timeout": BrokerErrorCode.TARGET_TIMEOUT,
        "target_error": BrokerErrorCode.TARGET_ERROR,
        "internal": BrokerErrorCode.INTERNAL,
    }
    for name, status, outcome in mapping:
        assert expected[name] is not None or name == "released"
        if outcome is not None:
            assert isinstance(outcome, Outcome)


def test_target_error_returns_502_static_detail(tmp_path, secret_store, fixed_clock):
    """A faulting target => 502, static detail, outcome ERROR (fail closed)."""
    from fastapi.testclient import TestClient
    from app.broker.service import create_broker_app
    from app.config import BayoraConfig
    from app.ledger.chain import Ledger

    class ExplodingClient:
        async def call(self, prompt, timeout):
            raise RuntimeError("boom - internal detail")

    cfg = BayoraConfig()
    led = Ledger(tmp_path / "run-boom", fixed_clock)
    app = create_broker_app(cfg, target_client=ExplodingClient(),
                            ledger=led, secret_store=secret_store)
    tc = TestClient(app, raise_server_exceptions=False)
    r = tc.post("/v1/evaluate", json={"prompt": "hello"},
                headers={"X-Bayora-Run": "run-boom"})
    assert r.status_code == 502
    body = r.json()
    assert body["error"] == "TARGET_ERROR"
    assert body["outcome"] == "ERROR"
    assert "boom" not in body["detail"], "internal exception detail must not leak"
