"""Export a static snapshot of the latest run for the 3D site.

The live site reads /api/site/run.json; this script bakes the same bundle
to site/data/run-snapshot.json so the site can also be hosted as pure
static files (GitHub Pages, any static host, or a plain file server) with
no Python process at all.

Usage:
    python scripts/export_site_snapshot.py [--run <run_id>]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.config import load_config          # noqa: E402
from app.site_bundle import (                # noqa: E402
    SiteDataUnavailable,
    build_bundle,
    list_runs,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export the site snapshot")
    parser.add_argument("--run", default=None, help="run id (default: latest)")
    parser.add_argument("--out", default=str(ROOT / "site" / "data" /
                                             "run-snapshot.json"))
    args = parser.parse_args(argv)

    config = load_config(None)
    try:
        bundle = build_bundle(config, run_id=args.run)
    except SiteDataUnavailable as exc:
        print(f"cannot export: {exc}")
        return 1

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n",
                   encoding="utf-8")

    events = len(bundle.get("events") or [])
    height = (bundle.get("integrity") or {}).get("block_height")
    print(f"exported {out}")
    print(f"  run      : {bundle['run']['run_id']}")
    print(f"  events   : {events}")
    print(f"  height   : {height}")
    print(f"  status   : {(bundle.get('summary') or {}).get('report_status')}")

    available = [r["run_id"] for r in list_runs(config)]
    if available:
        print(f"  runs     : {', '.join(available[:6])}"
              + (" …" if len(available) > 6 else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
