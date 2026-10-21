"""Artifact-backed dashboard client — same interface the dossier UI
components consume, fed entirely by run artifacts on disk and the
existing :class:`app.dashboard.state.DashboardState` loaders.

No HTTP server, no new attack surface: every value comes from
``runs/<run_id>/`` artifacts (ledger.jsonl, state.json, demo_result.json,
audit_report.json, verifications.jsonl, runtime_tests.json) or from
subprocess executions of the already-tested scripts
(``run_demo_pipeline.py``, ``tamper_demo.py``).

Honesty contract: when artifacts are absent or unreadable every method
raises :class:`BackendUnavailable` so the UI renders its disconnected /
NOT_EVALUATED states — never fabricated data.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Optional

from app import __version__
from app.config import BayoraConfig
from app.dashboard.models import (
    ContainmentControl,
    Event,
    Health,
    MatrixRow,
    normalize_result,
    TamperDemoResult,
)
from app.dashboard.state import DashboardState

ROOT = Path(__file__).resolve().parents[2]

# Ledger event type -> stream channel label (spec §5 presentation).
COMPONENT_LABELS: dict[str, str] = {
    "request.ingress": "INGRESS",
    "policy.decision": "BROKER-POLICY",
    "target.response": "TARGET",
    "response.released": "BROKER-POLICY",
    "ledger.committed": "AUDIT-LEDGER",
    "checkpoint.signed": "AUDIT-LEDGER",
    "verification.performed": "VERIFIER",
    "incident.raised": "BROKER-POLICY",
    "rejections.summary": "BROKER-POLICY",
    "run.started": "HARNESS",
    "run.completed": "HARNESS",
    "assertion.recorded": "HARNESS",
}

MESSAGES: dict[str, str] = {
    "run.started": "Run started",
    "run.completed": "Run completed",
    "request.ingress": "Adversarial request received",
    "policy.decision": "Policy decision recorded",
    "target.response": "Target response observed",
    "response.released": "Response released",
    "assertion.recorded": "Assertion recorded",
    "ledger.committed": "Event committed",
    "rejections.summary": "Rejections summary",
    "verification.performed": "Integrity check completed",
    "checkpoint.signed": "Checkpoint signed",
    "incident.raised": "Incident raised",
}

# Scenario -> pipeline scene (scripts/run_demo_pipeline.py --scene).
SCENE_FOR_SCENARIO: dict[str, str] = {
    "SC-01": "attack", "SC-01b": "attack", "SC-02": "attack",
    "SC-03": "containment", "SC-04": "containment",
    "SC-05": "tamper", "SC-05b": "tamper", "SC-05c": "tamper",
    "SC-05d": "tamper",
    "SC-06": "attack", "SC-07": "tamper", "SC-08": "attack",
    "SC-03r": "runtime", "SC-04r": "runtime",
}


class BackendUnavailable(Exception):
    """Run artifacts could not be reached or parsed."""


def _map_event(rec: Any) -> Event:
    et = rec.event_type.value if hasattr(rec.event_type, "value") else str(rec.event_type)
    detail = dict(rec.detail or {})
    block = detail.pop("block", None)
    if rec.scenario_id:
        detail.setdefault("scenario_id", rec.scenario_id)
    return Event(
        seq=rec.seq,
        ts_utc=rec.ts,
        run_id=rec.run_id,
        component=COMPONENT_LABELS.get(et, et.upper()),
        event_type=et,
        status=rec.outcome.value if rec.outcome else "",
        message=MESSAGES.get(et, et),
        block=block,
        hash=rec.hash,
        details=detail,
    )


class ArtifactClient:
    """Drop-in replacement for the HTTP client the dashboard was drafted
    against. Same methods, same failure mode, artifacts instead of HTTP."""

    def __init__(self, config: BayoraConfig, run_id: Optional[str] = None):
        self.config = config
        self.runs_dir = Path(config.ledger.runs_dir)
        self.state = DashboardState(config, run_id=run_id)

    # -- health -----------------------------------------------------------

    def health(self) -> Health:
        if not self.runs_dir.is_dir():
            raise BackendUnavailable(f"runs dir not found: {self.runs_dir}")
        docker: bool | None = None
        offline: bool | None = True
        report = self._report_dict(required=False)
        if report:
            env = report.get("environment") or {}
            if env.get("docker_available") is not None:
                docker = bool(env.get("docker_available"))
            if env.get("offline_mode") is not None:
                offline = bool(env.get("offline_mode"))
        return Health(
            backend=True,
            target_mode=self.state.target_mode(),
            offline_mode=offline,
            docker_available=docker,
            platform_version=__version__,
        )

    # -- events -----------------------------------------------------------

    def events(self, since_seq: int = 0, run_id: Optional[str] = None) -> list[Event]:
        alive, label = self.state.event_source_alive()
        if not alive:
            raise BackendUnavailable(label)
        records = self.state.latest_events(400)
        out = [_map_event(r) for r in records if r.seq > since_seq]
        if run_id:
            out = [e for e in out if e.run_id == run_id]
        return out

    # -- evaluation matrix ------------------------------------------------

    def results(self, run_id: Optional[str] = None) -> list[MatrixRow]:
        if not self.state.run_id:
            raise BackendUnavailable("no runs recorded yet")
        rows: list[MatrixRow] = []
        for r in self.state.matrix():
            action = r.get("action") or ""
            detail: dict[str, Any] = {}
            if r.get("skip_reason"):
                detail["skip_reason"] = r["skip_reason"]
            if r.get("control"):
                detail["control_under_test"] = r["control"]
            rows.append(MatrixRow(
                scenario_id=r["scenario_id"],
                attack_vector=r["attack_vector"],
                layer=r.get("control") or "",
                mechanism=r.get("detection") or "",
                action_taken=("No result reported" if action in ("", "not run")
                              else action),
                evidence=list(r.get("evidence") or []),
                result=normalize_result(r.get("result")),
                evidence_detail=detail,
            ))
        return rows

    # -- pipeline dispatch -------------------------------------------------

    def trigger_run(self, run_id: str, scenario_id: str) -> dict[str, Any]:
        scene = SCENE_FOR_SCENARIO.get(scenario_id, "attack")
        proc = self._run_script(
            "scripts/run_demo_pipeline.py",
            "--scene", scene,
            "--run-id", run_id,
            timeout=300,
        )
        if proc.returncode != 0:
            tail = (proc.stderr or proc.stdout or "").strip().splitlines()
            raise BackendUnavailable(
                f"scene {scene} failed (rc={proc.returncode}): "
                f"{tail[-1] if tail else 'no output'}")
        return {"run_id": run_id, "scenario_id": scenario_id,
                "scene": scene, "accepted": True,
                "returncode": proc.returncode}

    # -- tamper demo (real script, disposable copy) -------------------------

    def tamper_demo(self) -> TamperDemoResult:
        run_id = self.state.run_id
        if not run_id:
            raise BackendUnavailable("no run selected")
        ledger = self.runs_dir / run_id / "ledger.jsonl"
        if not ledger.is_file():
            raise BackendUnavailable(f"no ledger for run {run_id}")
        proc = self._run_script(
            "scripts/tamper_demo.py",
            "--ledger", str(ledger),
            "--mode", "byte",
            "--event", "3",
            timeout=120,
        )
        out = proc.stdout or ""

        def _search(pattern: str, group: int = 1, cast=str):
            m = re.search(pattern, out)
            return cast(m.group(group)) if m else None

        pre_status = _search(r"Original ledger:\s+(\w+)")
        return TamperDemoResult(
            original_ledger_status=pre_status or "UNKNOWN",
            copy_created="Disposable copy:" in out,
            modified_event=_search(r"Modified event:\s*#(\d+)", cast=int),
            expected_hash=_search(r"Expected hash:\s+(\w+)"),
            computed_hash=_search(r"Computed hash:\s+(\w+)"),
            earliest_failure=_search(r"failed at event #(\d+)"),
            verifier_returncode=proc.returncode,
            original_unmodified="UNMODIFIED" in out,
            output=out,
        )

    # -- signed attestation --------------------------------------------------

    def report(self) -> dict[str, Any]:
        return self._report_dict(required=True)

    def _report_dict(self, required: bool) -> dict[str, Any] | None:
        run_id = self.state.run_id
        path = (self.runs_dir / run_id / "audit_report.json"
                if run_id else None)
        if path is None or not path.is_file():
            if required:
                raise BackendUnavailable("no audit report for the current run")
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            if required:
                raise BackendUnavailable(f"audit report unreadable: {exc}") from exc
            return None
        return data if isinstance(data, dict) else None

    # -- live ledger integrity (state.py STALE-aware) -----------------------

    def integrity(self) -> dict[str, Any]:
        return dict(self.state.ledger_integrity())

    def incidents(self) -> list[dict[str, Any]]:
        return [dict(i) for i in self.state.active_incidents()]

    # -- containment (derived from executed scenario results only) -----------

    def containment(self) -> list[ContainmentControl]:
        if not self.state.run_id:
            raise BackendUnavailable("no run selected")
        rows = {r.scenario_id: r for r in self.results()}
        integ = self.integrity()

        def state_for(*sids: str) -> tuple[str, str]:
            parts = []
            for sid in sids:
                row = rows.get(sid)
                if row is None:
                    continue
                res = row.result.value
                if res == "NOT_EVALUATED":
                    continue
                skip = (row.evidence_detail or {}).get("skip_reason")
                parts.append(f"{sid}: {res}" + (f" ({skip})" if skip else ""))
            if not parts:
                return "NOT_EVALUATED", "no executed assertion for this control"
            joined = "; ".join(parts)
            worst = "SKIPPED"
            states = [p.split(": ")[1].split(" ")[0] for p in parts]
            if "FAIL" in states:
                worst = "FAIL"
            elif "ERROR" in states:
                worst = "ERROR"
            elif all(s == "PASS" for s in states):
                worst = "VERIFIED"
            return worst, joined

        controls: list[ContainmentControl] = []
        for cid, name, sids in [
            ("request-validation", "Broker request validation (schema)",
             ("SC-06",)),
            ("injection-policy", "Injection policy (forward mode)", ("SC-01",)),
            ("injection-block", "Injection policy (block mode)", ("SC-01b",)),
            ("canary-redaction", "Response canary redaction", ("SC-02",)),
            ("network-app", "Unauthorized network (application layer)",
             ("SC-03",)),
            ("network-runtime", "Runtime network restrictions", ("SC-03r",)),
            ("fs-app", "Protected-path write policy (application)",
             ("SC-04",)),
            ("fs-runtime", "Read-only filesystem (runtime)", ("SC-04r",)),
            ("ledger-modification", "Ledger modification detection",
             ("SC-05",)),
            ("ledger-truncation", "Ledger truncation vs checkpoint",
             ("SC-05b",)),
            ("checkpoint-sig", "Checkpoint signature (Ed25519)", ("SC-07",)),
        ]:
            state, evidence = state_for(*sids)
            controls.append(ContainmentControl(
                control_id=cid, name=name, state=state, evidence=evidence))

        verification = str(integ.get("verification", "NOT RUN"))
        if verification == "VALID":
            iv_state, iv_ev = "VERIFIED", (
                f"chain verified at height {integ.get('as_of_height')}")
        elif verification.startswith("STALE"):
            iv_state, iv_ev = "NOT_EVALUATED", (
                "last verification is stale — chain grew since; re-verify")
        elif verification == "INVALID":
            iv_state, iv_ev = "FAIL", "verifier reported an invalid chain"
        else:
            iv_state, iv_ev = "NOT_EVALUATED", "chain verification not run"
        controls.append(ContainmentControl(
            control_id="ledger-integrity", name="Ledger hash-chain integrity",
            state=iv_state, evidence=iv_ev))

        cp_status = str(integ.get("checkpoint_status", "ABSENT"))
        if cp_status.startswith("VALID"):
            cp_state, cp_ev = "VERIFIED", cp_status
        elif cp_status.startswith("INVALID"):
            cp_state, cp_ev = "FAIL", cp_status
        else:
            cp_state, cp_ev = "SKIPPED", "no checkpoint present for this run"
        controls.append(ContainmentControl(
            control_id="checkpoint", name="Signed checkpoint present",
            state=cp_state, evidence=cp_ev))
        return controls

    # -- helpers -------------------------------------------------------------

    def _run_script(self, relative: str, *args: str,
                    timeout: int) -> subprocess.CompletedProcess:
        env = dict(os.environ)
        env["PYTHONPATH"] = str(ROOT) + os.pathsep + env.get("PYTHONPATH", "")
        env["BAYORA_RUNS_DIR"] = str(self.runs_dir)
        return subprocess.run(
            [sys.executable, str(ROOT / relative), *args],
            cwd=str(ROOT), env=env, capture_output=True, text=True,
            timeout=timeout,
        )
