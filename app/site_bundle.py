"""Read-only evidence bundle for the public 3D site.

Everything the site shows is derived here from run artifacts on disk:
ledger events, the evaluation matrix, the signed attestation report, the
signed checkpoint, live ledger integrity, and the run summary.

Two rules hold everywhere in this module:

* **Never fabricate** — a missing artifact is reported as missing, not
  filled with a plausible value.
* **Never leak** — the whole bundle passes through the dashboard
  redaction helper, so synthetic canary values and obvious secrets cannot
  reach a browser.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from app.config import BayoraConfig
from app.dashboard.models import redact_obj
from app.dashboard.state import DashboardState


class SiteDataUnavailable(Exception):
    """No run artifacts are available to publish."""


def _run_dir(config: BayoraConfig, run_id: str) -> Path:
    return Path(config.ledger.runs_dir) / run_id


def list_runs(config: BayoraConfig) -> list[dict[str, Any]]:
    """Runs available for the site's run switcher (newest first)."""
    state = DashboardState(config)
    runs: list[dict[str, Any]] = []
    for entry in state.run_history():
        runs.append({
            "run_id": entry.get("run_id"),
            "status": entry.get("status"),
            "started_at": entry.get("started_at"),
            "report_status": entry.get("report_status"),
        })
    runs.reverse()
    return runs


def _events(config: BayoraConfig, state: DashboardState) -> list[dict[str, Any]]:
    """Ledger tail as compact records (hash links included)."""
    if not state.run_id:
        return []
    ledger = _run_dir(config, state.run_id) / "ledger.jsonl"
    if not ledger.is_file():
        return []
    out: list[dict[str, Any]] = []
    for line in ledger.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        out.append({
            "seq": rec.get("seq"),
            "ts": rec.get("ts"),
            "run_id": rec.get("run_id"),
            "event_type": rec.get("event_type"),
            "component": rec.get("component"),
            "outcome": rec.get("outcome"),
            "scenario_id": rec.get("scenario_id"),
            "hash": rec.get("hash"),
            "prev_hash": rec.get("prev_hash"),
        })
    return out


def _checkpoint(config: BayoraConfig, state: DashboardState) -> dict[str, Any] | None:
    if not state.run_id:
        return None
    run_dir = _run_dir(config, state.run_id)
    try:
        from app.ledger.checkpoints import load_checkpoint, verify_checkpoint
    except Exception:
        return None
    try:
        cp = load_checkpoint(run_dir)
    except Exception:
        return None
    if cp is None:
        return None
    signature_valid: bool | None = None
    pub_path = Path(config.report.key_dir) / "demo_public_key.pem"
    if pub_path.is_file():
        try:
            from app.ledger.keys import load_public_key
            signature_valid = bool(verify_checkpoint(cp, load_public_key(pub_path)))
        except Exception:
            signature_valid = None
    return {
        "checkpoint_seq": cp.checkpoint_seq,
        "final_event_hash": cp.final_event_hash,
        "key_id": cp.key_id,
        "created_at": cp.created_at,
        "signature_valid": signature_valid,
    }


def _report(config: BayoraConfig, state: DashboardState) -> dict[str, Any] | None:
    if not state.run_id:
        return None
    path = _run_dir(config, state.run_id) / "audit_report.json"
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def build_bundle(config: BayoraConfig,
                 run_id: Optional[str] = None) -> dict[str, Any]:
    """Assemble the site's evidence bundle for one run."""
    state = DashboardState(config, run_id=run_id)
    if not state.run_id:
        raise SiteDataUnavailable("no run artifacts found")

    report = _report(config, state)
    integrity = dict(state.ledger_integrity())
    matrix = [
        {
            "scenario_id": row.get("scenario_id"),
            "attack_vector": row.get("attack_vector"),
            "control": row.get("control"),
            "detection": row.get("detection"),
            "action": row.get("action"),
            "result": row.get("result"),
            "evidence": list(row.get("evidence") or []),
            "skip_reason": row.get("skip_reason"),
        }
        for row in state.matrix()
    ]

    state_file = _run_dir(config, state.run_id) / "state.json"
    run_state: dict[str, Any] = {}
    if state_file.is_file():
        try:
            run_state = json.loads(state_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            run_state = {}

    assertions = run_state.get("assertions") or {}
    summary = {
        "total": assertions.get("total", 0),
        "passed": assertions.get("passed", 0),
        "failed": assertions.get("failed", 0),
        "errors": assertions.get("errors", 0),
        "skipped": assertions.get("skipped", 0),
        "not_evaluated": assertions.get("not_evaluated", 0),
        "report_status": (report or {}).get("status"),
    }

    health = state.broker_health()
    bundle = {
        "run": {
            "run_id": state.run_id,
            "started_at": run_state.get("started_at"),
            "status": run_state.get("status"),
            "target_mode": state.target_mode(),
            "broker_status": health.get("status"),
            "runtime_status": state.runtime_status(),
            "offline": True,
            "docker_available": ((report or {}).get("environment") or {})
                                .get("docker_available"),
        },
        "events": _events(config, state),
        "matrix": matrix,
        "report": report,
        "checkpoint": _checkpoint(config, state),
        "integrity": {
            "block_height": integrity.get("block_height"),
            "verification": integrity.get("verification"),
            "stale": integrity.get("stale"),
            "as_of_height": integrity.get("as_of_height"),
            "checkpoint_status": integrity.get("checkpoint_status"),
            "checkpoint_coverage": integrity.get("checkpoint_coverage"),
            "head_hash": integrity.get("head_hash"),
        },
        "summary": summary,
    }
    # defense in depth: nothing sensitive can reach a browser
    return redact_obj(bundle)
