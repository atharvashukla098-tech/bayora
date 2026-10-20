"""TokenBucket (pure) + RejectionBuffer (bounded evidence) — blueprint §7.3, D27.

The bucket answers "may this client proceed?" (spec §3.2's fourth limit);
the buffer answers "how do I record the no without unbounded fsync?". Under
flood, per-request rejection evidence is summarized into per-window
REJECTIONS_SUMMARY events — an honest, recorded trade (limitation L9).
"""

from __future__ import annotations

import time
from typing import Optional, Protocol

from app.clock import Clock


class MonotonicSource(Protocol):
    def __call__(self) -> float: ...


class TokenBucket:
    """Pure per-client token bucket: no I/O, purely time-parameterized.

    capacity = rate_limit_per_minute; refill = capacity/60 per second.
    Tests inject synthetic clocks via ``now_fn``.
    """

    def __init__(self, rate_per_minute: int, now_fn: Optional[MonotonicSource] = None):
        if rate_per_minute < 1:
            raise ValueError("rate_per_minute must be >= 1")
        self._capacity = float(rate_per_minute)
        self._rate = self._capacity / 60.0
        self._buckets: dict[str, tuple[float, float]] = {}  # key -> (tokens, last_ts)
        self._now = now_fn or time.monotonic

    def try_acquire(self, key: str, now: Optional[float] = None) -> bool:
        t = self._now() if now is None else now
        if key not in self._buckets:
            self._buckets[key] = (self._capacity, t)
        tokens, last = self._buckets[key]
        tokens = min(self._capacity, tokens + (t - last) * self._rate)
        if tokens >= 1.0:
            self._buckets[key] = (tokens - 1.0, t)
            return True
        self._buckets[key] = (tokens, t)
        return False

    def reset(self, key: Optional[str] = None) -> None:
        if key is None:
            self._buckets.clear()
        else:
            self._buckets.pop(key, None)


class RejectionBuffer:
    """Bounds pre-parse rejection evidence (D27).

    The FIRST ``max_error_events_per_run`` rejections are committed
    individually (so SC-06's per-request evidence exists); after that, or on
    every ``rejection_summary_window_s`` window boundary, rejections collapse
    into ONE REJECTIONS_SUMMARY event with per-reason decimal counts.
    ``commit()`` is idempotent per window; ``flush()`` drains at run completion.
    """

    def __init__(self, *, max_error_events: int = 500, window_seconds: float = 60.0,
                 now_fn: Optional[MonotonicSource] = None):
        self._max = max_error_events
        self._window = window_seconds
        self._now = now_fn or time.monotonic
        self._individual_count = 0
        self._window_start = self._now()
        self._pending: dict[str, int] = {}
        self._total_by_reason: dict[str, int] = {}
        self._events_emitted = 0

    def record(self, reason: str, *, ledger, run_id: Optional[str],
               scenario_id: Optional[str] = None,
               prompt: Optional[str] = None) -> None:
        """Record one pre-parse/destination rejection
        (reason in size|schema|rate|busy|destination).

        Commits an individual POLICY_DECISION event while under the cap and
        inside the first window; otherwise buffers for the window summary
        (D27). If a prompt is provided, only its DIGEST enters the event.
        """
        from app.schema import EventType, Outcome, Component, prompt_digest

        now = self._now()
        in_first_window = (now - self._window_start) < self._window
        under_cap = self._individual_count < self._max
        if in_first_window and under_cap:
            detail = {"rule": ("allowlist" if reason == "destination"
                               else "pre_parse"),
                      "reason": ("DESTINATION_REJECTED" if reason == "destination"
                                 else reason).upper(),
                      "matched": "",
                      "status_code": _status_for_reason(reason)}
            if reason == "destination":
                detail["reason"] = "DESTINATION_REJECTED"
                detail["status_code"] = "403"
            if prompt is not None:
                detail["prompt_digest"] = prompt_digest(prompt)
            outcome = (Outcome.BLOCKED if reason == "destination"
                       else Outcome.NOT_EVALUATED)
            ledger.append(EventType.POLICY_DECISION, Component.BROKER,
                          run_id=run_id, outcome=outcome,
                          scenario_id=scenario_id, detail=detail)
            self._individual_count += 1
            self._events_emitted += 1
            self._total_by_reason[reason] = self._total_by_reason.get(reason, 0) + 1
        else:
            # beyond the cap / window: buffered ONLY for the summary
            self._pending[reason] = self._pending.get(reason, 0) + 1
            self._total_by_reason[reason] = self._total_by_reason.get(reason, 0) + 1

    def commit(self, ledger, run_id: Optional[str], force: bool = False) -> int:
        """Emit a REJECTIONS_SUMMARY event for buffered rejections, if any.

        Idempotent per window; forced flush drains everything at completion.
        Returns the number of events emitted (0 or 1).
        """
        from app.schema import EventType, Component

        now = self._now()
        window_elapsed = (now - self._window_start) >= self._window
        if not self._pending:
            return 0
        if not (force or window_elapsed):
            return 0
        detail = {k: str(v) for k, v in self._pending.items()}
        detail["window_seconds"] = str(self._window)
        ledger.append(EventType.REJECTIONS_SUMMARY, Component.BROKER,
                      run_id=run_id, detail=detail)
        self._pending.clear()
        self._window_start = now
        self._events_emitted += 1
        return 1

    def flush(self, ledger, run_id: Optional[str]) -> int:
        """Run-completion drain (blueprint §7.4 step 10).

        Emits a REJECTIONS_SUMMARY for anything still buffered — regardless
        of window state — so a hostile burst that ends inside a window is
        SUMMARIZED, never silently dropped when the process exits. Returns
        the number of events emitted (0 or 1); idempotent once drained.
        """
        return self.commit(ledger, run_id, force=True)

    @property
    def total_rejections(self) -> int:
        return sum(self._total_by_reason.values())

    @property
    def events_emitted(self) -> int:
        return self._events_emitted

    @property
    def individual_count(self) -> int:
        return self._individual_count


def _status_for_reason(reason: str) -> str:
    return {"size": "413", "schema": "422", "rate": "429", "busy": "429",
            "destination": "403"}.get(reason, "400")
