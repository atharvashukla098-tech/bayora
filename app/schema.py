"""Canonical serialization + hash rules (blueprint §4.2).

Single source of truth for every serialization/hash rule in Bayora: the ledger
writer, the independent verifier, the checkpoint signer and the report signer
all import from here. Hash-input invariants (all unit-tested):

1. The hash input EXCLUDES the event's own ``hash`` field.
2. It INCLUDES ``prev_hash`` and every immutable field.
3. ``detail`` renders as a nested JSON object with keys SORTED, so two events
   carrying the same key set in different insertion order produce byte-identical
   canonical bytes (D24).
4. Bytes are position-stable across processes and platforms (fixed field order,
   separators=(",", ":"), ensure_ascii=False, UTF-8).
5. Any byte change to content, ts, seq, outcome, detail or prev_hash changes hash.
6. An unknown detail key is rejected at construction (fail-closed) AND reported
   as UNKNOWN_FIELD by the strict verifier when encountered on disk.
"""

from __future__ import annotations

import hashlib
import json
from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict

import app

# ---------------------------------------------------------------------------
# Enums — the exact strings used everywhere: API, ledger, dashboard, report.
# ---------------------------------------------------------------------------


class Outcome(str, Enum):
    """The six outcome states, one consistent meaning everywhere (spec §3.4)."""

    DETECTED = "DETECTED"          # control observed the condition; response path still ran
    BLOCKED = "BLOCKED"            # request/response stopped before release
    REDACTED = "REDACTED"          # response released with canary removed
    ALLOWED = "ALLOWED"            # inspected, no policy violated, released unmodified
    ERROR = "ERROR"                # infrastructure/config fault — never a success synonym
    NOT_EVALUATED = "NOT_EVALUATED"  # never inspected (e.g. request rejected upstream)


class AssertionStatus(str, Enum):
    PASSED = "PASS"
    FAILED = "FAIL"
    ERRORED = "ERROR"
    SKIPPED = "SKIPPED"
    NOT_EVALUATED = "NOT_EVALUATED"


class ReportStatus(str, Enum):
    VERIFIED = "VERIFIED"
    VERIFIED_WITH_LIMITATIONS = "VERIFIED_WITH_LIMITATIONS"
    FAILED = "FAILED"
    NOT_VERIFIED = "NOT_VERIFIED"


class EventType(str, Enum):
    RUN_STARTED = "run.started"
    REQUEST_INGRESS = "request.ingress"          # sanitized; detail: prompt digest only
    POLICY_DECISION = "policy.decision"          # detail: rule, reason, matched ids, digest
    TARGET_RESPONSE = "target.response"          # detail: response digest
    RESPONSE_RELEASED = "response.released"      # detail: released-text digest
    ASSERTION_RECORDED = "assertion.recorded"    # detail: assertion name + status
    LEDGER_COMMITTED = "ledger.committed"        # detail: block, event_hash (companion)
    REJECTIONS_SUMMARY = "rejections.summary"    # detail: per-reason counts (D27)
    VERIFICATION_PERFORMED = "verification.performed"
    CHECKPOINT_SIGNED = "checkpoint.signed"     # detail: checkpoint_seq, key_id (D25)
    INCIDENT_RAISED = "incident.raised"
    RUN_COMPLETED = "run.completed"


class Component(str, Enum):
    HARNESS = "red-harness"
    BROKER = "policy-broker"
    TARGET = "mock-target"
    GUARDRAIL = "blue-guardrail"
    LEDGER = "audit-ledger"
    VERIFIER = "verifier"
    REPORTER = "reporter"
    DASHBOARD = "dashboard"


class Finding(str, Enum):
    """Verification finding types (blueprint §4.2, verifier output)."""

    BAD_HASH = "BAD_HASH"                        # stored hash != recomputed
    BAD_LINK = "BAD_LINK"                        # prev_hash != previous event's hash
    BAD_SEQ = "BAD_SEQ"                          # seq not 1..N contiguous
    REORDERED = "REORDERED"                      # ts/seq inconsistency detected
    INVALID_JSON = "INVALID_JSON"                # unparseable line
    UNKNOWN_FIELD = "UNKNOWN_FIELD"              # non-schema field or non-allowlisted detail key
    BELOW_CHECKPOINT = "BELOW_CHECKPOINT"        # ledger shorter than signed checkpoint height
    CHECKPOINT_SIG_INVALID = "CHECKPOINT_SIG_INVALID"
    CHECKPOINT_MISMATCH = "CHECKPOINT_MISMATCH"      # final hash != checkpoint.final_event_hash
    CHECKPOINT_PREFIX_MISMATCH = "CHECKPOINT_PREFIX_MISMATCH"  # strict prefix (D12)


# ---------------------------------------------------------------------------
# Event record — field order IS the canonical field order.
# ---------------------------------------------------------------------------


class EventRecord(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    schema_version: str            # "1.0"
    event_id: str                 # uuid4 hex
    seq: int                      # 1-based position in this ledger
    ts: str                       # UTC ISO-8601 with offset
    run_id: Optional[str]         # None allowed for platform-level events
    event_type: EventType
    component: Component
    outcome: Optional[Outcome]
    scenario_id: Optional[str]
    detail: Optional[dict]        # dict[str, str]; closed-key evidence map (D24)
    prev_hash: str                # 64 hex; "0"*64 for seq 1
    hash: str                     # 64 hex; computed per rules below


# Optional fields serialize as `null` (never omitted) so canonical bytes are
# position-stable. Field order in the model above IS the canonical order.

DETAIL_KEYS_BY_TYPE: dict = {
    EventType.RUN_STARTED: frozenset({"mode", "config_digest"}),
    EventType.REQUEST_INGRESS: frozenset({"prompt_digest"}),
    EventType.POLICY_DECISION: frozenset(
        {"rule", "reason", "matched", "prompt_digest", "response_digest", "status_code"}),
    EventType.TARGET_RESPONSE: frozenset({"response_digest", "behavior"}),
    EventType.RESPONSE_RELEASED: frozenset({"released_digest", "redaction_ids", "match_count"}),
    EventType.ASSERTION_RECORDED: frozenset({"name", "status", "evidence"}),
    EventType.LEDGER_COMMITTED: frozenset({"block", "event_hash"}),
    EventType.REJECTIONS_SUMMARY: frozenset({"size", "schema", "rate", "busy",
                                              "destination", "window_seconds"}),
    EventType.VERIFICATION_PERFORMED: frozenset({"valid", "findings", "checked_height", "coverage"}),
    EventType.CHECKPOINT_SIGNED: frozenset({"checkpoint_seq", "key_id"}),
    EventType.INCIDENT_RAISED: frozenset({"outcome", "reason", "response_digest"}),
    EventType.RUN_COMPLETED: frozenset({"status", "counts"}),
}

# Values that must never appear in a detail value, belt-and-braces on top of
# the structural rule that callers only ever pass digests and static codes.
_FORBIDDEN_VALUE_MARKERS = ("BAYORA-CANARY",)


def sanitize_detail_value(value: str) -> str:
    """Strip anything that could carry a raw canary; digests/ids are unaffected.

    Callers only pass digests (sha256(text)[:16]), pattern ids like ``inj-3``,
    static reason codes and decimal-string counts, so this sanitizer is
    belt-and-braces (D13/D24): it guarantees that even a future buggy caller
    cannot smuggle a raw canary value into the hashed/serialized evidence.
    """
    out = str(value)
    for marker in _FORBIDDEN_VALUE_MARKERS:
        if marker in out.upper():
            raise ValueError("detail value would leak a canary marker; pass digests only")
    return out


def check_detail_keys(event_type: EventType, detail: Optional[dict]) -> None:
    """Fail-closed allowlist check (D24). Raises ValueError on unknown keys."""
    if detail is None:
        return
    allowed = DETAIL_KEYS_BY_TYPE[event_type]
    for key in detail:
        if key not in allowed:
            raise ValueError(
                f"detail key '{key}' not allowed for event type {event_type.value}; "
                f"allowed: {sorted(allowed)}")


def canonical_event_bytes(ev: EventRecord) -> bytes:
    """Deterministic canonical bytes of an event, EXCLUDING ``ev.hash``.

    Field order is the fixed EventRecord order; ``detail`` renders as a nested
    JSON object with keys sorted (D24) or the literal ``null`` when absent.
    """
    detail_obj: object
    if ev.detail is None:
        detail_obj = None
    else:
        detail_obj = dict(sorted(ev.detail.items()))
    payload = {
        "schema_version": ev.schema_version,
        "event_id": ev.event_id,
        "seq": ev.seq,
        "ts": ev.ts,
        "run_id": ev.run_id,
        "event_type": ev.event_type.value,
        "component": ev.component.value,
        "outcome": ev.outcome.value if ev.outcome is not None else None,
        "scenario_id": ev.scenario_id,
        "detail": detail_obj,
        "prev_hash": ev.prev_hash,
    }
    return json.dumps(payload, separators=(",", ":"), sort_keys=False,
                      ensure_ascii=False).encode("utf-8")


def event_hash(ev: EventRecord) -> str:
    """SHA-256 over the canonical bytes, lowercase hex, 64 chars."""
    return hashlib.sha256(canonical_event_bytes(ev)).hexdigest()


def prompt_digest(text: str) -> str:
    """sha256(text)[:16] — the ONLY form in which prompt text may touch a ledger."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def detail_ok(event_type: EventType, detail: Optional[dict]) -> dict | None:
    """Validate + sanitize a detail mapping; returns the cleaned dict."""
    if detail is None:
        return None
    check_detail_keys(event_type, detail)
    return {str(k): sanitize_detail_value(str(v)) for k, v in detail.items()}


SCHEMA_VERSION_CURRENT = app.SCHEMA_VERSION
