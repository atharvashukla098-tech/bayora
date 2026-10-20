"""Ed25519 signed checkpoints (blueprint §5.4, D4/D12/D25).

``checkpoint_at_head`` (the pre-tamper refresh) is READ-ONLY w.r.t.
``ledger.jsonl``: it signs the current head and records issuance in the
sidecars only (checkpoint.json + checkpoint_history.jsonl), appending NO
event — so ``checkpoint_seq == block_height`` still holds after the refresh.

``CHECKPOINT_SIGNED`` events are announced only at cadence/completion
issuance, AFTER signing (see chain.py's injected CheckpointSigner), so a
checkpoint never covers its own announcement.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from pydantic import BaseModel, ConfigDict

from app.clock import Clock, iso_utc
from app.ledger.keys import KEY_ID

CHECKPOINT_FILENAME = "checkpoint.json"
CHECKPOINT_HISTORY_FILENAME = "checkpoint_history.jsonl"

CHECKPOINT_SIGNED_FIELDS = ("schema_version", "ledger_id", "checkpoint_seq",
                            "final_event_hash", "created_at", "key_id")


class Checkpoint(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    schema_version: str            # "1.0"
    ledger_id: str                 # run_id of the ledger (ledger identity)
    checkpoint_seq: int            # block height covered
    final_event_hash: str          # hash of event #checkpoint_seq
    created_at: str                # real UTC ISO
    key_id: str                    # e.g. "local-demo-key"
    signature: Optional[str]       # base64 of raw sig; excluded from signing input


def canonical_checkpoint_bytes(cp: Checkpoint) -> bytes:
    """Fixed field order, separators=(",",":"), ensure_ascii=False, UTF-8.

    The signature field is EXCLUDED — it is what is signed/verified.
    """
    payload = {field: getattr(cp, field) for field in CHECKPOINT_SIGNED_FIELDS}
    return json.dumps(payload, separators=(",", ":"), sort_keys=False,
                      ensure_ascii=False).encode("utf-8")


def sign_checkpoint(cp: Checkpoint, private_key: Ed25519PrivateKey) -> Checkpoint:
    """Sign the canonical bytes; returns a new Checkpoint with .signature set."""
    sig = private_key.sign(canonical_checkpoint_bytes(cp))
    return cp.model_copy(update={"signature": base64.b64encode(sig).decode("ascii")})


def verify_checkpoint(cp: Checkpoint, public_key: Optional[Ed25519PublicKey]) -> bool:
    """False on any error — never raises to the caller."""
    if public_key is None or cp.signature is None:
        return False
    try:
        public_key.verify(base64.b64decode(cp.signature), canonical_checkpoint_bytes(cp))
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False


def write_checkpoint(cp: Checkpoint, run_dir: Path) -> Path:
    """Write the latest checkpoint sidecar; append to the history sidecar."""
    run_dir = Path(run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)
    latest = run_dir / CHECKPOINT_FILENAME
    latest.write_text(cp.model_dump_json() + "\n", encoding="utf-8")
    history = run_dir / CHECKPOINT_HISTORY_FILENAME
    with history.open("a", encoding="utf-8", newline="\n") as fh:
        fh.write(cp.model_dump_json() + "\n")
    return latest


def load_checkpoint(run_dir: Path) -> Optional[Checkpoint]:
    """Load the latest checkpoint sidecar if it exists."""
    path = Path(run_dir) / CHECKPOINT_FILENAME
    if not path.is_file():
        return None
    try:
        return Checkpoint.model_validate_json(path.read_text(encoding="utf-8").strip())
    except Exception:
        return None


def checkpoint_at_head(ledger, private_key: Ed25519PrivateKey,
                       key_id: str, clock: Clock) -> Checkpoint:
    """Sign the ledger's current head (D12 + D25).

    READ-ONLY w.r.t. ledger.jsonl: appends NO event, so the runner's
    ``checkpoint_seq == ledger.block_height`` assertion holds after refresh.
    Writes checkpoint.json + appends to checkpoint_history.jsonl (sidecars).
    """
    height = ledger.block_height
    head = ledger.head()
    if head is None or height == 0:
        raise ValueError("cannot checkpoint an empty ledger")
    if head.seq != height:
        raise ValueError(
            f"head seq {head.seq} != block height {height} — ledger inconsistent")
    cp = sign_checkpoint(Checkpoint(
        schema_version="1.0",
        ledger_id=head.run_id or "unknown",
        checkpoint_seq=height,
        final_event_hash=head.hash,
        created_at=iso_utc(clock.now_utc()),
        key_id=key_id,
        signature=None,
    ), private_key)
    write_checkpoint(cp, ledger.run_dir)
    return cp


class LedgerCheckpointSigner:
    """CheckpointSigner implementation injected into Ledger (D25 cadence).

    sign_at_height signs at the exact height captured by the caller — it
    appends NOTHING to ledger.jsonl (sidecar-only).
    """

    def __init__(self, private_key: Ed25519PrivateKey, key_id: str, clock: Clock):
        self._private_key = private_key
        self._key_id = key_id
        self._clock = clock

    def sign_at_height(self, ledger, height: int) -> tuple[int, str]:
        head_events = ledger.read_all()
        if height <= 0 or height > len(head_events):
            raise ValueError(f"cannot checkpoint at height {height}")
        head_ev = head_events[height - 1]
        cp = sign_checkpoint(Checkpoint(
            schema_version="1.0",
            ledger_id=head_ev.run_id or "unknown",
            checkpoint_seq=height,
            final_event_hash=head_ev.hash,
            created_at=iso_utc(self._clock.now_utc()),
            key_id=self._key_id,
            signature=None,
        ), self._private_key)
        write_checkpoint(cp, ledger.run_dir)
        return height, self._key_id
