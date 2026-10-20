"""Event construction with fail-closed detail allowlist + sanitization (D24).

One consistent API everywhere: ``build_event(..., detail=...)``,
``Ledger.append(..., detail=...)`` and ``append_and_commit(..., detail=...)``
take the same ``detail`` parameter. There is no ``**meta`` form and no sidecar
evidence format.

Rule (D13): no error path anywhere in the app may pass a raw prompt, response
body or validation-error dict into event construction — only digests
(sha256(text)[:16]) and static reason codes. ``sanitize_detail_value`` is the
belt-and-braces backstop.
"""

from __future__ import annotations

from typing import Optional

from app.clock import Clock, iso_utc
from app.schema import (
    Component,
    EventRecord,
    EventType,
    Outcome,
    detail_ok,
    event_hash,
)
import uuid

from app.ledger.chain import Ledger


def build_event(event_type: EventType, component: Component, *,
                run_id: Optional[str] = None,
                outcome: Optional[Outcome] = None,
                scenario_id: Optional[str] = None,
                detail: Optional[dict] = None,
                seq: int, prev_hash: str, ts: str) -> EventRecord:
    """Construct a hashed EventRecord; unknown detail keys raise ValueError."""
    clean_detail = detail_ok(event_type, detail)
    ev = EventRecord(
        schema_version="1.0",
        event_id=uuid.uuid4().hex,
        seq=seq,
        ts=ts,
        run_id=run_id,
        event_type=event_type,
        component=component,
        outcome=outcome,
        scenario_id=scenario_id,
        detail=clean_detail,
        prev_hash=prev_hash,
        hash="",
    )
    return ev.model_copy(update={"hash": event_hash(ev)})


def append_and_commit(ledger: "Ledger", event_type: EventType, component: Component, *,
                      run_id: Optional[str] = None,
                      outcome: Optional[Outcome] = None,
                      scenario_id: Optional[str] = None,
                      detail: Optional[dict] = None) -> EventRecord:
    """Append an event, then emit its LEDGER_COMMITTED companion event.

    The companion event (detail={"block": str(seq), "event_hash": ev.hash})
    is itself the next event in the chain. Returns the ORIGINAL event.
    """
    ev = ledger.append(event_type, component, run_id=run_id, outcome=outcome,
                       scenario_id=scenario_id, detail=detail)
    ledger.append(EventType.LEDGER_COMMITTED, Component.LEDGER,
                  run_id=run_id, scenario_id=scenario_id,
                  detail={"block": str(ev.seq), "event_hash": ev.hash})
    return ev
