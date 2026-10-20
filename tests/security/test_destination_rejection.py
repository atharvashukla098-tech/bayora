"""Security: destination rejection + outcome on every error body (D20)."""

from __future__ import annotations

import httpx
import pytest

from app.target.adapter import destination_allowed


def test_check_destination_route_403(broker_client):
    r = broker_client.post_check_destination(
        "http://external.example:9000/egress", run_id="run-dr01",
        scenario_id="SC-03")
    assert r.status_code == 403
    body = r.json()
    assert body["error"] == "DESTINATION_REJECTED"
    assert body["outcome"] == "BLOCKED"
    assert set(body.keys()) == {"error", "outcome", "detail", "run_id"}


def test_check_destination_allowed_url_passes(broker_client):
    from app.config import BayoraConfig
    allowed = BayoraConfig().broker.allow_destinations[0]
    r = broker_client.post_check_destination(allowed, run_id="run-dr02")
    assert r.status_code == 200
    assert r.json()["allowed"] is True


def test_nonallowlisted_destination_blocked():
    assert not destination_allowed("http://evil.example", ["http://target:8000"])
    assert not destination_allowed("https://target:8000", ["http://target:8000"]), \
        "scheme mismatch must not pass"
    assert not destination_allowed("http://target:9000", ["http://target:8000"])
    assert not destination_allowed("not a url", ["http://target:8000"])


def test_user_supplied_url_cannot_become_destination(broker_client):
    """extra=forbid: a smuggled destination field is a schema violation."""
    r = broker_client._tc.post(
        "/v1/evaluate",
        json={"prompt": "hi", "destination": "http://evil.example"},
        headers={"X-Bayora-Run": "run-dr03"})
    assert r.status_code == 422
    assert r.json()["error"] == "SCHEMA_INVALID"


def test_error_bodies_carry_outcome(broker_client, broker_app):
    """D20: EVERY error path returns a body with the mandatory outcome field."""
    cases = []

    # 422 schema
    r = broker_client._tc.post("/v1/evaluate", json={"prompt": 42},
                               headers={"X-Bayora-Run": "run-dr04"})
    cases.append((422, r, "NOT_EVALUATED"))
    # 413 size
    r = broker_client._tc.post("/v1/evaluate", json={"prompt": "x" * 9000},
                               headers={"X-Bayora-Run": "run-dr04"})
    cases.append((413, r, "NOT_EVALUATED"))
    # 403 destination
    r = broker_client.post_check_destination("http://evil.example:1",
                                             run_id="run-dr04")
    cases.append((403, r, "BLOCKED"))
    # 200 benign (control)
    r = broker_client.post_evaluate("hello", run_id="run-dr04")
    cases.append((200, r, None))

    for expected_status, resp, expected_outcome in cases:
        body = resp.json()
        if expected_outcome is None:
            assert "outcome" in body  # success path carries it too
            continue
        assert resp.status_code == expected_status
        assert body["outcome"] == expected_outcome, \
            f"status {expected_status}: outcome must be {expected_outcome}"
        assert set(body.keys()) == {"error", "outcome", "detail", "run_id"}


def test_allowlisted_host_different_path_still_allowed_only_by_match():
    """The allowlist matches scheme+host+port; the route stays policy-only."""
    assert destination_allowed("http://target:8000/v1/respond",
                               ["http://target:8000"])
    assert not destination_allowed("http://target.evil.com:8000",
                                   ["http://target:8000"]), \
        "host suffix tricks must not pass"
