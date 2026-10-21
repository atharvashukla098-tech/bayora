"""Dashboard UI models — pure, importable without Streamlit.

Shared status vocabulary for the dossier dashboard: outcome enums, badge
color mapping, report status rules (spec §8, independently recomputed in
the UI — never trusted from a claim field), UI-layer redaction, and the
matrix summary helpers with explicit applicable denominators (spec §7).
"""

from __future__ import annotations

import re
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class Outcome(str, Enum):
    DETECTED = "DETECTED"
    BLOCKED = "BLOCKED"
    REDACTED = "REDACTED"
    ALLOWED = "ALLOWED"
    ERROR = "ERROR"
    NOT_EVALUATED = "NOT_EVALUATED"


class AssertionResult(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    ERROR = "ERROR"
    SKIPPED = "SKIPPED"
    NOT_EVALUATED = "NOT_EVALUATED"


class ReportStatus(str, Enum):
    VERIFIED = "VERIFIED"
    VERIFIED_WITH_LIMITATIONS = "VERIFIED_WITH_LIMITATIONS"
    FAILED = "FAILED"
    NOT_VERIFIED = "NOT_VERIFIED"


# One shared table so the stream, matrix, containment strip, and
# attestation panel never disagree about what a state looks like.
BADGE_COLOR: dict[str, str] = {
    "PASS": "green", "ALLOWED": "green", "VALID": "blue",
    "FAIL": "red", "BLOCKED": "red", "INVALID": "red",
    "ERROR": "violet",
    "DETECTED": "orange", "REDACTED": "orange",
    "SKIPPED": "gray", "NOT_EVALUATED": "gray", "UNAVAILABLE": "gray",
    "UNKNOWN": "gray", "NOT RUN": "gray",
    "VERIFIED": "blue", "VERIFIED_WITH_LIMITATIONS": "blue",
    "STALE": "orange",
}


def badge_color(state: str) -> str:
    return BADGE_COLOR.get(str(state).upper(), "gray")


class Event(BaseModel):
    seq: int
    ts_utc: str
    run_id: str | None = None
    component: str
    event_type: str = ""
    status: str = ""
    message: str
    block: int | str | None = None
    hash: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class MatrixRow(BaseModel):
    scenario_id: str
    attack_vector: str
    layer: str = ""
    mechanism: str = ""
    action_taken: str = ""
    evidence: list[str] = Field(default_factory=list)
    result: AssertionResult = AssertionResult.NOT_EVALUATED
    evidence_detail: dict[str, Any] = Field(default_factory=dict)


class TamperDemoResult(BaseModel):
    original_ledger_status: str = "UNKNOWN"
    copy_created: bool = False
    modified_event: int | None = None
    expected_hash: str | None = None
    computed_hash: str | None = None
    earliest_failure: str | None = None
    verifier_returncode: int | None = None
    original_unmodified: bool | None = None
    output: str = ""


class ContainmentControl(BaseModel):
    control_id: str
    name: str
    state: str
    evidence: str = ""


class Health(BaseModel):
    backend: bool = True
    target_mode: str | None = None
    offline_mode: bool | None = None
    docker_available: bool | None = None
    platform_version: str | None = None


def compute_report_status(report: dict[str, Any]) -> ReportStatus:
    """Independently compute an attestation report's status (spec §8).

    Rules, in evaluation order:

    1. ``NOT_VERIFIED`` — required verification did not execute: no
       assertions were run, the report signature is absent, or there is
       nothing on the ledger to verify.
    2. ``FAILED`` — a required assertion failed or errored, the report's
       own counts do not add up, the ledger chain is invalid, or a present
       checkpoint signature does not validate.
    3. ``VERIFIED_WITH_LIMITATIONS`` — everything executed cleanly but
       limitations exist: skipped assertions, or no checkpoint (a hash
       chain alone cannot prove the ledger was not rewritten wholesale).
    4. ``VERIFIED`` — all assertions passed, chain valid, checkpoint
       present and signature valid, nothing skipped.
    """
    assertions = report.get("assertions") or {}
    ledger = report.get("ledger") or {}
    signature_block = report.get("report_signature") or {}

    total = int(assertions.get("total", 0) or 0)
    passed = int(assertions.get("passed", 0) or 0)
    failed = int(assertions.get("failed", 0) or 0)
    errors = int(assertions.get("errors", 0) or 0)
    skipped = int(assertions.get("skipped", 0) or 0)

    block_height = int(ledger.get("block_height", 0) or 0)
    chain_valid = bool(ledger.get("chain_valid"))
    checkpoint_present = bool(ledger.get("checkpoint_present"))
    checkpoint_sig_valid = bool(ledger.get("checkpoint_signature_valid"))
    signature = signature_block.get("signature")

    # Rule 1 — verification did not execute.
    if total == 0:
        return ReportStatus.NOT_VERIFIED
    if signature is None:
        return ReportStatus.NOT_VERIFIED
    if block_height == 0 and not chain_valid:
        return ReportStatus.NOT_VERIFIED

    # Rule 2 — required checks failed.
    if passed + failed + errors + skipped != total:
        return ReportStatus.FAILED
    if failed > 0 or errors > 0:
        return ReportStatus.FAILED
    if not chain_valid:
        return ReportStatus.FAILED
    if checkpoint_present and not checkpoint_sig_valid:
        return ReportStatus.FAILED

    # Rule 3 — executed cleanly, but limitations exist.
    if skipped > 0 or not checkpoint_present:
        return ReportStatus.VERIFIED_WITH_LIMITATIONS

    # Rule 4 — fully verified.
    return ReportStatus.VERIFIED


_CANARY_RE = re.compile(r"bayora[-_]?canary[-_][A-Za-z0-9\-]+", re.IGNORECASE)
_SECRET_RE = re.compile(
    r"\b(sk-[A-Za-z0-9_\-]{8,})\b|((?:api[_-]?key|password|secret|token)"
    r"\s*[=:]\s*)([^\s,;\"']+)",
    re.IGNORECASE,
)
REDACTION = "\u2588\u2588\u2588\u2588"


def redact(text: str) -> str:
    """UI-layer redaction of canary values and obvious secrets.

    Second line of defense — the guardrail redacts before a response is
    ever released, and ledger details are allowlisted at commit time.
    Short correlation ids such as ``canary-<runid>`` stay visible; the
    synthetic secret format ``bayora-canary-...`` never reaches the screen.
    """
    if not text:
        return text
    out = _CANARY_RE.sub(REDACTION, text)

    def _secret(m: re.Match) -> str:
        if m.group(1):
            return REDACTION
        return f"{m.group(2)}{REDACTION}"

    return _SECRET_RE.sub(_secret, out)


def redact_obj(obj: Any) -> Any:
    """Recursively redact strings inside dicts/lists for safe display."""
    if isinstance(obj, str):
        return redact(obj)
    if isinstance(obj, dict):
        secret_keys = {"canary", "secret", "password", "token"}
        return {
            k: (REDACTION
                if str(k).lower() in secret_keys and isinstance(v, str)
                else redact_obj(v))
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [redact_obj(v) for v in obj]
    return obj


def normalize_result(value: Any) -> AssertionResult:
    """Map any artifact status string onto the shared enum, honestly."""
    try:
        return AssertionResult(str(value or "").strip().upper())
    except ValueError:
        return AssertionResult.NOT_EVALUATED


def summarize(rows: list[dict]) -> dict[str, int]:
    """Summary counts with an explicit applicable denominator.

    ``applicable`` = assertions that executed to a verdict
    (PASS/FAIL/ERROR). SKIPPED and NOT_EVALUATED are excluded from the
    denominator but always reported separately (spec §7).
    """
    counts = {"total": len(rows), "passed": 0, "failed": 0, "errors": 0,
              "skipped": 0, "not_evaluated": 0, "applicable": 0}
    for r in rows:
        res = normalize_result(r.get("result")).value
        if res == AssertionResult.PASS.value:
            counts["passed"] += 1
        elif res == AssertionResult.FAIL.value:
            counts["failed"] += 1
        elif res == AssertionResult.ERROR.value:
            counts["errors"] += 1
        elif res == AssertionResult.SKIPPED.value:
            counts["skipped"] += 1
        else:
            counts["not_evaluated"] += 1
    counts["applicable"] = counts["passed"] + counts["failed"] + counts["errors"]
    return counts
