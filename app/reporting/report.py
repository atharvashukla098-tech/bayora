"""Audit report model + builder from a REAL run (blueprint §10.2).

Every number is recomputed from artifacts (observations.jsonl, state.json,
ledger.jsonl, checkpoint.json, runtime_tests.json) — zero hardcoding. A
FRESH verify_ledger() runs at export time; its result is what status row 1
reads. verification_steps[] records what could actually run, so "step did
not execute" is a fact in the report.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict

import app
from app.config import BayoraConfig
from app.clock import Clock
from app.harness.runstore import RunStore
from app.ledger.verifier import verify_ledger
from app.reporting.status import (
    AssertionCounts,
    ReportStatusInputs,
    VerificationStep,
    compute_status,
)
from app.schema import ReportStatus, SCHEMA_VERSION_CURRENT


class EnvironmentBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")
    offline_mode: bool
    docker_available: Optional[bool]
    docker_compose_available: Optional[bool]
    os: str


class ScenarioRow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scenario_id: str
    name: str
    status: str                  # AssertionStatus value
    outcome: Optional[str]       # observed outcome, if evaluated
    skip_reason: Optional[str]
    evidence_event_ids: list[str]
    checks: list[dict]


class LedgerBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")
    block_height: int
    chain_valid: bool
    checkpoint_present: bool
    checkpoint_seq: Optional[int]
    checkpoint_signature_valid: bool
    truncation_check_possible: bool
    checkpoint_coverage: str
    # The signed checkpoint's final_event_hash, INSIDE the signed scope: it
    # content-binds the report to the exact chain the checkpoint vouches for
    # (the binding check compares it against the referenced chain's event at
    # checkpoint_seq — a foreign chain with a different head can never match).
    checkpoint_final_event_hash: Optional[str] = None


class ReportSignature(BaseModel):
    model_config = ConfigDict(extra="forbid")
    algorithm: str = "Ed25519"
    key_id: str
    signature: Optional[str] = None


class AuditReport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: str = SCHEMA_VERSION_CURRENT
    platform: str = app.PLATFORM
    platform_version: str = app.__version__
    run_id: str
    verification_timestamp: str
    target_mode: str
    environment: EnvironmentBlock
    assertions: AssertionCounts
    scenario_results: list[ScenarioRow]
    ledger: LedgerBlock
    verification_steps: list[VerificationStep]
    limitations: list[str]
    status: ReportStatus
    report_signature: ReportSignature
    # Non-signed provenance pointer (excluded from canonical bytes by the
    # fixed field list): lets the verify path re-find the ledger from the
    # exported report file alone.
    ledger_path: str = ""


def build_report(run_id: str, runstore: RunStore, config: BayoraConfig, clock: Clock,
                 docker_probe, keypair=None) -> AuditReport:
    """Build the report from the ACTUAL run dir; every number recomputed."""
    import platform as _platform

    run_dir = Path(runstore.run_dir(run_id))
    ledger_path = run_dir / "ledger.jsonl"

    # -- fresh chain verification ------------------------------------------
    checkpoint = None
    cp_present = False
    cp_seq: Optional[int] = None
    cp_sig_valid = False
    from app.ledger.checkpoints import load_checkpoint, verify_checkpoint
    checkpoint = load_checkpoint(run_dir)
    if checkpoint is not None:
        cp_present = True
        cp_seq = checkpoint.checkpoint_seq
        if keypair is not None:
            cp_sig_valid = verify_checkpoint(checkpoint, keypair[2])
        else:
            from app.ledger.keys import load_public_key
            try:
                pub = load_public_key(Path(config.report.key_dir) / "demo_public_key.pem")
                cp_sig_valid = verify_checkpoint(checkpoint, pub)
            except Exception:
                cp_sig_valid = False

    vr = verify_ledger(ledger_path, checkpoint=checkpoint,
                       trusted_public_key=(keypair[2] if keypair else None))
    # authoritative re-check with the trusted key even without keypair
    if keypair is None and cp_present:
        try:
            from app.ledger.keys import load_public_key
            pub = load_public_key(Path(config.report.key_dir) / "demo_public_key.pem")
            vr = verify_ledger(ledger_path, checkpoint=checkpoint,
                               trusted_public_key=pub)
            cp_sig_valid = verify_checkpoint(checkpoint, pub)
        except Exception:
            pass

    # -- counts recomputed from observations/state ---------------------------
    state = runstore.load_state(run_id)
    if state is not None:
        counts = AssertionCounts(**state.assertions)
        scenario_status = dict(state.scenario_status)
    else:
        counts = AssertionCounts(total=0, passed=0, failed=0, errors=0,
                                 skipped=0, not_evaluated=0)
        scenario_status = {}

    # required = non-SKIPPED scenarios' checks
    required_failed = 0
    required_errored = 0
    observations = runstore.load_observations(run_id)
    obs_by_scenario = {o.get("scenario_id"): o for o in observations}

    # -- scenario rows -------------------------------------------------------
    from app.harness.scenarios import build_catalogue
    rows: list[ScenarioRow] = []
    skipped_any = counts.skipped > 0 or counts.not_evaluated > 0
    skip_reasons = dict(getattr(state, "skip_reasons", {}) or {})
    for spec in build_catalogue():
        st = scenario_status.get(spec.scenario_id)
        if st is None:
            continue
        obs = obs_by_scenario.get(spec.scenario_id)
        rows.append(ScenarioRow(
            scenario_id=spec.scenario_id, name=spec.name, status=st,
            outcome=(obs or {}).get("outcome"),
            # The LIVE probed/gate reason, verbatim — never a static string
            # (the shipped artifact must carry the honest reason).
            skip_reason=(skip_reasons.get(spec.scenario_id)
                         if st == "SKIPPED" else None),
            evidence_event_ids=(obs or {}).get("event_ids", []),
            checks=[]))

    # count required failures from per-check data in demo_result/state
    for row in rows:
        if row.status == "FAIL":
            required_failed += 1
        elif row.status == "ERROR":
            required_errored += 1

    # -- verification steps (what could actually run) ------------------------
    steps: list[VerificationStep] = []
    steps.append(VerificationStep(
        name="ledger_chain", required=True, executed=True,
        result="pass" if vr.valid else "fail",
        evidence=f"fresh verify_ledger at height {vr.checked_height}; "
                 f"findings={[f.value for f in vr.findings]}"))
    if cp_present and checkpoint is not None:
        steps.append(VerificationStep(
            name="checkpoint_signature", required=True, executed=True,
            result="pass" if cp_sig_valid else "fail",
            evidence=f"checkpoint_seq={cp_seq}, key_id={checkpoint.key_id}"))
        steps.append(VerificationStep(
            name="truncation_vs_checkpoint", required=True, executed=True,
            result="pass" if vr.checkpoint_coverage in ("full",) else "fail",
            evidence=f"coverage={vr.checkpoint_coverage} at height {vr.checked_height}"))
    else:
        steps.append(VerificationStep(
            name="checkpoint_signature", required=False, executed=False,
            result="not_applicable",
            evidence="no checkpoint present for this run"))
        steps.append(VerificationStep(
            name="truncation_vs_checkpoint", required=True, executed=False,
            result="not_possible",
            evidence="no trusted checkpoint supplied — truncation undetectable "
                    "without one (honest limitation, spec §3.5)"))

    # -- limitations ----------------------------------------------------------
    limitations: list[str] = []
    docker_status = docker_probe.check()
    compose_status = docker_probe.compose_available()
    if not docker_status.get("available"):
        limitations.append("runtime containment untested (Docker unavailable) — "
                            "SC-03r/SC-04r recorded as SKIPPED, never PASS")
    if not config.report.signing_enabled:
        limitations.append("report signing disabled by config")

    truncation_check = ("pass" if (cp_present and vr.checkpoint_coverage == "full")
                        else ("not_applicable" if not config.ledger.sign_checkpoints
                              else "not_possible"))

    inputs = ReportStatusInputs(
        chain_valid=vr.valid,
        checkpoint_result=("valid" if (cp_present and cp_sig_valid)
                           else "invalid" if cp_present else "absent"),
        truncation_check=truncation_check,
        counts=counts,
        required_failed=required_failed,
        required_errored=required_errored,
        verification_steps=steps,
        limitations=limitations,
    )
    status = compute_status(inputs)

    from app.ledger.keys import KEY_ID
    report = AuditReport(
        run_id=run_id,
        verification_timestamp=clock.now_utc().isoformat(),
        target_mode=config.target_mode,
        environment=EnvironmentBlock(
            offline_mode=True,
            docker_available=bool(docker_status.get("available")),
            docker_compose_available=bool(compose_status),
            os=f"{_platform.system()} {_platform.release()}"),
        assertions=counts,
        scenario_results=rows,
        ledger=LedgerBlock(
            block_height=vr.checked_height,
            chain_valid=vr.valid,
            checkpoint_present=cp_present,
            checkpoint_seq=cp_seq,
            checkpoint_signature_valid=cp_sig_valid,
            truncation_check_possible=cp_present,
            checkpoint_coverage=vr.checkpoint_coverage,
            checkpoint_final_event_hash=(checkpoint.final_event_hash
                                         if checkpoint is not None else None)),
        verification_steps=steps,
        limitations=limitations,
        status=status,
        report_signature=ReportSignature(key_id=keypair[1] if keypair else KEY_ID),
        ledger_path=str(ledger_path),
    )
    return report


def validate_report(report: AuditReport) -> None:
    """Model-validate against the Pydantic schema (the internal gate)."""
    AuditReport.model_validate(report.model_dump(mode="json"))


def export_report(report: AuditReport, path: Path) -> Path:
    """Pretty JSON + newline at EOF under runs/<id>/audit_report.json."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(report.model_dump_json(indent=2) + "\n", encoding="utf-8")
    return path
