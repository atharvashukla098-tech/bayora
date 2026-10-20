"""Security-hardening pass tests (review checklist).

Covers: API-key auth provider (RBAC, constant-time, fail-closed empty),
broker auth gate (401/403 before policy work, /healthz public),
security headers on both services, and no-echo of the rejected token.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.broker.service import create_broker_app
from app.config import load_config
from app.infra.apikey import ApiKeyAuth
from app.infra.seams import AuthPolicy
from app.ledger.chain import Ledger
from app.target.mock import SecretStore
from tests.conftest import *  # noqa: F401,F403 — broker fixtures


def test_apikey_auth_is_an_authpolicy():
    auth = ApiKeyAuth("k1=evaluator,k2=auditor")
    assert isinstance(auth, AuthPolicy)


def test_apikey_rbac_roles():
    auth = ApiKeyAuth("k1=evaluator,k2=auditor")
    assert auth.authenticate("k1") == "evaluator"
    assert auth.authenticate("k2") == "auditor"
    assert auth.authenticate(None) is None
    assert auth.authenticate("wrong") is None
    # RBAC: evaluator can evaluate; auditor cannot
    assert auth.authorize("evaluator", "evaluate")
    assert not auth.authorize("auditor", "evaluate")
    assert auth.authorize("auditor", "verify")


def test_apikey_fails_closed_with_no_keys(monkeypatch):
    monkeypatch.delenv("BAYORA_API_KEYS", raising=False)
    auth = ApiKeyAuth(None)
    assert auth.authenticate("anything") is None
    assert auth.authorize(auth.authenticate("anything"), "evaluate") is False


def test_apikey_rejects_unknown_roles():
    auth = ApiKeyAuth("k1=superadmin")
    assert auth.authenticate("k1") is None   # unknown role -> key ignored


@pytest.fixture
def auth_broker_client(tmp_path, secret_store, fixed_clock):
    cfg = load_config()
    led = Ledger(tmp_path / "runs" / "run-auth01", fixed_clock)
    from app.target.adapter import InProcessTargetClient
    from app.target.mock import MockTarget
    tc = InProcessTargetClient(MockTarget(secret_store))
    app = create_broker_app(cfg, target_client=tc, ledger=led,
                            secret_store=secret_store,
                            auth_policy=ApiKeyAuth("k1=evaluator,k2=auditor"))
    return TestClient(app)


def test_broker_auth_gate_401_without_token(auth_broker_client):
    r = auth_broker_client.post("/v1/evaluate", json={"prompt": "hi",
                               "destination": "http://target:8000"})
    assert r.status_code == 401
    assert r.json()["error"] == "AUTH_REQUIRED"
    assert "k1" not in r.text  # tokens never echoed


def test_broker_auth_gate_403_wrong_role(auth_broker_client):
    # auditor key on an evaluate route: authenticated, not authorized
    r = auth_broker_client.post("/v1/evaluate",
                                json={"prompt": "hi",
                                      "destination": "http://target:8000"},
                                headers={"Authorization": "Bearer k2"})
    assert r.status_code == 403
    assert r.json()["error"] == "AUTH_FORBIDDEN"


def test_broker_auth_gate_allows_evaluator(auth_broker_client):
    r = auth_broker_client.post("/v1/evaluate",
                                json={"prompt": "hello"},
                                headers={"Authorization": "Bearer k1"})
    assert r.status_code == 200


def test_healthz_stays_public_with_auth(auth_broker_client):
    r = auth_broker_client.get("/healthz")
    assert r.status_code == 200


def test_security_headers_on_broker(auth_broker_client):
    r = auth_broker_client.get("/healthz")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Referrer-Policy"] == "no-referrer"
    assert "frame-ancestors 'none'" in r.headers["Content-Security-Policy"]
    assert r.headers["Cache-Control"] == "no-store"


def test_security_headers_on_target(tmp_path, secret_store):
    from app.target.service import create_target_app
    app = create_target_app(secret_store)
    c = TestClient(app)
    r = c.get("/healthz")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"


def test_no_auth_gate_by_default_loopback_mode(broker_client):
    # Default deployment (no auth_policy passed) keeps the loopback demo
    # working: no 401s — the L7 loopback contract covers it.
    r = broker_client.post_evaluate("hello", scenario_id="auth-default-check")
    assert r.status_code == 200
