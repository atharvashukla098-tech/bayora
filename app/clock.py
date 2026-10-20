"""Injectable clocks (blueprint §4.3).

All timestamps are real UTC ISO-8601 with explicit offset. Determinism in tests
means "same decisions/outcomes/assertions", never "same hash values" — the
FixedClock exists so event ordering is stable in tests; no golden literals are
compared anywhere and tests always recompute.
"""

from __future__ import annotations

import time as _time
from datetime import datetime, timedelta, timezone
from typing import Protocol


class Clock(Protocol):
    def now_utc(self) -> datetime: ...


class SystemClock:
    """Real wall clock — used in every production path (spec §8)."""

    def now_utc(self) -> datetime:
        return datetime.now(timezone.utc).astimezone(timezone.utc)


class FixedClock:
    """Monotonic test clock: each call advances exactly one second."""

    def __init__(self, start: datetime):
        self._t = start.replace(tzinfo=timezone.utc)

    def now_utc(self) -> datetime:
        self._t = self._t + timedelta(seconds=1)
        return self._t


def iso_utc(dt: datetime) -> str:
    """Canonical UTC timestamp string used across every artifact."""
    return dt.astimezone(timezone.utc).isoformat()


def monotonic_seconds() -> float:
    """Monotonic clock for rate-limit arithmetic (never wall time)."""
    return _time.monotonic()
