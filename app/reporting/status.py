"""Report status decision table (blueprint §10.1, spec §8, D15).

Principle (D15): the report's ``status`` attests to the RUN's evidence —
chain, checkpoint, truncation check, assertion counts. It NEVER reads its
own signature: at build time the signature does not exist, and after signing
``status`` is inside the signed scope. Signature validity is the independent
verify path's job (signing.py), which is the demo's acceptance gate alongside
the recorded status.

Decision table — evaluated strictly in this order; first match wins:

| # | Condition (computed, not asserted)                              | Status |
|---|------------------------------------------------------------------|--------|
| 1 | not chain_valid OR checkpoint_result == "invalid"                | FAILED |
| 2 | required_failed > 0 OR required_errored > 0                      | FAILED |
| 3 | any VerificationStep with required and not executed              | NOT_VERIFIED |
| 4 | All above passed AND SKIPPED/UNAVAILABLE assertions or non-empty limitations | VERIFIED_WITH_LIMITATIONS |
| 5 | All above passed, zero limitations                               | VERIFIED |
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schema import ReportStatus


class VerificationStep(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Literal["ledger_chain", "checkpoint_signature", "truncation_vs_checkpoint"]
    required: bool
    executed: bool
    result: Literal["pass", "fail", "not_possible", "not_applicable"]
    evidence: str          # e.g. "verifications.jsonl[3]", "checkpoint_seq=42 == height=42"


class AssertionCounts(BaseModel):
    model_config = ConfigDict(extra="forbid")
    total: int
    passed: int
    failed: int
    errors: int
    skipped: int
    not_evaluated: int


class ReportStatusInputs(BaseModel):
    """NOTE (D15): there is deliberately NO signature-related field here.

    compute_status output is invariant to any hypothetical signature state —
    asserted by test_status_does_not_read_own_signature.
    """
    model_config = ConfigDict(extra="forbid")
    chain_valid: bool
    checkpoint_result: Literal["valid", "invalid", "absent"]
    truncation_check: Literal["pass", "not_possible", "not_applicable"]
    counts: AssertionCounts
    required_failed: int
    required_errored: int
    verification_steps: list[VerificationStep]
    limitations: list[str]


def compute_status(inputs: ReportStatusInputs) -> ReportStatus:
    """Pure decision function; first matching row wins."""
    # Row 1: chain or checkpoint invalid -> FAILED
    if not inputs.chain_valid or inputs.checkpoint_result == "invalid":
        return ReportStatus.FAILED
    # Row 2: required assertions failed/errored -> FAILED
    if inputs.required_failed > 0 or inputs.required_errored > 0:
        return ReportStatus.FAILED
    # Row 3: a required verification step did not execute -> NOT_VERIFIED
    for step in inputs.verification_steps:
        if step.required and not step.executed:
            return ReportStatus.NOT_VERIFIED
    # Row 4: passed with honest limitations -> VERIFIED_WITH_LIMITATIONS
    has_skipped = inputs.counts.skipped > 0 or inputs.counts.not_evaluated > 0
    if has_skipped or inputs.limitations:
        return ReportStatus.VERIFIED_WITH_LIMITATIONS
    # Row 5: clean
    return ReportStatus.VERIFIED
