#!/usr/bin/env python
"""Remove runs/demo-*/ and reports — --confirm required (blueprint §13)."""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm", action="store_true")
    parser.add_argument("--runs-dir", default="runs")
    args = parser.parse_args(argv)

    if not args.confirm:
        print("refusing to reset without --confirm")
        return 2

    runs = Path(args.runs_dir)
    removed = 0
    if runs.is_dir():
        for entry in runs.iterdir():
            # demo-/run- dirs are run evidence; 'platform' is the Docker-mode
            # broker's own ledger dir — both are disposable run artifacts.
            if entry.is_dir() and (entry.name.startswith("demo-")
                                   or entry.name.startswith("run-")
                                   or entry.name == "platform"):
                shutil.rmtree(entry, ignore_errors=True)
                removed += 1
            elif entry.is_file() and entry.name == "current_demo_run":
                entry.unlink()
        pointer = runs / "latest_demo_run"
        if pointer.exists():
            pointer.unlink()
    print(f"reset complete: {removed} run dir(s) removed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
