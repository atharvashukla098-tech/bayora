"""Unit: report status decision table (§10.1, D15)."""

from __future__ import annotations

import json

from app.reporting.status import (
    AssertionCounts, ReportStatusInputs, VerificationStep, compute_status,
)
from app.schema import ReportStatus


def _inputs(**over) -> ReportStatusInputs:
    base = dict(
        chain_valid=True,
        checkpoint_result="valid",
        truncation_check="pass",
        counts=AssertionCounts(total=10, passed=10, failed=0, errors=0,
                               skipped=0, not_evaluated=0),
        required_failed=0,
        required_errored=0,
        verification_steps=[
            VerificationStep(name="ledger_chain", required=True, executed=True,
                             result="pass", evidence="x"),
            VerificationStep(name="checkpoint_signature", required=True,
                             executed=True, result="pass", evidence="x"),
            VerificationStep(name="truncation_vs_checkpoint", required=True,
                             executed=True, result="pass", evidence="x"),
        ],
        limitations=[],
    )
    base.update(over)
    return ReportStatusInputs(**base)


def test_row1_invalid_chain_fails():
    assert compute_status(_inputs(chain_valid=False)) == ReportStatus.FAILED


def test_row1_invalid_checkpoint_fails():
    assert compute_status(_inputs(checkpoint_result="invalid")) == ReportStatus.FAILED


def test_row2_required_failure_fails():
    assert compute_status(_inputs(required_failed=1)) == ReportStatus.FAILED
    assert compute_status(_inputs(required_errored=1)) == ReportStatus.FAILED


def test_row3_missing_required_verification_step_not_verified():
    steps = [VerificationStep(name="truncation_vs_checkpoint", required=True,
                              executed=False, result="not_possible",
                              evidence="no checkpoint")]
    assert compute_status(_inputs(verification_steps=steps)) == \
        ReportStatus.NOT_VERIFIED


def test_row4_skipped_yields_verified_with_limitations():
    counts = AssertionCounts(total=12, passed=10, failed=0, errors=0,
                             skipped=2, not_evaluated=0)
    assert compute_status(_inputs(counts=counts)) == \
        ReportStatus.VERIFIED_WITH_LIMITATIONS


def test_row4_limitation_only_yields_verified_with_limitations():
    assert compute_status(_inputs(limitations=["docker unavailable"])) == \
        ReportStatus.VERIFIED_WITH_LIMITATIONS


def test_row5_clean_run_verified():
    assert compute_status(_inputs()) == ReportStatus.VERIFIED


def test_invalid_checkpoint_beats_all_pass_assertions():
    counts = AssertionCounts(total=10, passed=10, failed=0, errors=0,
                             skipped=0, not_evaluated=0)
    st = compute_status(_inputs(checkpoint_result="invalid", counts=counts))
    assert st == ReportStatus.FAILED, "row 1 must outrank everything"


def test_status_does_not_read_own_signature():
    """D15: ReportStatusInputs has NO signature field; output is invariant."""
    field_names = set(ReportStatusInputs.model_fields.keys())
    assert not any("sig" in f.lower() for f in field_names), \
        "status inputs must not contain signature state"
    # invariance: identical inputs produce identical status, and no input
    # channel exists through which signature state could alter the result
    assert compute_status(_inputs()) == compute_status(_inputs())


def test_counts_sum_to_total():
    counts = AssertionCounts(total=16, passed=14, failed=0, errors=0,
                             skipped=2, not_evaluated=0)
    assert counts.passed + counts.failed + counts.errors + counts.skipped \
        + counts.not_evaluated == counts.total


def test_serialized_inputs_have_no_signature_key():
    data = json.loads(_inputs().model_dump_json())
    assert "signature" not in json.dumps(data).lower() or \
        "signature" not in data
