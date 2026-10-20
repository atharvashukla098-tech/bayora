"""Unit: hash calculation (SHA-256 over canonical bytes)."""

from __future__ import annotations

import hashlib

from app.schema import Component, EventType, EventRecord, canonical_event_bytes


def _ev(seq=1, prev="0" * 64):
    return EventRecord(
        schema_version="1.0", event_id="cd" * 16, seq=seq,
        ts="2026-01-01T00:00:00.000000+00:00", run_id="run-h",
        event_type=EventType.RUN_STARTED, component=Component.LEDGER,
        outcome=None, scenario_id=None, detail=None,
        prev_hash=prev, hash="")


def test_event_hash_is_sha256_of_canonical_bytes():
    ev = _ev()
    expected = hashlib.sha256(canonical_event_bytes(ev)).hexdigest()
    from app.schema import event_hash
    assert event_hash(ev) == expected
    assert len(event_hash(ev)) == 64


def test_hash_is_lowercase_hex():
    from app.schema import event_hash
    h = event_hash(_ev())
    assert h == h.lower()
    int(h, 16)  # must be valid hex


def test_prompt_digest_is_sha256_16():
    from app.schema import prompt_digest
    d = prompt_digest("hello")
    assert d == hashlib.sha256(b"hello").hexdigest()[:16]
    assert len(d) == 16


def test_genesis_prev_hash_convention():
    # seq 1 uses 64 zeros; a verifier recomputing links must agree
    from app.schema import event_hash
    ev = _ev(seq=1, prev="0" * 64)
    payload = canonical_event_bytes(ev)
    assert b'"prev_hash":"' + b"0" * 64 + b'"' in payload
