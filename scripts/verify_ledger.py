#!/usr/bin/env python
"""CLI: verify a ledger (+ optional checkpoint) — blueprint §13.

Usage:
  python scripts/verify_ledger.py --ledger FILE [--checkpoint FILE]
       [--public-key FILE] [--explain]

Exit codes: 0 valid; 1 invalid; 2 usage/environment error.
``--explain`` prints the canonicalization rules verbatim so a judge can
recompute hashes by hand.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ledger.verifier import verify_ledger
from app.schema import canonical_event_bytes


def _explain() -> None:
    print("CANONICALIZATION RULES (app/schema.py)")
    print("-" * 60)
    print("1. Hash input EXCLUDES the event's own `hash` field.")
    print("2. Hash input INCLUDES prev_hash and every immutable field.")
    print("3. Field order (fixed): schema_version, event_id, seq, ts, run_id,")
    print("   event_type, component, outcome, scenario_id, detail, prev_hash.")
    print("4. detail renders as a nested JSON object with keys SORTED (D24),")
    print("   or the literal null when absent.")
    print("5. separators=(',',':')  — no spaces; ensure_ascii=False; UTF-8.")
    print("6. event hash = sha256(canonical bytes) lowercase hex (64 chars).")
    print("7. Optional fields serialize as null, never omitted.")
    print("8. Example recomputation:")
    print("   python -c \"from app.schema import *; "
          "import json; ev=json.loads(open(LEDGER).readline()); ...\"")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Verify a Bayora ledger")
    parser.add_argument("--ledger", required=True)
    parser.add_argument("--checkpoint")
    parser.add_argument("--public-key")
    parser.add_argument("--explain", action="store_true")
    args = parser.parse_args(argv)

    if args.explain:
        _explain()

    ledger_path = Path(args.ledger)
    if not ledger_path.is_file():
        print(f"ERROR: ledger not found: {ledger_path}")
        return 2

    checkpoint = None
    pub = None
    if args.checkpoint:
        from app.ledger.checkpoints import Checkpoint
        cp_path = Path(args.checkpoint)
        if not cp_path.is_file():
            print(f"ERROR: checkpoint not found: {cp_path}")
            return 2
        checkpoint = Checkpoint.model_validate_json(cp_path.read_text().strip())
    if args.public_key:
        from app.ledger.keys import load_public_key
        pub = load_public_key(Path(args.public_key))
    elif checkpoint is not None:
        # fall back to the trusted dev public key next to the project
        default_key = Path(__file__).resolve().parents[1] / "keys" / "demo_public_key.pem"
        if default_key.is_file():
            from app.ledger.keys import load_public_key
            pub = load_public_key(default_key)

    vr = verify_ledger(ledger_path, checkpoint=checkpoint, trusted_public_key=pub)

    print(f"ledger:            {ledger_path}")
    print(f"checked_height:    {vr.checked_height}")
    print(f"valid:             {str(vr.valid).upper()}")
    print(f"findings:          {[f.value for f in vr.findings] or 'none'}")
    print(f"earliest_failure:  {vr.earliest_failure_seq}")
    print(f"coverage:          {vr.checkpoint_coverage}")
    if checkpoint is None:
        print("truncation check:  NOT POSSIBLE (no trusted checkpoint supplied)")
    else:
        print(f"checkpoint_seq:    {checkpoint.checkpoint_seq}")
    return 0 if vr.valid else 1


if __name__ == "__main__":
    sys.exit(main())
