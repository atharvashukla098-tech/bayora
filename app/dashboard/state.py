"""Dashboard state loaders — read-only, never fabricated (blueprint §11.1)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.config import BayoraConfig
from app.ledger.verifier import verify_ledger
from app.schema import EventRecord, Outcome


class HealthSnapshot(dict):
    """Keys: status, detail (mode-aware, D19)."""


class LedgerIntegrity(dict):
    """Keys: block_height, head_hash, verification, stale, as_of_height,
    checkpoint_status, checkpoint_coverage, last_verified_at."""


class MatrixRow(dict):
    """Keys: attack_vector, scenario_id, control, detection, action, result,
    evidence, skip_reason."""


class Incident(dict):
    """Keys: scenario_id, outcome, ts, event_id, run_id, reason."""


class DashboardState:
    """All data originates from run artifacts or live probes — no literals."""

    def __init__(self, config: BayoraConfig, run_id: Optional[str] = None):
        self.config = config
        self.runs_dir = Path(config.ledger.runs_dir)
        self.run_id = run_id or self._latest_run()

    def _latest_run(self) -> Optional[str]:
        pointer = self.runs_dir / "latest_demo_run"
        if pointer.is_file():
            txt = pointer.read_text(encoding="utf-8").strip()
            return txt or None
        states = sorted(self.runs_dir.glob("*/state.json"))
        return states[-1].parent.name if states else None

    # -- section 1: system state -------------------------------------------

    def broker_health(self) -> HealthSnapshot:
        """MODE-AWARE (D19): in-process mode derives status from live
        artifacts — never a fabricated UP/DOWN. HTTP mode would probe
        GET /healthz with a 1.5s timeout (Docker deployments)."""
        run_dir = self.runs_dir / str(self.run_id) if self.run_id else None
        state_path = run_dir / "state.json" if run_dir else None
        if state_path is None or not state_path.is_file():
            return HealthSnapshot(status="NOT_STARTED",
                                  detail="no HTTP server (in-process mode); no run dir")
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except Exception:
            return HealthSnapshot(status="DISCONNECTED",
                                  detail="state.json unreadable")
        ledger_path = run_dir / "ledger.jsonl"
        if ledger_path.is_file():
            age_s = self._age_seconds(ledger_path)
            if state.get("status") == "in_progress" and age_s is not None and age_s <= 30:
                return HealthSnapshot(status="ACTIVE", detail="in-process mode; run in progress")
            if state.get("status") in ("complete", "failed"):
                return HealthSnapshot(status="IDLE", detail="in-process mode; run finished")
            return HealthSnapshot(status="IDLE", detail="in-process mode")
        return HealthSnapshot(status="IDLE", detail="in-process mode; no events yet")

    @staticmethod
    def _age_seconds(path: Path) -> Optional[float]:
        try:
            mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
            return (datetime.now(timezone.utc) - mtime).total_seconds()
        except OSError:
            return None

    def target_mode(self) -> str:
        return self.config.target_mode

    def current_run(self) -> Optional[str]:
        return self.run_id

    def runtime_status(self) -> str:
        """TESTED / SKIPPED (Docker unavailable) / UNTESTED — from the last
        run's runtime rows, never from compose.yaml existence (spec §4.3)."""
        if not self.run_id:
            return "UNTESTED"
        rt = self.runs_dir / self.run_id / "runtime_tests.json"
        if rt.is_file():
            return "TESTED"
        demo = self.runs_dir / self.run_id / "demo_result.json"
        if demo.is_file():
            data = json.loads(demo.read_text(encoding="utf-8"))
            for entry in data.get("scenes", []):
                if entry.get("scene") == "runtime" and entry.get("status") == "SKIPPED":
                    return "SKIPPED (Docker unavailable)"
        return "UNTESTED"

    # -- section 2: live stream ---------------------------------------------

    def latest_events(self, n: int = 50) -> list[EventRecord]:
        """Tail of the current run's ledger (bounded, spec §5)."""
        if not self.run_id:
            return []
        ledger_path = self.runs_dir / self.run_id / "ledger.jsonl"
        if not ledger_path.is_file():
            return []
        lines = ledger_path.read_text(encoding="utf-8").splitlines()
        out: list[EventRecord] = []
        for line in lines[-n:]:
            if not line.strip():
                continue
            try:
                out.append(EventRecord.model_validate_json(line))
            except Exception:
                continue
        return out

    def event_source_alive(self) -> tuple[bool, str]:
        """(alive, label): IDLE vs DISCONNECTED are distinct states.

        DISCONNECTED — the run dir does not exist or is unreadable.
        IDLE         — the run exists but its ledger has no events yet.
        """
        if not self.run_id:
            return False, "DISCONNECTED — event source not found"
        run_dir = self.runs_dir / self.run_id
        if not run_dir.is_dir():
            return False, "DISCONNECTED — event source not found"
        ledger_path = run_dir / "ledger.jsonl"
        if not ledger_path.is_file() or not ledger_path.stat().st_size:
            return True, f"IDLE — no events yet in run {self.run_id}"
        return True, "LIVE"

    # -- section 3: incidents -------------------------------------------------

    def active_incidents(self) -> list[Incident]:
        out = []
        for ev in self.latest_events():
            if ev.outcome is not None and ev.outcome in (
                    Outcome.DETECTED, Outcome.BLOCKED,
                    Outcome.REDACTED, Outcome.ERROR):
                out.append(Incident(
                    scenario_id=ev.scenario_id or "-",
                    outcome=ev.outcome.value, ts=ev.ts, event_id=ev.event_id,
                    run_id=ev.run_id or "-",
                    reason=(ev.detail or {}).get("reason", "-")))
        return out

    # -- section 4: matrix -------------------------------------------------

    def matrix(self) -> list[MatrixRow]:
        from app.harness.scenarios import build_catalogue
        rows: list[MatrixRow] = []
        status_by_scenario: dict[str, dict] = {}
        if self.run_id:
            demo = self.runs_dir / self.run_id / "demo_result.json"
            if demo.is_file():
                data = json.loads(demo.read_text(encoding="utf-8"))
                for entry in data.get("scenes", []):
                    sid = entry.get("scenario_id")
                    if sid:
                        status_by_scenario[sid] = entry
        for spec in build_catalogue():
            entry = status_by_scenario.get(spec.scenario_id, {})
            rows.append(MatrixRow(
                attack_vector=spec.attack_vector,
                scenario_id=spec.scenario_id,
                control=spec.control_under_test,
                detection=spec.detection_mechanism,
                action=entry.get("outcome", "not run"),
                result=entry.get("status", "NOT_EVALUATED"),
                evidence=(entry.get("event_ids")
                          or entry.get("checks", [{}])[0].get("evidence_event_ids", [])
                          if entry else []),
                skip_reason=entry.get("skip_reason"),
            ))
        return rows

    def passed_denominator(self) -> tuple[int, int]:
        """(passed, applicable) — every summary metric shows its denominator."""
        rows = self.matrix()
        statuses = [r.get("result") for r in rows if r.get("result") not in (None, "not run", "NOT_EVALUATED")]
        applicable = [s for s in statuses
                     if s not in ("SKIPPED", "NOT_EVALUATED")]
        passed = sum(1 for s in applicable if s == "PASS")
        return passed, len(applicable)

    # -- section 5: ledger integrity ----------------------------------------

    def ledger_integrity(self) -> LedgerIntegrity:
        """STALE logic (D8): a verification record is honored only if
        checked_height == block_height at display time."""
        if not self.run_id:
            return LedgerIntegrity(block_height=0, head_hash=None,
                                  verification="NOT RUN", stale=False,
                                  as_of_height=None,
                                  checkpoint_status="ABSENT",
                                  checkpoint_coverage="none",
                                  last_verified_at=None)
        run_dir = self.runs_dir / self.run_id
        ledger_path = run_dir / "ledger.jsonl"
        from app.ledger.chain import Ledger as _Ledger
        from app.clock import SystemClock
        height = 0
        head_hash = None
        if ledger_path.is_file():
            lines = [l for l in ledger_path.read_text(encoding="utf-8").splitlines() if l.strip()]
            height = len(lines)
            if lines:
                head_hash = EventRecord.model_validate_json(lines[-1]).hash
        # latest verification record
        verification = "NOT RUN"
        checked_height = None
        last_verified_at = None
        ver_path = run_dir / "verifications.jsonl"
        if ver_path.is_file():
            recs = [json.loads(l) for l in ver_path.read_text(encoding="utf-8").splitlines() if l.strip()]
            if recs:
                last = recs[-1]
                checked_height = last.get("checked_height")
                last_verified_at = last.get("checked_at")
                verification = "VALID" if last.get("valid") else "INVALID"
        stale = (checked_height is not None and height != 0
                 and checked_height != height)
        if stale:
            verification = "STALE (chain grew since last verification)"

        cp_status = "ABSENT"
        cp_coverage = "none"
        from app.ledger.checkpoints import load_checkpoint, verify_checkpoint
        cp = load_checkpoint(run_dir)
        if cp is not None:
            pub_path = Path(self.config.report.key_dir) / "demo_public_key.pem"
            pub = None
            if pub_path.is_file():
                from app.ledger.keys import load_public_key
                pub = load_public_key(pub_path)
            cp_status = ("VALID" if verify_checkpoint(cp, pub)
                         else f"INVALID (key={cp.key_id})")
            if cp_status.startswith("VALID"):
                cp_status = f"VALID (key {cp.key_id})"
            cp_coverage = ("full" if cp.checkpoint_seq >= height else "prefix")

        return LedgerIntegrity(
            block_height=height, head_hash=head_hash,
            verification=verification, stale=stale,
            as_of_height=checked_height,
            checkpoint_status=cp_status,
            checkpoint_coverage=cp_coverage,
            last_verified_at=last_verified_at)

    # -- section 6: reports and history ---------------------------------------

    def run_history(self) -> list[dict]:
        out = []
        if not self.runs_dir.is_dir():
            return out
        for entry in sorted(self.runs_dir.iterdir()):
            if not entry.is_dir():
                continue
            state_path = entry / "state.json"
            report_path = entry / "audit_report.json"
            if not state_path.is_file():
                continue
            try:
                state = json.loads(state_path.read_text(encoding="utf-8"))
            except Exception:
                continue
            report_status = None
            if report_path.is_file():
                try:
                    report_status = json.loads(
                        report_path.read_text(encoding="utf-8")).get("status")
                except Exception:
                    report_status = None
            out.append({
                "run_id": entry.name,
                "status": state.get("status"),
                "started_at": state.get("started_at"),
                "assertions": state.get("assertions"),
                "report_status": report_status,
                "report_path": str(report_path) if report_path.is_file() else None,
            })
        return out
