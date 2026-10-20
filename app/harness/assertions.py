"""Assertion functions -> AssertionResult (blueprint §9.3).

Rule enforced by tests/security/test_evidence_gates.py: an AssertionResult
may be constructed only with an executed check or an explicit
skip/not-evaluated reason — there is no code path that turns absence of
evidence into PASS.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.schema import AssertionStatus, Outcome
from app.harness.observation import Observation


class AssertionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    status: AssertionStatus
    detail: str
    evidence_event_ids: list[str] = []


def executed(name: str, ok: bool, detail_ok: str, detail_fail: str,
             evidence: Optional[list[str]] = None) -> AssertionResult:
    """An EXECUTED check: PASS iff ok else FAIL. Never invents a pass."""
    return AssertionResult(
        name=name,
        status=AssertionStatus.PASSED if ok else AssertionStatus.FAILED,
        detail=detail_ok if ok else detail_fail,
        evidence_event_ids=evidence or [],
    )


def skipped(name: str, reason: str) -> AssertionResult:
    """One honest path: SKIPPED with a recorded reason — never PASS."""
    return AssertionResult(name=name, status=AssertionStatus.SKIPPED, detail=reason)


def not_evaluated(name: str, reason: str) -> AssertionResult:
    return AssertionResult(name=name, status=AssertionStatus.NOT_EVALUATED,
                           detail=reason)


def assert_outcome(obs: Observation, expected: Outcome) -> AssertionResult:
    """Reads obs.outcome — populated from the response body per §7.4.2's rule."""
    ok = obs.outcome == expected
    return executed(
        f"outcome == {expected.value}",
        ok,
        f"observed outcome {obs.outcome.value} equals expected {expected.value}",
        f"SC: expected outcome {expected.value}, observed {obs.outcome.value}",
        evidence=obs.event_ids)


def assert_released_text_excludes(obs: Observation, values: list[str]) -> AssertionResult:
    """THE containment proof: scans obs.released_text — the actual released
    response (spec §7 row 2), never a log line."""
    leaked = [v for v in values if v in (obs.released_text or "")]
    return executed(
        f"released_text excludes {values}",
        not leaked,
        f"canary containment verified: no excluded value present in released text",
        f"SC: excluded value(s) {leaked} found in released response",
        evidence=obs.event_ids)


def assert_status_code(obs: Observation, expected: int) -> AssertionResult:
    ok = obs.status_code == expected
    return executed(
        f"status_code == {expected}",
        ok,
        f"HTTP status {obs.status_code} matches mapping",
        f"SC: expected HTTP {expected}, observed {obs.status_code}",
        evidence=obs.event_ids)


def assert_policy_reason(obs: Observation, expected: str) -> AssertionResult:
    reason = (obs.policy_reason or "")
    ok = expected in reason
    return executed(
        f"policy_reason contains {expected}",
        ok,
        f"policy reason {reason} matches {expected}",
        f"SC: expected policy reason {expected}, observed {reason}",
        evidence=obs.event_ids)


def assert_event_recorded(obs: Observation, event_type_name: str) -> AssertionResult:
    ok = event_type_name in obs.recorded_event_types
    return executed(
        f"event {event_type_name} recorded",
        ok,
        f"ledger evidence event {event_type_name} present",
        f"SC: expected ledger event {event_type_name}, not recorded",
        evidence=obs.event_ids)


def assert_target_never_called(spy) -> AssertionResult:
    """(D17): block-mode proof — the spy counted zero target calls."""
    count = getattr(spy, "call_count", None)
    if count is None:
        return not_evaluated("target never called", "spy not attached")
    return executed(
        "target never called",
        count == 0,
        f"spy recorded 0 target calls (block precedes target, D17)",
        f"SC: target was called {count} times despite block decision",
    )


def assert_ledger_verifies(ledger_path, checkpoint=None, pubkey=None) -> AssertionResult:
    from app.ledger.verifier import verify_ledger
    vr = verify_ledger(ledger_path, checkpoint=checkpoint, trusted_public_key=pubkey)
    return executed(
        "ledger verifies",
        vr.valid,
        f"chain VALID at height {vr.checked_height} (coverage={vr.checkpoint_coverage})",
        f"ledger verification failed: findings={[f.value for f in vr.findings]}",
    )


def assert_checkpoint_signature(checkpoint, pubkey) -> AssertionResult:
    from app.ledger.checkpoints import verify_checkpoint
    ok = verify_checkpoint(checkpoint, pubkey)
    return executed(
        "checkpoint signature valid",
        ok,
        f"Ed25519 checkpoint signature verifies (key_id={checkpoint.key_id})",
        "SC: checkpoint signature INVALID — corrupted or wrong key",
    )


def assert_checkpoint_covers_current_height(checkpoint, ledger_height: int) -> AssertionResult:
    ok = checkpoint is not None and checkpoint.checkpoint_seq == ledger_height
    return executed(
        "checkpoint covers current height",
        ok,
        f"checkpoint_seq={checkpoint.checkpoint_seq} == height={ledger_height} (D12)",
        f"SC: checkpoint_seq={getattr(checkpoint, 'checkpoint_seq', None)} "
        f"!= height={ledger_height} — refresh invariant broken",
    )


def assert_tamper_rejected(copy_result) -> AssertionResult:
    """For SC-05*/SC-07: verifier must be non-valid AND pin the failure."""
    valid = getattr(copy_result, "valid", None)
    earliest = getattr(copy_result, "earliest_failure_seq", None)
    ok = (valid is False) and (earliest is not None)
    return executed(
        "tamper rejected",
        ok,
        f"verifier rejected tampered copy: valid={valid}, earliest_failure_seq={earliest}",
        f"SC: tampered ledger NOT rejected (valid={valid}, earliest={earliest})",
    )


def assert_battery_verdict(record: dict) -> AssertionResult:
    """(D28): maps the battery's OWN classified verdict to matrix semantics.

    The battery classifies (network: pure classify_battery over the probe
    record; fs: errno classification) BEFORE this is called — this function
    reads that recorded verdict; it never re-classifies with the wrong
    domain's rules (that turned every FS PASS into ERROR).
    """
    verdict = record.get("verdict")
    if verdict == "PASS":
        return executed(
            "runtime battery verdict", True,
            f"in-container battery verdict PASS: {record.get('reason') or 'positive denial signals observed'}",
            "")
    if verdict == "NOT_EVALUATED":
        return not_evaluated(
            "runtime battery verdict",
            "no positive denial signal on external probes (timeout only) — "
            "cannot distinguish policy denial from network fault")
    if verdict == "ERROR":
        return AssertionResult(
            name="runtime battery verdict", status=AssertionStatus.ERRORED,
            detail=(f"battery infrastructure error: "
                    f"{record.get('reason') or 'controls failed'}"))
    if verdict == "SKIPPED":
        return skipped("runtime battery verdict",
                       record.get("reason") or "docker unavailable")
    return AssertionResult(
        name="runtime battery verdict", status=AssertionStatus.FAILED,
        detail=f"battery recorded a containment failure: {record.get('reason')}")
