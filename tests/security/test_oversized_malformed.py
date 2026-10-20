"""Security: oversized/malformed handling — 413 both paths, 422 no-echo
(D13/D21/D23)."""

from __future__ import annotations

import asyncio
import json

import httpx
from fastapi.testclient import TestClient


def test_wrong_type_422_schema_invalid(broker_client):
    r = broker_client._tc.post("/v1/evaluate", json={"prompt": 42},
                               headers={"X-Bayora-Run": "run-om01"})
    assert r.status_code == 422
    assert r.json()["error"] == "SCHEMA_INVALID"


def test_oversize_content_length_returns_413_from_middleware(broker_client):
    """D21+D23: Content-Length > cap => middleware itself returns 413."""
    r = broker_client._tc.post("/v1/evaluate", json={"prompt": "x" * 9000},
                              headers={"X-Bayora-Run": "run-om02"})
    assert r.status_code == 413
    body = r.json()
    assert body["error"] == "REQUEST_TOO_LARGE"
    assert body["outcome"] == "NOT_EVALUATED"


def test_oversize_handler_path_413_chunked(broker_app):
    """Raw-ASGI streamed body with NO Content-Length => in-handler gate (D21).

    TestClient's json= path always sets Content-Length, so this test drives
    the app over httpx's ASGITransport with an explicit chunked body."""
    async def drive():
        transport = httpx.ASGITransport(app=broker_app)
        async with httpx.AsyncClient(transport=transport,
                                     base_url="http://test") as client:
            huge = b'{"prompt": "' + b"x" * 9000 + b'"}'
            return await client.post(
                "/v1/evaluate",
                headers={"content-type": "application/json",
                         "X-Bayora-Run": "run-om03"},
                content=huge)

    resp = asyncio.run(drive())
    assert resp.status_code == 413, \
        "a >cap body with no Content-Length must hit the in-handler double gate"
    assert resp.json()["error"] == "REQUEST_TOO_LARGE"


def test_422_body_is_brokererror_never_echoes_input(broker_client):
    sentinel = "ZQXSENTINEL99887766"
    r = broker_client._tc.post("/v1/evaluate",
                               json={"prompt": sentinel, "extra": "field"},
                               headers={"X-Bayora-Run": "run-om04"})
    assert r.status_code == 422
    raw = r.text
    assert sentinel not in raw, "submitted values must never be echoed"
    body = r.json()
    assert body["error"] == "SCHEMA_INVALID"
    assert body["outcome"] == "NOT_EVALUATED"
    assert body["run_id"] == "run-om04"
    # and a POLICY_DECISION event exists for the header run
    # (recorded via the RejectionBuffer's individual path)


def test_413_body_has_no_prompt_text(broker_client):
    prompt = "y" * 9000
    r = broker_client._tc.post("/v1/evaluate", json={"prompt": prompt},
                               headers={"X-Bayora-Run": "run-om05"})
    assert r.status_code == 413
    assert "yyyy" not in r.text, "no substring of the oversized prompt may leak"


def test_malformed_json_body_rejected(broker_client):
    r = broker_client._tc.post("/v1/evaluate", content=b"{not json",
                               headers={"content-type": "application/json",
                                        "X-Bayora-Run": "run-om06"})
    assert r.status_code == 422
    assert r.json()["error"] == "SCHEMA_INVALID"


def test_no_stack_traces_in_any_error_body(broker_client, tmp_path,
                                           secret_store, fixed_clock):
    """A raising target => 502 with a static message, never a traceback."""
    from app.broker.service import create_broker_app
    from app.config import BayoraConfig
    from app.ledger.chain import Ledger

    class ExplodingTarget:
        async def call(self, prompt, timeout):
            raise RuntimeError("SECRET_INTERNAL_DETAIL / C:\\users\\admin")

    cfg = BayoraConfig()
    led = Ledger(tmp_path / "run-om07", fixed_clock)
    app = create_broker_app(cfg, target_client=ExplodingTarget(),
                            ledger=led, secret_store=secret_store)
    tc = TestClient(app, raise_server_exceptions=False)
    r = tc.post("/v1/evaluate", json={"prompt": "hi"},
                headers={"X-Bayora-Run": "run-om07"})
    assert r.status_code in (500, 502)
    body = r.json()
    assert set(body.keys()) == {"error", "outcome", "detail", "run_id"}
    assert "Traceback" not in r.text
    assert "SECRET_INTERNAL_DETAIL" not in r.text
    assert "RuntimeError" not in r.text
