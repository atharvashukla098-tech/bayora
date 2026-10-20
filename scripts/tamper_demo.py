#!/usr/bin/env python
"""Tamper demonstration on a DISPOSABLE COPY (spec §6, blueprint §13 scene 5).

Sequence (all values computed live; nothing hardcoded):
  1. copy a known-good ledger to a temp dir
  2. record the original verification result
  3. alter one byte in event #N of the copy (--mode byte; also delete /
     reorder / truncate / forge for the test-suite's coverage)
  4. run the independent verifier against the modified copy
  5. display expected and computed hash values
  6. identify the earliest detected integrity failure
  7. show the verifier's non-zero failure result
  8. re-verify the original — UNMODIFIED

The original evidence ledger is never touched (byte-verified by tests).
"""

from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.harness.adversary import (
    disposable_copy, flip_one_byte, delete_event, reorder_events,
    truncate_tail, forge_checkpoint_signature,
)
from app.ledger.verifier import verify_ledger


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Bayora ledger tamper demo")
    parser.add_argument("--ledger", required=True,
                        help="path to the ORIGINAL ledger.jsonl")
    parser.add_argument("--mode", default="byte",
                        choices=["byte", "delete", "reorder", "truncate", "forge"])
    parser.add_argument("--event", type=int, default=3,
                        help="1-based event index to corrupt (default 3)")
    parser.add_argument("--checkpoint", default=None,
                        help="optional signed checkpoint (for --mode forge)")
    parser.add_argument("--public-key", default=None)
    args = parser.parse_args(argv)

    original = Path(args.ledger)
    if not original.is_file():
        print(f"ERROR: ledger not found: {original}")
        return 2

    pub = None
    if args.public_key:
        from app.ledger.keys import load_public_key
        pub = load_public_key(Path(args.public_key))

    print("BAYORA LEDGER TAMPER DEMONSTRATION")
    print("-" * 46)

    # 1-2. copy + record original verification
    pre = verify_ledger(original)
    print(f"Original ledger:       {'VALID' if pre.valid else 'INVALID'}")
    if not pre.valid:
        print("ERROR: refusing to demo on a non-valid original")
        return 2

    tmp = Path(tempfile.mkdtemp(prefix="bayora-tamperdemo-"))
    copy = disposable_copy(original, tmp)
    print(f"Disposable copy:       CREATED ({copy})")

    checkpoint = None
    if args.mode == "forge":
        if not args.checkpoint:
            cp_path = original.parent / "checkpoint.json"
        else:
            cp_path = Path(args.checkpoint)
        if not cp_path.is_file():
            print("ERROR: --mode forge needs a checkpoint (none found)")
            return 2
        from app.ledger.checkpoints import Checkpoint
        checkpoint = Checkpoint.model_validate_json(cp_path.read_text().strip())

    if checkpoint is not None:
        from app.ledger.verifier import verify_ledger as _vl
        pre_cp = _vl(original, checkpoint=checkpoint,
                     trusted_public_key=pub or _default_pub())
        print(f"Checkpoint at head:    {'SIGNED' if pre_cp.valid else 'MISMATCH'} "
              f"(seq={checkpoint.checkpoint_seq}, key={checkpoint.key_id})")

    # 3-4. corrupt + verify the copy
    if args.mode == "byte":
        info = flip_one_byte(copy, args.event)
        print(f"Modified event:         #{info.event_index}  (one byte flipped)")
        print(f"Expected hash:          {info.expected_hash}")
        print(f"Computed hash:          {info.computed_hash}")
    elif args.mode == "delete":
        info = delete_event(copy, args.event)
        print(f"Deleted event:          #{info.event_index}")
        print(f"Expected hash:          {info.expected_hash}")
        print(f"Successor links to:     {info.computed_hash}")
    elif args.mode == "reorder":
        h = verify_ledger(copy).checked_height
        info = reorder_events(copy, 1, min(3, h))
        print(f"Reordered events:       #1 <-> #{min(3, h)}")
        print(f"Expected hash:          {info.expected_hash}")
        print(f"Computed hash:          {info.computed_hash}")
    elif args.mode == "truncate":
        info = truncate_tail(copy, 2)
        print("Truncated tail by:      2 events")
        print(f"Removed event hash:     {info.expected_hash}")
        print(f"New head hash:          {info.computed_hash}")
    else:  # forge
        forged = forge_checkpoint_signature(checkpoint)
        from app.ledger.checkpoints import verify_checkpoint
        ok = verify_checkpoint(forged, pub or _default_pub())
        print(f"Forged checkpoint:      signature bytes corrupted")
        print(f"Forged signature verifies: {ok}")
        vr = verify_ledger(original, checkpoint=forged,
                           trusted_public_key=pub or _default_pub())
        print(f"[TAMPER REJECTED]" if not vr.valid else "[FAIL: forged accepted]")
        _original_ok(original, checkpoint, pub or _default_pub())
        return 0 if not vr.valid else 1

    # 5-7. verifier result on the corrupted copy
    vr = verify_ledger(copy, checkpoint=checkpoint,
                       trusted_public_key=(pub or _default_pub()) if checkpoint else None)
    print()
    # Exit contract: the tampered copy FAILS verification => non-zero exit
    # (spec §6 step 7: "the verifier's non-zero failure result").
    print("[TAMPER REJECTED]" if not vr.valid else "[FAIL: tamper accepted]")
    if vr.earliest_failure_seq:
        print(f"Ledger integrity verification failed at event #{vr.earliest_failure_seq}.")
    print("The modified ledger does not match the expected hash chain.")
    print(f"Verifier findings:      {[f.value for f in vr.findings]}")

    # 8. original preserved
    _original_ok(original, checkpoint, pub)
    return 1 if not vr.valid else 0


def _default_pub():
    key = Path(__file__).resolve().parents[1] / "keys" / "demo_public_key.pem"
    if key.is_file():
        from app.ledger.keys import load_public_key
        return load_public_key(key)
    return None


def _original_ok(original: Path, checkpoint, pub) -> None:
    post = verify_ledger(original, checkpoint=checkpoint, trusted_public_key=pub)
    print()
    print(f"Original ledger:       {'UNMODIFIED' if post.valid else 'MODIFIED?!'} "
          f"(re-verified: {'VALID' if post.valid else 'INVALID'})")


if __name__ == "__main__":
    sys.exit(main())
