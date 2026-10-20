"""Unit: rate limiting — TokenBucket + RejectionBuffer (D27)."""

from __future__ import annotations

from app.broker.ratelimit import RejectionBuffer, TokenBucket
from app.ledger.chain import Ledger
from app.schema import EventType


class FakeClock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def test_token_bucket_pure():
    clock = FakeClock()
    b = TokenBucket(5, now_fn=clock)
    results = [b.try_acquire("c", now=clock.t) for _ in range(5)]
    assert all(results)
    assert not b.try_acquire("c", now=clock.t), "6th request within burst must fail"


def test_token_bucket_refills_over_time():
    clock = FakeClock()
    b = TokenBucket(60, now_fn=clock)   # 1 token/second refill
    for _ in range(60):
        assert b.try_acquire("c", now=clock.t)
    assert not b.try_acquire("c", now=clock.t)
    clock.t += 10
    assert b.try_acquire("c", now=clock.t)


def test_token_bucket_per_client_isolation():
    clock = FakeClock()
    b = TokenBucket(1, now_fn=clock)
    assert b.try_acquire("a", now=clock.t)
    assert not b.try_acquire("a", now=clock.t)
    assert b.try_acquire("b", now=clock.t), "separate client has its own bucket"


def test_rejection_buffer_individual_then_capped(tmp_path, fixed_clock):
    led = Ledger(tmp_path / "run-rl1", fixed_clock)
    clock = FakeClock()
    buf = RejectionBuffer(max_error_events=5, window_seconds=60.0, now_fn=clock)
    for i in range(8):
        buf.record("size", ledger=led, run_id="run-rl1")
    # first 5 individual + none after (window not elapsed)
    events = led.read_all()
    policy_events = [e for e in events
                     if e.event_type == EventType.POLICY_DECISION]
    assert len(policy_events) == 5, \
        f"expected exactly max_error_events individual records, got {len(policy_events)}"


def test_rejection_buffer_summary_on_window_commit(tmp_path, fixed_clock):
    led = Ledger(tmp_path / "run-rl2", fixed_clock)
    clock = FakeClock()
    buf = RejectionBuffer(max_error_events=2, window_seconds=60.0, now_fn=clock)
    for i in range(10):
        buf.record("schema", ledger=led, run_id="run-rl2")
    # first 2 committed individually; the remaining 8 buffered for the summary
    clock.t += 61
    emitted = buf.commit(led, "run-rl2")
    assert emitted == 1
    events = led.read_all()
    summaries = [e for e in events
                 if e.event_type == EventType.REJECTIONS_SUMMARY]
    assert len(summaries) == 1
    assert summaries[0].detail["schema"] == "8", \
        "the summary carries exactly the BUFFERED (post-cap) rejections"
    assert summaries[0].detail["window_seconds"] == "60.0"


def test_rejection_buffer_commit_idempotent_per_window(tmp_path, fixed_clock):
    led = Ledger(tmp_path / "run-rl3", fixed_clock)
    clock = FakeClock()
    buf = RejectionBuffer(max_error_events=1, window_seconds=60.0, now_fn=clock)
    # first rejection: committed individually (under cap) — nothing buffered
    buf.record("rate", ledger=led, run_id="run-rl3")
    assert buf.commit(led, "run-rl3") == 0, \
        "an individually-committed rejection must not also be summarized"
    # exceed the cap: buffered; one summary per window; commit is idempotent
    buf.record("rate", ledger=led, run_id="run-rl3")
    clock.t += 61
    assert buf.commit(led, "run-rl3") == 1
    assert buf.commit(led, "run-rl3") == 0, "second commit in-window is a no-op"


def test_rejection_buffer_never_writes_raw_prompt(tmp_path, fixed_clock):
    led = Ledger(tmp_path / "run-rl4", fixed_clock)
    clock = FakeClock()
    buf = RejectionBuffer(max_error_events=3, window_seconds=60.0, now_fn=clock)
    buf.record("schema", ledger=led, run_id="run-rl4",
               prompt="BAYORA-CANARY-secret-value-here")
    text = led.path.read_text(encoding="utf-8")
    assert "BAYORA-CANARY-secret-value-here" not in text
    assert "prompt_digest" in text
