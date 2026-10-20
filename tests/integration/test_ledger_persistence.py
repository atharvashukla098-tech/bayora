"""Integration: ledger persistence + recovery from a partial write."""

from __future__ import annotations

from app.ledger.chain import Ledger
from app.ledger.verifier import verify_ledger
from app.schema import Component, EventType, Finding


def test_ledger_persists_across_instances(tmp_path, fixed_clock):
    led1 = Ledger(tmp_path / "run-p1", fixed_clock)
    led1.append(EventType.RUN_STARTED, Component.HARNESS, run_id="run-p1",
                detail={"mode": "deterministic_mock", "config_digest": "ab" * 8})
    led2 = Ledger(tmp_path / "run-p1", fixed_clock)
    led2.append(EventType.RUN_STARTED, Component.HARNESS, run_id="run-p1",
                detail={"mode": "deterministic_mock", "config_digest": "cd" * 8})
    events = led2.read_all()
    assert len(events) == 2
    assert events[0].seq == 1 and events[1].seq == 2
    assert events[1].prev_hash == events[0].hash
    assert verify_ledger(led2.path).valid


def test_partial_trailing_line_is_fail_closed(tmp_path, fixed_clock):
    """A crash mid-write leaves a trailing partial line: INVALID_JSON."""
    led = Ledger(tmp_path / "run-p2", fixed_clock)
    for i in range(3):
        led.append(EventType.REQUEST_INGRESS, Component.BROKER,
                   run_id="run-p2", detail={"prompt_digest": f"{i:016x}"})
    with led.path.open("a", encoding="utf-8") as fh:
        fh.write('{"schema_version":"1.0","event_id":"trunca')  # no newline
    vr = verify_ledger(led.path)
    assert not vr.valid
    assert Finding.INVALID_JSON in vr.findings


def test_fsync_writes_are_visible_immediately(tmp_path, fixed_clock):
    led = Ledger(tmp_path / "run-p3", fixed_clock)
    led.append(EventType.RUN_STARTED, Component.HARNESS, run_id="run-p3",
                detail={"mode": "deterministic_mock", "config_digest": "aa" * 8})
    # reopen a fresh instance: the event must be there (flush+fsync worked)
    assert len(Ledger(tmp_path / "run-p3", fixed_clock).read_all()) == 1


def test_block_height_counts_lines(tmp_path, fixed_clock):
    led = Ledger(tmp_path / "run-p4", fixed_clock)
    assert led.block_height == 0
    for i in range(4):
        led.append(EventType.REQUEST_INGRESS, Component.BROKER,
                   run_id="run-p4", detail={"prompt_digest": f"{i:016x}"})
    assert led.block_height == 4
