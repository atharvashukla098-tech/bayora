"""Disposable-copy corruption helpers (spec §6, blueprint §9.4).

Every helper operates on a COPY under a temp dir — the original evidence
ledger is never touched (byte-verified by tests). All hash values are
recomputed live; nothing is hardcoded.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict

from app.schema import EventRecord


class TamperInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["byte", "delete", "reorder", "truncate", "forge"]
    event_index: Optional[int]      # 1-based event number touched
    expected_hash: str              # real value recomputed from the chain
    computed_hash: str              # real value after corruption


def disposable_copy(ledger_path: Path, tmp_dir: Path) -> Path:
    """Copy the ledger to tmp_dir; never touches the original."""
    tmp_dir = Path(tmp_dir)
    tmp_dir.mkdir(parents=True, exist_ok=True)
    dest = tmp_dir / Path(ledger_path).name
    shutil.copy2(ledger_path, dest)
    return dest


def _read_lines(copy: Path) -> list[str]:
    return [line for line in Path(copy).read_text(encoding="utf-8").splitlines()
            if line.strip()]


def _write_lines(copy: Path, lines: list[str]) -> None:
    Path(copy).write_text("\n".join(lines) + "\n", encoding="utf-8")


def flip_one_byte(copy: Path, event_index: int) -> TamperInfo:
    """Flip one byte of event #event_index's stored text; returns live hashes.

    The flip targets a payload character (never the stored hash field) so the
    recomputed hash genuinely diverges from the stored one.
    """
    lines = _read_lines(copy)
    idx = event_index - 1
    ev = EventRecord.model_validate_json(lines[idx])
    expected = ev.hash

    # Corrupt one byte inside the event_id field (a payload field, not the
    # stored hash). event_id is a plain string so the corrupted line still
    # parses — the recomputed hash then genuinely diverges (BAD_HASH), which
    # is exactly the detection the demo must show.
    import json
    obj = json.loads(lines[idx])
    event_id = obj["event_id"]
    flipped = ("f" if event_id[0] != "f" else "e") + event_id[1:]
    obj["event_id"] = flipped
    lines[idx] = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)

    _write_lines(copy, lines)
    ev2 = EventRecord.model_validate_json(lines[idx])
    from app.schema import event_hash
    # computed = hash RECOMPUTED from the corrupted content (the verifier's
    # recomputation); expected = the stored, uncorrupted hash. They differ.
    return TamperInfo(mode="byte", event_index=event_index,
                      expected_hash=expected, computed_hash=event_hash(ev2))


def delete_event(copy: Path, event_index: int) -> TamperInfo:
    """Delete event #event_index (1-based) from the copy.

    By hash-chain construction the successor's STORED prev_hash is exactly
    the deleted event's hash, so comparing those two values is degenerate
    (always equal — the old check falsely reported 'verifier would miss
    it'). The honest detection evidence is the link divergence the verifier
    actually flags as BAD_LINK at the successor's new position:

      expected_hash = the prev-link the chain REQUIRES there (the remaining
                      predecessor's stored hash; genesis zero-hash if the
                      successor is now first)
      computed_hash = the prev-link the successor ACTUALLY stores (the
                      deleted event's hash)

    Both are read live from the corrupted copy; they differ structurally,
    and the verifier's rejection is asserted separately by
    assert_tamper_rejected (BAD_SEQ gap + BAD_LINK).
    """
    lines = _read_lines(copy)
    idx = event_index - 1
    ev = EventRecord.model_validate_json(lines[idx])
    _ = ev.hash   # the deleted event's own hash; not the detection signal
    del lines[idx]
    _write_lines(copy, lines)
    if idx < len(lines):
        nxt = EventRecord.model_validate_json(lines[idx])
        required_prev = ("0" * 64 if idx == 0
                         else EventRecord.model_validate_json(lines[idx - 1]).hash)
        return TamperInfo(mode="delete", event_index=event_index,
                          expected_hash=required_prev,
                          computed_hash=nxt.prev_hash)
    return TamperInfo(mode="delete", event_index=event_index,
                      expected_hash=ev.hash, computed_hash="0" * 64)


def reorder_events(copy: Path, i: int, j: int) -> TamperInfo:
    """Swap events at positions i and j (1-based)."""
    lines = _read_lines(copy)
    ev_i = EventRecord.model_validate_json(lines[i - 1])
    lines[i - 1], lines[j - 1] = lines[j - 1], lines[i - 1]
    _write_lines(copy, lines)
    ev_after = EventRecord.model_validate_json(lines[i - 1])
    return TamperInfo(mode="reorder", event_index=i,
                      expected_hash=ev_i.hash, computed_hash=ev_after.hash)


def truncate_tail(copy: Path, n: int) -> TamperInfo:
    """Drop the last n events."""
    lines = _read_lines(copy)
    keep = max(0, len(lines) - n)
    removed = EventRecord.model_validate_json(lines[keep])
    expected = removed.hash
    _write_lines(copy, lines[:keep])
    if keep > 0:
        new_head = EventRecord.model_validate_json(lines[keep - 1])
        return TamperInfo(mode="truncate", event_index=keep + 1,
                          expected_hash=expected, computed_hash=new_head.hash)
    return TamperInfo(mode="truncate", event_index=keep + 1,
                      expected_hash=expected, computed_hash="0" * 64)


def forge_checkpoint_signature(cp) -> "Checkpoint":
    """Corrupt the signature bytes of a copy of a checkpoint."""
    import base64
    from app.ledger.checkpoints import Checkpoint
    data = cp.model_dump()
    if data.get("signature"):
        raw = bytearray(base64.b64decode(data["signature"]))
        raw[0] = raw[0] ^ 0xFF
        data["signature"] = base64.b64encode(bytes(raw)).decode("ascii")
    else:
        data["signature"] = base64.b64encode(b"\x00" * 64).decode("ascii")
    return Checkpoint.model_validate(data)
