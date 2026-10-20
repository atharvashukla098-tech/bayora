"""Unit: canonicalization + detail allowlist (D24)."""

from __future__ import annotations

import pytest

from app.schema import (
    Component, EventRecord, EventType, Outcome,
    canonical_event_bytes, check_detail_keys, detail_ok, event_hash,
)


def _event(**over):
    base = dict(
        schema_version="1.0", event_id="ab" * 16, seq=1,
        ts="2026-01-01T12:00:00.000000+00:00", run_id="run-x",
        event_type=EventType.RUN_STARTED, component=Component.HARNESS,
        outcome=None, scenario_id=None, detail=None,
        prev_hash="0" * 64, hash="",
    )
    base.update(over)
    return EventRecord(**base)


class TestCanonicalBytes:
    def test_hash_excludes_hash_field(self):
        ev = _event()
        h1 = event_hash(ev)
        h2 = event_hash(ev.model_copy(update={"hash": "ff" * 32}))
        assert h1 == h2, "hash input must exclude the hash field itself"

    def test_hash_includes_prev_hash_and_fields(self):
        ev = _event()
        h1 = event_hash(ev)
        h2 = event_hash(ev.model_copy(update={"prev_hash": "ab" * 32}))
        h3 = event_hash(ev.model_copy(update={"ts": "2026-01-01T12:00:01.000000+00:00"}))
        h4 = event_hash(ev.model_copy(update={"seq": 2}))
        assert len({h1, h2, h3, h4}) == 4, "any field change must change hash"

    def test_bytes_stable_across_processes_platforms(self):
        b1 = canonical_event_bytes(_event())
        b2 = canonical_event_bytes(_event())
        assert b1 == b2
        assert b1 == b1.decode("utf-8").encode("utf-8")

    def test_optional_fields_serialize_as_null(self):
        b = canonical_event_bytes(_event())
        assert b'"run_id":"run-x"' in b
        b2 = canonical_event_bytes(_event(run_id=None))
        assert b'"run_id":null' in b2


class TestDetailAllowlist:
    def test_detail_allowlist_enforced(self):
        with pytest.raises(ValueError, match="not allowed"):
            check_detail_keys(EventType.RUN_STARTED, {"prompt": "raw text"})
        check_detail_keys(EventType.RUN_STARTED, {"mode": "deterministic_mock"})

    def test_detail_keys_sorted_canonical(self):
        ev_a = _event(detail={"mode": "deterministic_mock", "config_digest": "aa"})
        ev_b = _event(detail={"config_digest": "aa", "mode": "deterministic_mock"})
        assert canonical_event_bytes(ev_a) == canonical_event_bytes(ev_b), \
            "detail insertion order must not change canonical bytes"

    def test_unknown_detail_key_rejected_strict(self):
        with pytest.raises(ValueError):
            detail_ok(EventType.POLICY_DECISION, {"hax": "1"})

    def test_sanitizer_rejects_canary_marker_values(self):
        with pytest.raises(ValueError, match="canary"):
            detail_ok(EventType.RUN_STARTED, {"mode": "BAYORA-CANARY-abc123"})

    def test_detail_change_changes_hash(self):
        ev_a = _event(detail={"mode": "a"})
        ev_b = _event(detail={"mode": "b"})
        assert event_hash(ev_a) != event_hash(ev_b)

    def test_all_event_types_have_allowlists(self):
        from app.schema import DETAIL_KEYS_BY_TYPE
        for et in EventType:
            assert et in DETAIL_KEYS_BY_TYPE, f"missing allowlist for {et}"
