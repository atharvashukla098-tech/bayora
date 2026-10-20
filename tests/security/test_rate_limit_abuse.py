"""Security: rate-limit abuse — flood => bounded ledger growth (D27)."""

from __future__ import annotations

from app.schema import EventType


def test_rate_limit_returns_429_not_evaluated(broker_app):
    """A burst past 120/min => 429 RATE_LIMITED, outcome NOT_EVALUATED."""
    from fastapi.testclient import TestClient
    tc = TestClient(broker_app, raise_server_exceptions=False)
    seen_429 = False
    for i in range(150):
        r = tc.post("/v1/evaluate", json={"prompt": "hello"},
                    headers={"X-Bayora-Run": "run-rl-abuse"})
        if r.status_code == 429:
            body = r.json()
            assert body["error"] == "RATE_LIMITED"
            assert body["outcome"] == "NOT_EVALUATED"
            seen_429 = True
            break
    assert seen_429, "150 requests/min must trip the 120/min bucket"


def test_error_ledger_writes_are_capped(broker_app):
    """1000 oversized posts => bounded POLICY_DECISION events (D27 cap)."""
    from fastapi.testclient import TestClient
    tc = TestClient(broker_app, raise_server_exceptions=False)
    for _ in range(1000):
        tc.post("/v1/evaluate", json={"prompt": "x" * 9000},
                headers={"X-Bayora-Run": "run-rl-flood"})
    ledger = broker_app.state.ledger
    events = ledger.read_all()
    policy_events = [e for e in events
                     if e.event_type == EventType.POLICY_DECISION]
    # cap is 500 individual events; the rest is buffered for the window summary
    assert len(policy_events) <= 500 + 10, \
        f"flood produced {len(policy_events)} events — the cap is not enforced"
    # every individual rejection is NOT_EVALUATED (never counted as contained)
    assert all(e.outcome.value == "NOT_EVALUATED" for e in policy_events)


def test_rejections_summary_emitted_after_window(broker_app):
    from fastapi.testclient import TestClient
    tc = TestClient(broker_app, raise_server_exceptions=False)
    # 600 oversized posts: first 500 individual (cap), remaining 100 buffered
    for _ in range(600):
        tc.post("/v1/evaluate", json={"prompt": "x" * 9000},
                headers={"X-Bayora-Run": "run-rl-sum"})
    # force the window to elapse via the buffer's own clock (test-only)
    buf = broker_app.state.rejection_buffer
    buf._window_start -= 61
    buf.commit(broker_app.state.ledger, "run-rl-sum", force=True)
    events = broker_app.state.ledger.read_all()
    summaries = [e for e in events
                 if e.event_type == EventType.REJECTIONS_SUMMARY]
    assert summaries, "a window summary must exist after the flood"
    detail = summaries[-1].detail
    # the flood mixes 'size' (413) and 'rate' (429) rejections — both counted
    total_buffered = sum(int(v) for k, v in detail.items()
                         if k not in ("window_seconds",))
    assert total_buffered >= 100, \
        f"the summary must carry the buffered post-cap rejections (got {detail})"
    assert "window_seconds" in detail


def test_rate_limited_never_calls_target(broker_app, secret_store):
    """The rate gate sits before ingress — the target is unreachable under
    rate-limit rejection."""
    from fastapi.testclient import TestClient
    from app.config import BayoraConfig
    from app.broker.service import create_broker_app
    from app.ledger.chain import Ledger

    calls = {"n": 0}

    class CountingTarget:
        async def call(self, prompt, timeout):
            calls["n"] += 1
            from app.target.mock import MockResponse, MockBehavior
            return MockResponse(text="ok", behavior=MockBehavior.BENIGN)

    import tempfile
    from pathlib import Path
    from app.clock import SystemClock
    tmp = Path(tempfile.mkdtemp())
    cfg = BayoraConfig()
    led = Ledger(tmp / "run-rl-nc", SystemClock())
    app = create_broker_app(cfg, target_client=CountingTarget(), ledger=led,
                            secret_store=secret_store)
    tc = TestClient(app, raise_server_exceptions=False)
    got_429 = False
    for _ in range(200):
        r = tc.post("/v1/evaluate", json={"prompt": "hi"},
                    headers={"X-Bayora-Run": "run-rl-nc"})
        if r.status_code == 429:
            got_429 = True
            break
    assert got_429
    assert calls["n"] < 130, "rate-limited requests must not reach the target"


def test_check_destination_flood_is_rate_limited_and_capped(broker_app):
    """Attack regression: POST /v1/check-destination is inside the rate
    gate AND its rejections flow through the RejectionBuffer — a flood
    can never mean one fsynced ledger event per call."""
    from fastapi.testclient import TestClient
    tc = TestClient(broker_app, raise_server_exceptions=False)
    seen_429 = False
    for _ in range(300):
        r = tc.post("/v1/check-destination",
                    json={"url": "http://evil.example:9000/egress"},
                    headers={"X-Bayora-Run": "run-rl-dest"})
        if r.status_code == 429:
            body = r.json()
            assert body["error"] == "RATE_LIMITED"
            assert body["outcome"] == "NOT_EVALUATED"
            seen_429 = True
            break
    assert seen_429, "a check-destination flood must trip the rate gate"

    ledger = broker_app.state.ledger
    events = ledger.read_all()
    policy_events = [e for e in events
                     if e.event_type == EventType.POLICY_DECISION]
    # rejections beyond the cap are buffered for the window summary — the
    # individual-event count stays bounded by max_error_events_per_run (500)
    assert len(policy_events) <= 500 + 10, \
        f"destination flood produced {len(policy_events)} individual " \
        f"POLICY_DECISION events — the cap is not enforced on this route"
    # the bounded rejection evidence is digest-only (no raw URL)
    text = ledger.path.read_text(encoding="utf-8")
    assert "evil.example" not in text


def test_flush_summarizes_buffered_rejections_within_the_window(broker_app):
    """Attack regression (r2): a burst that ends INSIDE the summary window
    must still be summarized. The old buffer had no flush() and the
    middleware committed only when a window had elapsed — buffered
    rejections died with the process, recorded nowhere (blueprint §7.4
    step 10 requires the drain at run completion)."""
    from fastapi.testclient import TestClient
    tc = TestClient(broker_app, raise_server_exceptions=False)
    # 600 oversized posts: 500 individual (cap) + 100 buffered mid-window
    for _ in range(600):
        tc.post("/v1/evaluate", json={"prompt": "x" * 9000},
                headers={"X-Bayora-Run": "run-rl-flush"})
    ledger = broker_app.state.ledger
    buf = broker_app.state.rejection_buffer

    # mid-window: the 100 overflow are buffered, NOT yet on the ledger
    events_before = [e for e in ledger.read_all()
                     if e.event_type == EventType.REJECTIONS_SUMMARY]
    assert not events_before, "mid-window flush should not have fired"

    # run completion drains the buffer: flush() must emit the summary
    emitted = buf.flush(ledger, "run-rl-flush")
    assert emitted == 1, "flush() must drain buffered rejections"
    summaries = [e for e in ledger.read_all()
                 if e.event_type == EventType.REJECTIONS_SUMMARY]
    assert summaries, "the drained summary must be on the ledger"
    detail = summaries[-1].detail
    total_buffered = sum(int(v) for k, v in detail.items()
                         if k not in ("window_seconds",))
    assert total_buffered >= 100, \
        f"the summary must carry the 100 buffered mid-window rejections " \
        f"(got {detail})"
    # flush is idempotent once drained
    assert buf.flush(ledger, "run-rl-flush") == 0
