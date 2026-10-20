"""Unit: report signing + the D15 two-party protocol."""

from __future__ import annotations

import json

import pytest

from app.reporting.report import AuditReport, EnvironmentBlock, LedgerBlock
from app.reporting.signing import (
    canonical_report_bytes, sign_report, verify_report_signature,
)
from app.reporting.status import AssertionCounts
from app.schema import ReportStatus, SCHEMA_VERSION_CURRENT


def _report() -> AuditReport:
    from app.reporting.report import ScenarioRow
    from app.reporting.status import VerificationStep
    return AuditReport(
        run_id="run-rs01",
        verification_timestamp="2026-01-01T00:00:00+00:00",
        target_mode="deterministic_mock",
        environment=EnvironmentBlock(offline_mode=True, docker_available=False,
                                      docker_compose_available=False, os="test"),
        assertions=AssertionCounts(total=3, passed=3, failed=0, errors=0,
                                   skipped=0, not_evaluated=0),
        scenario_results=[ScenarioRow(
            scenario_id="SC-01", name="injection", status="PASS",
            outcome="DETECTED", skip_reason=None, evidence_event_ids=["e1"],
            checks=[])],
        ledger=LedgerBlock(block_height=5, chain_valid=True,
                           checkpoint_present=True, checkpoint_seq=5,
                           checkpoint_signature_valid=True,
                           truncation_check_possible=True,
                           checkpoint_coverage="full"),
        verification_steps=[VerificationStep(
            name="ledger_chain", required=True, executed=True,
            result="pass", evidence="fresh verify")],
        limitations=[],
        status=ReportStatus.VERIFIED,
        report_signature=__import__("app.reporting.report", fromlist=["ReportSignature"]).ReportSignature(
            key_id="local-demo-key"),
        ledger_path="runs/run-rs01/ledger.jsonl",
    )


def test_signed_report_verifies(tmp_path, dev_key):
    priv, _kid, pub = dev_key
    r = sign_report(_report(), priv)
    assert r.report_signature.signature
    assert verify_report_signature(r, pub)


def test_tampered_report_fails(tmp_path, dev_key):
    priv, _kid, pub = dev_key
    r = sign_report(_report(), priv)
    tampered = r.model_copy(update={"status": ReportStatus.FAILED})
    assert not verify_report_signature(tampered, pub), \
        "flipping a signed field must break the signature"


def test_status_field_is_inside_signed_scope(tmp_path, dev_key):
    priv, _kid, pub = dev_key
    r = sign_report(_report(), priv)
    data = json.loads(r.model_dump_json())
    data["status"] = "VERIFIED_WITH_LIMITATIONS"
    # simulate: a byte-level flip of status in the exported JSON breaks verify
    r2 = AuditReport.model_validate(data)
    assert not verify_report_signature(r2, pub)


def test_unsigned_report_rejected_by_verifier(dev_key):
    _priv, _kid, pub = dev_key
    r = _report()   # signature is None
    assert not verify_report_signature(r, pub), \
        "an unsigned VERIFIED report must NOT pass signature verification"


def test_canonical_bytes_exclude_signature_and_fix_order(dev_key):
    priv, _kid, _pub = dev_key
    r = sign_report(_report(), priv)
    b = canonical_report_bytes(r)
    obj = json.loads(b)
    assert "signature" not in obj["report_signature"]
    assert list(obj.keys()) == [
        "schema_version", "platform", "platform_version", "run_id",
        "verification_timestamp", "target_mode", "environment", "assertions",
        "scenario_results", "ledger", "verification_steps", "limitations",
        "status", "report_signature"]
    assert obj["schema_version"] == SCHEMA_VERSION_CURRENT


def test_key_id_is_signed(tmp_path, dev_key):
    """key_id identifies which key must verify — it is inside the scope."""
    priv, _kid, pub = dev_key
    r = sign_report(_report(), priv)
    tampered = r.model_copy(update={
        "report_signature": r.report_signature.model_copy(
            update={"key_id": "attacker-key"})})
    assert not verify_report_signature(tampered, pub)
