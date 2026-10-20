"""The independent verifier (blueprint §5.3).

Deliberately does NOT import Ledger's write path — it re-implements hash
computation from app/schema.py rules only, so a bug in the writer cannot hide
in the reader (spec §12: independent). It reads the JSONL file directly.

Checks, in order: per-line JSON parse (INVALID_JSON) → EventRecord validation
incl. unknown fields and non-allowlisted detail keys in strict mode
(UNKNOWN_FIELD) → seq == index+1 (BAD_SEQ) → prev_hash linkage (BAD_LINK) →
stored-vs-recomputed hash (BAD_HASH) → monotonic timestamps (REORDERED).

Checkpoint checks (when supplied): signature against trusted key
(CHECKPOINT_SIG_INVALID), then heights — ledger_height < checkpoint_seq ⇒
BOTH BELOW_CHECKPOINT and CHECKPOINT_PREFIX_MISMATCH with coverage="prefix"
and valid=False (D12); equal heights ⇒ head hash comparison
(CHECKPOINT_MISMATCH) with coverage="full".

Truncation honesty (spec §6): without a checkpoint the verifier explicitly
cannot report truncation (coverage="none"); scripts/verify_ledger.py prints
"truncation check: NOT POSSIBLE (no trusted checkpoint supplied)". Never a
silent pass.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, ValidationError

from app.schema import (
    DETAIL_KEYS_BY_TYPE,
    EventRecord,
    EventType,
    Finding,
    canonical_event_bytes,
    event_hash,
)


class VerificationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: Optional[str]
    checked_height: int          # events actually examined
    valid: bool                  # no structural findings AND checkpoint OK (if given)
    findings: list[Finding]
    earliest_failure_seq: Optional[int]   # spec §6 step 6
    checked_at: str              # real UTC ISO from injected clock
    checkpoint_coverage: Literal["none", "prefix", "full", "none_applicable"] = "none"


def _parse_lines(ledger_path: Path) -> tuple[list[Optional[EventRecord]], list[Finding], int]:
    """Parse every line; unparseable lines become INVALID_JSON findings."""
    events: list[Optional[EventRecord]] = []
    findings: list[Finding] = []
    raw_lines = 0
    with Path(ledger_path).open("r", encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            raw_lines += 1
            try:
                events.append(EventRecord.model_validate_json(line))
            except (ValidationError, ValueError):
                events.append(None)
                findings.append(Finding.INVALID_JSON)
    return events, findings, raw_lines


def verify_ledger(ledger_path: Path, *,
                  checkpoint: Optional[object] = None,
                  trusted_public_key: Optional[object] = None,
                  strict: bool = True,
                  checked_at: Optional[str] = None) -> VerificationResult:
    """Verify a ledger file from scratch. Pure read; never raises to caller."""
    from app.ledger.checkpoints import verify_checkpoint
    from app.clock import SystemClock, iso_utc

    ledger_path = Path(ledger_path)
    findings: list[Finding] = []
    earliest_failure: Optional[int] = None

    if not ledger_path.is_file():
        return VerificationResult(
            run_id=None, checked_height=0, valid=False,
            findings=[Finding.INVALID_JSON],
            earliest_failure_seq=None,
            checked_at=checked_at or iso_utc(SystemClock().now_utc()),
            checkpoint_coverage="none")

    events, findings_struct, raw_lines = _parse_lines(ledger_path)
    findings.extend(findings_struct)
    checked_height = raw_lines

    run_id: Optional[str] = None
    prev_hash: Optional[str] = None
    prev_ts: Optional[datetime] = None

    for idx, ev in enumerate(events):
        seq = idx + 1
        if ev is None:
            if earliest_failure is None:
                earliest_failure = seq
            prev_hash = None  # chain broken from here for link purposes
            prev_ts = None
            continue

        if run_id is None and ev.run_id:
            run_id = ev.run_id

        # strict-mode schema enforcement: unknown fields + detail-key allowlist
        if strict:
            try:
                raw = json.loads(ev.model_dump_json())
                unknown_fields = set(raw.keys()) - set(EventRecord.model_fields.keys())
                if unknown_fields:
                    raise ValueError(f"unknown fields: {sorted(unknown_fields)}")
                if ev.detail is not None:
                    from app.schema import check_detail_keys
                    check_detail_keys(EventType(ev.event_type), ev.detail)
            except (ValueError, ValidationError):
                findings.append(Finding.UNKNOWN_FIELD)
                if earliest_failure is None:
                    earliest_failure = seq

        # seq contiguity
        if ev.seq != seq:
            findings.append(Finding.BAD_SEQ)
            if earliest_failure is None:
                earliest_failure = seq

        # prev_hash linkage
        expected_prev = "0" * 64 if seq == 1 else prev_hash
        if prev_hash is None and seq > 1:
            findings.append(Finding.BAD_LINK)
            if earliest_failure is None:
                earliest_failure = seq
        elif ev.prev_hash != expected_prev:
            findings.append(Finding.BAD_LINK)
            if earliest_failure is None:
                earliest_failure = seq

        # stored vs recomputed hash
        computed = event_hash(ev)
        if ev.hash != computed:
            findings.append(Finding.BAD_HASH)
            if earliest_failure is None:
                earliest_failure = seq

        # monotonic timestamps (REORDERED)
        try:
            ts = datetime.fromisoformat(ev.ts)
        except ValueError:
            ts = None
        if ts is not None and prev_ts is not None and ts < prev_ts:
            findings.append(Finding.REORDERED)
            if earliest_failure is None:
                earliest_failure = seq
        if ts is not None:
            prev_ts = ts

        prev_hash = ev.hash

    # -- checkpoint comparison -----------------------------------------
    coverage: Literal["none", "prefix", "full", "none_applicable"] = "none"
    if checkpoint is not None:
        cp_valid_sig = (verify_checkpoint(checkpoint, trusted_public_key)
                        if trusted_public_key is not None else False)
        cp_seq = int(getattr(checkpoint, "checkpoint_seq"))
        height = len(events)
        if not cp_valid_sig:
            # Invalid (or unverifiable, no trusted key) signature: fail closed.
            findings.append(Finding.CHECKPOINT_SIG_INVALID)
            if earliest_failure is None:
                earliest_failure = height or None
        elif height < cp_seq:
            # D12: strict prefix of the checkpoint's coverage — the checkpoint
            # does not vouch for this ledger. Both findings, valid=False.
            findings.append(Finding.BELOW_CHECKPOINT)
            findings.append(Finding.CHECKPOINT_PREFIX_MISMATCH)
            coverage = "prefix"
            if earliest_failure is None:
                earliest_failure = height + 1 if height else None
        else:
            # Ledger height >= checkpoint_seq: verify the covered prefix.
            coverage = "full"
            idx = cp_seq - 1
            if idx < len(events) and events[idx] is not None:
                if events[idx].hash != getattr(checkpoint, "final_event_hash"):
                    findings.append(Finding.CHECKPOINT_MISMATCH)
                    if earliest_failure is None:
                        earliest_failure = cp_seq
            else:
                findings.append(Finding.CHECKPOINT_MISMATCH)
                if earliest_failure is None:
                    earliest_failure = cp_seq

    valid = len(findings) == 0
    return VerificationResult(
        run_id=run_id, checked_height=checked_height, valid=valid,
        findings=findings, earliest_failure_seq=earliest_failure,
        checked_at=checked_at or iso_utc(SystemClock().now_utc()),
        checkpoint_coverage=coverage)
