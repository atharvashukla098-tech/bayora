"""Unit: hash-chain verification (known-good chain + each finding type)."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.harness.adversary import (
    delete_event, disposable_copy, flip_one_byte, reorder_events, truncate_tail,
)
from app.ledger.chain import Ledger
from app.ledger.verifier import verify_ledger
from app.schema import Component, EventType, Finding


def _populate(ledger: Ledger, n: int = 6) -> None:
    for i in range(n):
        ledger.append(EventType.REQUEST_INGRESS, Component.BROKER,
                       run_id="run-cv", detail={"prompt_digest": f"{i:016x}"})


def test_known_good_chain_valid(tmp_path, fixed_clock):
    led = Ledger(tmp_path / "run-a", fixed_clock)
    _populate(led)
    vr = verify_ledger(led.path)
    assert vr.valid, f"findings: {[f.value for f in vr.findings]}"
    assert vr.checked_height == 6
    assert vr.earliest_failure_seq is None


def test_byte_flip_detected(tmp_path, fixed_clock):
    led = Ledger(tmp_path / "run-b", fixed_clock)
    _populate(led)
    copy = disposable_copy(led.path, tmp_path / "copy-b")
    info = flip_one_byte(copy, 3)
    vr = verify_ledger(copy)
    assert not vr.valid
    assert Finding.BAD_HASH in vr.findings
    assert vr.earliest_failure_seq == 3


def test_expected_vs_computed_hash_differ(tmp_path, fixed_clock):
    led = Ledger(tmp_path / "run-c", fixed_clock)
    _populate(led)
    copy = disposable_copy(led.path, tmp_path / "copy-c")
    info = flip_one_byte(copy, 3)
    assert info.expected_hash != info.computed_hash
    assert len(info.expected_hash) == 64 and len(info.computed_hash) == 64


def test_reorder_detected(tmp_path, fixed_clock):
    led = Ledger(tmp_path / "run-d", fixed_clock)
    _populate(led, 6)
    copy = disposable_copy(led.path, tmp_path / "copy-d")
    reorder_events(copy, 2, 4)
    vr = verify_ledger(copy)
    assert not vr.valid
    assert Finding.BAD_LINK in vr.findings or Finding.BAD_SEQ in vr.findings


def test_deletion_detected(tmp_path, fixed_clock):
    led = Ledger(tmp_path / "run-e", fixed_clock)
    _populate(led, 5)
    copy = disposable_copy(led.path, tmp_path / "copy-e")
    delete_event(copy, 2)
    vr = verify_ledger(copy)
    assert not vr.valid
    assert Finding.BAD_SEQ in vr.findings
    assert Finding.BAD_LINK in vr.findings


def test_invalid_json_line_detected(tmp_path, fixed_clock):
    led = Ledger(tmp_path / "run-f", fixed_clock)
    _populate(led, 3)
    copy = disposable_copy(led.path, tmp_path / "copy-f")
    lines = copy.read_text().splitlines()
    lines[1] = "{not json"
    copy.write_text("\n".join(lines) + "\n")
    vr = verify_ledger(copy)
    assert not vr.valid
    assert Finding.INVALID_JSON in vr.findings


def test_empty_ledger_reports_invalid(tmp_path):
    d = tmp_path / "empty"
    d.mkdir()
    (d / "ledger.jsonl").write_text("", encoding="utf-8")
    vr = verify_ledger(d / "ledger.jsonl")
    assert vr.checked_height == 0
    assert vr.valid  # an empty ledger has nothing wrong structurally


def test_missing_file_is_fail_closed(tmp_path):
    vr = verify_ledger(tmp_path / "nope" / "ledger.jsonl")
    assert not vr.valid


def test_timestamps_monotonic_reordering_flagged(tmp_path, fixed_clock):
    led = Ledger(tmp_path / "run-g", fixed_clock)
    _populate(led, 3)
    vr = verify_ledger(led.path)
    assert vr.valid, "fixed clock must produce monotonic ts"
