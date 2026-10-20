#!/usr/bin/env python
"""Generate the dev Ed25519 keypair into keys/ (gitignored).

Usage: python scripts/gen_keys.py [--force]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ledger.keys import load_or_generate_keypair, fingerprint


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--key-dir", default="keys")
    parser.add_argument("--force", action="store_true",
                        help="overwrite any existing keypair")
    args = parser.parse_args(argv)

    key_dir = Path(args.key_dir)
    priv = key_dir / "demo_signing_key.pem"
    if priv.is_file() and not args.force:
        print(f"keypair already exists at {key_dir} (use --force to rotate)")
    else:
        if args.force and priv.exists():
            priv.unlink()
        load_or_generate_keypair(key_dir)
        print(f"keypair generated at {key_dir}")
    _, key_id, pub = load_or_generate_keypair(key_dir)
    print(f"key_id:      {key_id}")
    print(f"fingerprint: {fingerprint(pub)}")
    print("NOTE: a regenerated key invalidates old signatures (limitation L4).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
