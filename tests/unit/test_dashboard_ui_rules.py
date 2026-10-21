"""Unit tests for the dossier dashboard's pure rules:

* report status rules (spec §8) — independent UI recomputation
* outcome / result enum consistency with the spec
* UI-layer redaction (defense in depth)
* matrix summary denominators (spec §7)
* scenario catalogue coverage of the spec §7 attack vectors
* artifact-client mapping helpers (scene map, component labels)
"""

from __future__ import annotations

import pytest

from app.dashboard.artifact_client import (
    COMPONENT_LABELS,
    MESSAGES,
    SCENE_FOR_SCENARIO,
)
from app.dashboard.models import (
    BADGE_COLOR,
    AssertionResult,
    Event,
    Outcome,
    ReportStatus,
    badge_color,
    compute_report_status,
    normalize_result,
    redact,
    redact_obj,
    summarize,
)
from app.harness.scenarios import build_catalogue

VALID_BADGES = {"red", "orange", "yellow", "blue", "green", "violet",
                "gray", "grey", "primary"}


def _base_report() -> dict:
    return {
        "schema_version": "1.0",
        "platform": "Bayora",
        "platform_version": "1.0.0",
        "run_id": "test-run",
        "verification_timestamp": "2026-10-21T00:00:00Z",
        "target_mode": "deterministic_mock",
        "environment": {"offline_mode": True, "docker_available": False,
                        "os": "test"},
        "assertions": {"total": 8, "passed": 8, "failed": 0,
                       "errors": 0, "skipped": 0, "not_evaluated": 0},
        "ledger": {"block_height": 10, "chain_valid": True,
                   "checkpoint_present": True,
                   "checkpoint_signature_valid": True},
        "report_signature": {"algorithm": "Ed25519", "key_id": "k",
                             "signature": "sig"},
        "status": "VERIFIED",
    }


# ------------------------------------------------------- report status rules

def test_clean_report_is_verified():
    assert compute_report_status(_base_report()) is ReportStatus.VERIFIED


def test_zero_assertions_is_not_verified():
    r = _base_report()
    r["assertions"]["total"] = 0
    assert compute_report_status(r) is ReportStatus.NOT_VERIFIED


def test_missing_signature_is_not_verified():
    r = _base_report()
    r["report_signature"]["signature"] = None
    assert compute_report_status(r) is ReportStatus.NOT_VERIFIED


def test_empty_ledger_is_not_verified():
    r = _base_report()
    r["ledger"] = {"block_height": 0, "chain_valid": False,
                   "checkpoint_present": False,
                   "checkpoint_signature_valid": False}
    assert compute_report_status(r) is ReportStatus.NOT_VERIFIED


def test_failed_assertion_is_failed():
    r = _base_report()
    r["assertions"]["failed"] = 1
    r["assertions"]["passed"] = 7
    assert compute_report_status(r) is ReportStatus.FAILED


def test_error_assertion_is_failed():
    r = _base_report()
    r["assertions"]["errors"] = 1
    r["assertions"]["passed"] = 7
    assert compute_report_status(r) is ReportStatus.FAILED


def test_broken_chain_is_failed():
    r = _base_report()
    r["ledger"]["chain_valid"] = False
    assert compute_report_status(r) is ReportStatus.FAILED


def test_invalid_checkpoint_signature_is_failed():
    r = _base_report()
    r["ledger"]["checkpoint_signature_valid"] = False
    assert compute_report_status(r) is ReportStatus.FAILED


def test_inconsistent_counts_are_failed():
    r = _base_report()
    r["assertions"]["passed"] = 5  # 5 != total 8 with everything else zero
    assert compute_report_status(r) is ReportStatus.FAILED


def test_skipped_assertions_are_limitations():
    r = _base_report()
    r["assertions"]["skipped"] = 1
    r["assertions"]["passed"] = 7
    assert compute_report_status(r) is ReportStatus.VERIFIED_WITH_LIMITATIONS


def test_missing_checkpoint_is_limitations():
    r = _base_report()
    r["ledger"]["checkpoint_present"] = False
    r["ledger"]["checkpoint_signature_valid"] = False
    assert compute_report_status(r) is ReportStatus.VERIFIED_WITH_LIMITATIONS


def test_backend_claim_is_not_trusted():
    r = _base_report()
    r["ledger"]["chain_valid"] = False
    r["status"] = "VERIFIED"
    assert compute_report_status(r) is ReportStatus.FAILED


# ----------------------------------------------------------- enum consistency

def test_outcome_states_match_spec():
    assert {o.value for o in Outcome} == {
        "DETECTED", "BLOCKED", "REDACTED", "ALLOWED",
        "ERROR", "NOT_EVALUATED",
    }


def test_assertion_results_match_spec():
    assert {r.value for r in AssertionResult} == {
        "PASS", "FAIL", "ERROR", "SKIPPED", "NOT_EVALUATED",
    }


def test_report_statuses_match_spec():
    assert {s.value for s in ReportStatus} == {
        "VERIFIED", "VERIFIED_WITH_LIMITATIONS", "FAILED", "NOT_VERIFIED",
    }


def test_all_spec_states_have_valid_badge_colors():
    states = ([o.value for o in Outcome]
              + [r.value for r in AssertionResult]
              + [s.value for s in ReportStatus]
              + ["UNAVAILABLE", "UNKNOWN", "VALID", "INVALID", "STALE"])
    for state in states:
        assert badge_color(state) in VALID_BADGES, state


def test_badge_color_table_values_are_valid():
    assert set(BADGE_COLOR.values()) <= VALID_BADGES


def test_normalize_result_is_honest_with_garbage():
    assert normalize_result("PASS") is AssertionResult.PASS
    assert normalize_result("not run") is AssertionResult.NOT_EVALUATED
    assert normalize_result(None) is AssertionResult.NOT_EVALUATED
    assert normalize_result("") is AssertionResult.NOT_EVALUATED
    assert normalize_result("garbage") is AssertionResult.NOT_EVALUATED


# ------------------------------------------------------------------ redaction

def test_canary_value_is_redacted():
    out = redact("leak attempt: BAYORA-CANARY-run1-a1b2c3d4e5 found")
    assert "CANARY" not in out.upper().replace("████", "")
    assert "\u2588" in out


def test_canary_correlation_id_stays_visible():
    assert "canary-run1" in redact("canary_id=canary-run1")


def test_sk_token_is_redacted():
    out = redact("auth sk-abcdef1234567890 used")
    assert "sk-abcdef1234567890" not in out


def test_key_value_secret_is_redacted():
    out = redact("password=hunter22 connected")
    assert "hunter22" not in out
    assert "password=" in out


def test_ordinary_text_untouched():
    assert redact("Adversarial request received") == \
        "Adversarial request received"


def test_redact_obj_handles_nesting_and_keys():
    obj = {
        "message": "value BAYORA-CANARY-x-99 secret",
        "canary": "BAYORA-CANARY-x-99",
        "nested": [{"token": "BAYORA-CANARY-x-99"}],
        "seq": 3,
    }
    out = redact_obj(obj)
    assert out["canary"] == "\u2588\u2588\u2588\u2588"
    assert "CANARY" not in out["message"].replace("████", "")
    assert out["nested"][0]["token"] == "\u2588\u2588\u2588\u2588"
    assert out["seq"] == 3


# ------------------------------------------------------- matrix honesty rules

def test_catalogue_covers_spec_section_7_vectors():
    vectors = " ".join(s.attack_vector.lower()
                       for s in build_catalogue())
    for required in [
        "prompt injection", "canary", "network", "filesystem",
        "ledger", "checkpoint", "malformed",
    ]:
        assert required in vectors, required


def test_summary_counts_and_applicable_denominator():
    rows = [
        {"result": "PASS"}, {"result": "PASS"}, {"result": "PASS"},
        {"result": "PASS"}, {"result": "PASS"}, {"result": "PASS"},
        {"result": "SKIPPED"}, {"result": "SKIPPED"},
    ]
    s = summarize(rows)
    assert s["total"] == 8
    assert s["passed"] == 6
    assert s["skipped"] == 2
    assert s["applicable"] == 6
    assert s["not_evaluated"] == 0


def test_summary_when_nothing_ran():
    s = summarize([{"result": "NOT_EVALUATED"}] * 8)
    assert s["applicable"] == 0
    assert s["not_evaluated"] == 8
    assert s["passed"] == 0


def test_not_run_counts_as_not_evaluated():
    s = summarize([{"result": "not run"}])
    assert s["not_evaluated"] == 1
    assert s["applicable"] == 0


# ------------------------------------------------- artifact client constants

def test_every_event_type_has_labels_and_messages():
    for et in ("run.started", "request.ingress", "policy.decision",
               "target.response", "response.released", "ledger.committed",
               "verification.performed", "checkpoint.signed",
               "incident.raised", "run.completed", "assertion.recorded",
               "rejections.summary"):
        assert et in COMPONENT_LABELS, et
        assert et in MESSAGES, et


def test_every_scenario_maps_to_a_known_scene():
    valid_scenes = {"preflight", "baseline", "attack", "containment",
                    "runtime", "tamper", "report", "all"}
    for spec in build_catalogue():
        assert spec.scenario_id in SCENE_FOR_SCENARIO, spec.scenario_id
        assert SCENE_FOR_SCENARIO[spec.scenario_id] in valid_scenes


# -------------------------------------------------------------- event model

def test_event_parses_and_requires_core_fields():
    ev = Event(seq=1, ts_utc="2026-10-21T14:02:11Z",
               component="INGRESS", message="Adversarial request received")
    assert ev.component == "INGRESS"
    with pytest.raises(Exception):
        Event(seq=1, ts_utc="x", message="no component")
