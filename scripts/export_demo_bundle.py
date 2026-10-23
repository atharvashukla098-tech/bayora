"""Export a compact, secret-free JSON bundle for the 3D web frontend.

Reads the latest demo run artifacts (ledger.jsonl, observations.jsonl,
audit_report.json) and writes frontend/data/demo_bundle.json — everything
the 3D HUD panels display, nothing they shouldn't (canaries are never
exported; released_text is truncated; no keys, no hostnames).
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / "runs"
OUT = ROOT / "frontend" / "data" / "demo_bundle.json"


def latest_run() -> Path:
    runs = sorted(RUNS.glob("demo-*"))
    if not runs:
        print("no demo runs found", file=sys.stderr)
        sys.exit(1)
    return runs[-1]


def trunc(text: str, n: int = 90) -> str:
    text = (text or "").strip().replace("\n", " ")
    return text if len(text) <= n else text[: n - 1] + "\u2026"


def main() -> None:
    run = latest_run()
    report = json.loads((run / "audit_report.json").read_text(encoding="utf-8"))

    # --- ledger events -> compact event stream ---
    events = []
    for line in (run / "ledger.jsonl").read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        e = json.loads(line)
        events.append(
            {
                "seq": e.get("seq"),
                "event_id": e.get("event_id"),
                "event_type": e.get("event_type"),
                "component": e.get("component"),
                "outcome": e.get("outcome"),
                "scenario_id": e.get("scenario_id"),
                "ts": e.get("ts"),
                "hash": (e.get("hash") or "")[:16],
                "prev_hash": (e.get("prev_hash") or "")[:16],
            }
        )

    # --- observations -> scenario outcomes with policy reasons ---
    obs = []
    for line in (run / "observations.jsonl").read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        o = json.loads(line)
        obs.append(
            {
                "scenario_id": o.get("scenario_id"),
                "outcome": o.get("outcome"),
                "status_code": o.get("status_code"),
                "policy_reason": o.get("policy_reason"),
                "released_text": trunc(o.get("released_text") or ""),
                "event_ids": (o.get("event_ids") or [])[:6],
            }
        )

    # --- assertions + scenario results from the signed report ---
    # assertions is a counts object: {"total": 16, "passed": 16, ...}
    a_counts = report.get("assertions") or {}
    assertions = [
        {
            "assertion_id": step.get("name"),
            "status": step.get("result"),
            "detail": trunc(step.get("evidence") or "", 70),
        }
        for step in (report.get("verification_steps") or [])
    ]

    scen = [
        {
            "scenario_id": s.get("scenario_id"),
            "name": s.get("name"),
            "status": s.get("status"),
            "scene_key": s.get("scene_key"),
            "outcome": s.get("outcome"),
            "skip_reason": s.get("skip_reason"),
            "evidence_event_ids": (s.get("evidence_event_ids") or [])[:6],
            "checks": [
                {
                    "assertion_id": c.get("assertion_id"),
                    "status": c.get("status"),
                    "evidence_event_ids": (c.get("evidence_event_ids") or [])[:3],
                }
                for c in (s.get("checks") or [])
            ],
        }
        for s in (report.get("scenario_results") or [])
    ]

    bundle = {
        "schema_version": "1.0",
        "run_id": report.get("run_id"),
        "exported_at": report.get("exported_at") or report.get("verification_timestamp"),
        "status": report.get("status"),
        "target_mode": report.get("target_mode"),
        "scenario_count": len(scen),
        "assertion_totals": {
            "total": a_counts.get("total"),
            "passed": a_counts.get("passed"),
            "failed": a_counts.get("failed"),
            "errors": a_counts.get("errors"),
            "skipped": a_counts.get("skipped"),
        },
        "verification_steps": assertions,
        "signature": str(report.get("report_signature"))[:24] + "\u2026",
        "events": events,
        "observations": obs,
        "assertions": assertions,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(bundle, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes) from run {run.name}")
    print(
        f"events={len(events)} observations={len(obs)} "
        f"assertions={len(assertions)} scen={len(scen)}"
    )


if __name__ == "__main__":
    main()
