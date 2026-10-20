"""Append-only JSONL hash chain per run (blueprint §5.2, D2).

``runs/<run_id>/ledger.jsonl``: human-inspectable, trivially hashable, no DB.
Writes are atomic-per-line appends with flush + os.fsync; a crash mid-write
yields a trailing partial line which the verifier reports as INVALID_JSON
(fail closed, deterministic). Single-writer by design (documented limitation).

Checkpoint cadence (D25): when an append lands exactly on a multiple of
``checkpoint_every``, the Ledger signs at that height FIRST (via the injected
signer callback — the ledger never owns crypto), THEN appends the
CHECKPOINT_SIGNED announcement event. A checkpoint therefore never covers its
own announcement; the next issuance anchors it.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Callable, Optional, Protocol

from app.clock import Clock, iso_utc
from app.schema import (
    Component,
    EventRecord,
    EventType,
    Outcome,
    event_hash,
)

LEDGER_FILENAME = "ledger.jsonl"
GENESIS_PREV_HASH = "0" * 64


class CheckpointSigner(Protocol):
    """Injected by the harness; keeps crypto out of the ledger write path."""

    def sign_at_height(self, ledger: "Ledger", height: int) -> tuple[int, str]:
        """Sign a checkpoint covering exactly ``height`` events.

        Returns (checkpoint_seq, key_id) for the announcement event detail.
        Must NOT append to the ledger (D25: sign first, announce after).
        """


class Ledger:
    """One run's append-only event chain."""

    def __init__(self, run_dir: Path, clock: Clock,
                 checkpoint_signer: Optional[CheckpointSigner] = None,
                 checkpoint_every: int = 10):
        self.run_dir = Path(run_dir)
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.run_dir / LEDGER_FILENAME
        self.clock = clock
        self.checkpoint_signer = checkpoint_signer
        self.checkpoint_every = checkpoint_every

    # -- reading -----------------------------------------------------------

    def read_all(self) -> list[EventRecord]:
        """Strict-parse every line; INVALID_JSON surfaces as a Verifier finding."""
        if not self.path.exists():
            return []
        out: list[EventRecord] = []
        with self.path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                out.append(EventRecord.model_validate_json(line))
        return out

    @property
    def block_height(self) -> int:
        """Number of committed events (line count; cheap and exact for JSONL)."""
        if not self.path.exists():
            return 0
        with self.path.open("r", encoding="utf-8") as fh:
            return sum(1 for line in fh if line.strip())

    def head(self) -> Optional[EventRecord]:
        events = self.read_all()
        return events[-1] if events else None

    # -- writing -----------------------------------------------------------

    def append(self, event_type: EventType, component: Component, *,
               run_id: Optional[str] = None,
               outcome: Optional[Outcome] = None,
               scenario_id: Optional[str] = None,
               detail: Optional[dict] = None) -> EventRecord:
        """Append one event; assigns seq/prev_hash from head, hash per schema rules.

        At cadence heights (block_height % checkpoint_every == 0, height > 0)
        with a signer attached, signs the checkpoint BEFORE appending the
        CHECKPOINT_SIGNED announcement (D25: announce-after-sign).
        """
        from app.ledger.events import build_event

        prev = self.head()
        seq = 1 if prev is None else prev.seq + 1
        prev_hash = GENESIS_PREV_HASH if prev is None else prev.hash

        # D25 cadence: sign first (sidecar only), then announce.
        if (self.checkpoint_signer is not None and self.checkpoint_every > 0
                and seq > 1 and (seq - 1) % self.checkpoint_every == 0):
            cp_seq, key_id = self.checkpoint_signer.sign_at_height(self, seq - 1)
            announce = build_event(
                EventType.CHECKPOINT_SIGNED, Component.LEDGER,
                run_id=run_id, scenario_id=scenario_id,
                detail={"checkpoint_seq": str(cp_seq), "key_id": key_id},
                seq=seq, prev_hash=prev_hash, ts=iso_utc(self.clock.now_utc()))
            self._write_line(announce)
            seq += 1
            prev_hash = announce.hash

        ev = build_event(
            event_type, component,
            run_id=run_id, outcome=outcome, scenario_id=scenario_id,
            detail=detail, seq=seq, prev_hash=prev_hash,
            ts=iso_utc(self.clock.now_utc()))
        self._write_line(ev)
        return ev

    def sign_and_announce(self, *, run_id: Optional[str] = None,
                          scenario_id: Optional[str] = None) -> EventRecord:
        """Completion issuance (D25): sign the CURRENT head FIRST (sidecar
        only), THEN append the CHECKPOINT_SIGNED announcement.

        The checkpoint therefore never covers its own announcement — same
        invariant as the cadence path in ``append``. Used exactly once per
        run, at run completion (blueprint §9.2 step 6 / D25); requires a
        signer. Returns the announcement event.
        """
        if self.checkpoint_signer is None:
            raise ValueError("completion checkpoint needs a checkpoint signer")
        prev = self.head()
        if prev is None:
            raise ValueError("cannot checkpoint an empty ledger")
        from app.ledger.events import build_event
        cp_seq, key_id = self.checkpoint_signer.sign_at_height(self, prev.seq)
        announce = build_event(
            EventType.CHECKPOINT_SIGNED, Component.LEDGER,
            run_id=run_id, scenario_id=scenario_id,
            detail={"checkpoint_seq": str(cp_seq), "key_id": key_id},
            seq=prev.seq + 1, prev_hash=prev.hash,
            ts=iso_utc(self.clock.now_utc()))
        self._write_line(announce)
        return announce

    def _write_line(self, ev: EventRecord) -> None:
        line = ev.model_dump_json() + "\n"
        with self.path.open("a", encoding="utf-8", newline="\n") as fh:
            fh.write(line)
            fh.flush()
            os.fsync(fh.fileno())

    # -- self check --------------------------------------------------------

    def verify_self(self) -> bool:
        """Cheap internal chain check used at write time (fail closed)."""
        try:
            from app.ledger.verifier import verify_ledger
            return verify_ledger(self.path).valid
        except Exception:
            return False
