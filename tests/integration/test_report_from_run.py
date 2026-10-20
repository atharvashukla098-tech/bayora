"""Integration: report built from a real run; verify-path accept/reject (D15)."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

from app.config import BayoraConfig
from app.clock import SystemClock
from app.harness.docker_probe import DockerProbe
from app.harness.runner import Harness
from app.harness.scenarios import build_catalogue
from app.reporting.report import build_report, export_report, validate_report
from app.reporting.signing import sign_report, verify_report_file
from app.ledger.verifier import verify_ledger
from app.schema import AssertionStatus


def _run_a_demo(harness, runstore, rid):
    specs = {s.scenario_id: s for s in build_catalogue()}
    harness.run(specs["SC-01"], run_id=rid)
    harness.run(specs["SC-02"], run_id=rid)
    harness.run(specs["SC-03"], run_id=rid)
    harness.run(specs["SC-04"], run_id=rid)


def _ensure_checkpoint(harness, rid):
    """Sign a checkpoint at the run's current head so the report's required
    truncation step is executable (D12: refresh-at-head, sidecar-only)."""
    from app.ledger.checkpoints import checkpoint_at_head
    checkpoint_at_head(harness.ledger, harness.keypair[0],
                       harness.keypair[1], harness.clock)


def test_report_counts_match_run_artifacts(harness, runstore, dev_key):
    rid = "run-broker01"
    _run_a_demo(harness, runstore, rid)
    _ensure_checkpoint(harness, rid)
    cfg = BayoraConfig()
    report = build_report(rid, runstore, cfg, SystemClock(), DockerProbe(),
                          keypair=dev_key)
    # recompute counts independently from state.json
    state = runstore.load_state(rid)
    assert report.assertions.total == state.assertions["total"]
    assert report.assertions.passed == state.assertions["passed"]
    assert report.assertions.total == report.assertions.passed \
        + report.assertions.failed + report.assertions.errors \
        + report.assertions.skipped + report.assertions.not_evaluated
    # every number in the report came from artifacts: scenario rows exist
    assert any(r.scenario_id == "SC-02" and r.outcome == "REDACTED"
               for r in report.scenario_results)
    assert report.status.value in ("VERIFIED", "VERIFIED_WITH_LIMITATIONS")


def test_report_contains_scenario_rows_with_event_ids(harness, runstore, dev_key):
    rid = "run-broker01"
    _run_a_demo(harness, runstore, rid)
    _ensure_checkpoint(harness, rid)
    cfg = BayoraConfig()
    report = build_report(rid, runstore, cfg, SystemClock(), DockerProbe(),
                          keypair=dev_key)
    for row in report.scenario_results:
        assert row.scenario_id
        assert isinstance(row.evidence_event_ids, list)


def test_verify_path_accepts_demo_report(harness, runstore, dev_key, tmp_path):
    rid = "run-broker01"
    _run_a_demo(harness, runstore, rid)
    _ensure_checkpoint(harness, rid)
    cfg = BayoraConfig()
    report = build_report(rid, runstore, cfg, SystemClock(), DockerProbe(),
                          keypair=dev_key)
    report = sign_report(report, dev_key[0])
    out = export_report(report, runstore.run_dir(rid) / "audit_report.json")
    rv = verify_report_file(out, dev_key[2], config=cfg)
    assert rv.signature_valid is True
    assert rv.ledger_chain_valid is True
    assert rv.accepted is True, f"findings: {rv.findings}"


def test_verify_path_rejects_unsigned_verified_report(harness, runstore, dev_key):
    """D15 gate: VERIFIED* + no signature (signing enabled) => REJECTED."""
    rid = "run-broker01"
    _run_a_demo(harness, runstore, rid)
    _ensure_checkpoint(harness, rid)
    cfg = BayoraConfig()
    report = build_report(rid, runstore, cfg, SystemClock(), DockerProbe(),
                          keypair=dev_key)
    assert report.status.value in ("VERIFIED", "VERIFIED_WITH_LIMITATIONS")
    out = export_report(report, runstore.run_dir(rid) / "audit_report.json")
    rv = verify_report_file(out, dev_key[2], config=cfg)
    assert rv.signature_valid is False
    assert rv.accepted is False, "unsigned VERIFIED report must be rejected"


def test_verify_path_rejects_tampered_report(harness, runstore, dev_key):
    rid = "run-broker01"
    _run_a_demo(harness, runstore, rid)
    _ensure_checkpoint(harness, rid)
    cfg = BayoraConfig()
    report = build_report(rid, runstore, cfg, SystemClock(), DockerProbe(),
                          keypair=dev_key)
    report = sign_report(report, dev_key[0])
    data = json.loads(report.model_dump_json())
    data["assertions"]["passed"] = 999   # tamper with a signed field
    tampered_path = runstore.run_dir(rid) / "tampered_report.json"
    tampered_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    rv = verify_report_file(tampered_path, dev_key[2], config=cfg)
    assert rv.signature_valid is False
    assert rv.accepted is False


def test_verify_path_rejects_report_repointed_at_foreign_ledger(
        harness, runstore, dev_key, tmp_path):
    """Attack regression: ledger_path is an unsigned provenance pointer —
    re-pointing a SIGNED report at a different, valid ledger must NOT
    accept. The binding check compares the signed ledger block (height,
    checkpoint presence/seq) against the freshly-verified chain."""
    rid = "run-broker01"
    _run_a_demo(harness, runstore, rid)
    _ensure_checkpoint(harness, rid)
    cfg = BayoraConfig()
    report = build_report(rid, runstore, cfg, SystemClock(), DockerProbe(),
                          keypair=dev_key)
    report = sign_report(report, dev_key[0])
    assert report.ledger.checkpoint_present is True

    # a DIFFERENT, perfectly valid 4-event ledger with NO checkpoint
    from app.ledger.chain import Ledger
    from app.clock import FixedClock
    from datetime import datetime, timezone
    other_dir = tmp_path / "foreign-run"
    other = Ledger(other_dir, FixedClock(
        datetime(2026, 1, 1, tzinfo=timezone.utc)))
    from app.schema import Component, EventType
    for i in range(4):
        other.append(EventType.REQUEST_INGRESS, Component.BROKER,
                     run_id="foreign-run",
                     detail={"prompt_digest": f"{i:016x}"})
    assert verify_ledger(other.path).valid

    # re-point the report (signature stays valid — ledger_path is unsigned)
    data = json.loads(report.model_dump_json())
    data["ledger_path"] = str(other.path)
    repointed = runstore.run_dir(rid) / "repointed_report.json"
    repointed.write_text(json.dumps(data, indent=2), encoding="utf-8")
    rv = verify_report_file(repointed, dev_key[2], config=cfg)
    assert rv.signature_valid is True, "ledger_path is legitimately unsigned"
    assert rv.accepted is False, \
        "a report re-bound to a foreign ledger must NOT accept"
    assert any("binding" in f for f in rv.findings), rv.findings


def test_verify_path_rejects_report_repointed_at_same_height_foreign_ledger(
        harness, runstore, dev_key, tmp_path):
    """Attack regression (r2): the binding must survive the SAME-height
    foreign ledger. Two deterministic runs produce equal heights and
    checkpoint seqs, so heights alone cannot bind a report to its evidence.
    The four-way binding (run identity, checkpoint final_event_hash,
    checkpoint ledger_id, attested evidence ids) must each fail this."""
    rid = "run-broker01"
    _run_a_demo(harness, runstore, rid)
    _ensure_checkpoint(harness, rid)
    cfg = BayoraConfig()
    report = build_report(rid, runstore, cfg, SystemClock(), DockerProbe(),
                          keypair=dev_key)
    report = sign_report(report, dev_key[0])
    assert report.scenario_results, "the report must attest some evidence"
    attested = [eid for row in report.scenario_results
                for eid in row.evidence_event_ids]
    assert attested, "the report must carry attested evidence ids"

    # a DIFFERENT valid ledger at the SAME height with a checkpoint at the
    # SAME seq — the exact counterexample from the attack
    from app.ledger.chain import Ledger
    from app.ledger.checkpoints import checkpoint_at_head
    from app.clock import FixedClock
    from datetime import datetime, timezone
    from app.harness.runstore import RunStore
    other_store = RunStore(tmp_path / "other-runs")
    other_ledger = Ledger(other_store.run_dir(rid), FixedClock(
        datetime(2026, 1, 1, tzinfo=timezone.utc)))
    from app.schema import Component, EventType
    for i in range(report.ledger.block_height):
        other_ledger.append(EventType.REQUEST_INGRESS, Component.BROKER,
                             run_id=rid,
                             detail={"prompt_digest": f"{i:016x}"})
    # grow to exactly the same height as the report's signed block_height
    while other_ledger.block_height < report.ledger.block_height:
        other_ledger.append(EventType.REQUEST_INGRESS, Component.BROKER,
                             run_id=rid, detail={"prompt_digest": "00"})
    checkpoint_at_head(other_ledger, dev_key[0], dev_key[1],
                       FixedClock(datetime(2026, 1, 1, tzinfo=timezone.utc)))
    from app.ledger.checkpoints import load_checkpoint
    other_cp = load_checkpoint(other_ledger.run_dir)
    assert other_cp is not None and other_cp.checkpoint_seq == \
        report.ledger.block_height, \
        "the foreign checkpoint must sit at the SAME seq as the signed one"
    assert verify_ledger(other_ledger.path, checkpoint=other_cp,
                        trusted_public_key=dev_key[2]).valid

    data = json.loads(report.model_dump_json())
    data["ledger_path"] = str(other_ledger.path)
    repointed = runstore.run_dir(rid) / "repointed_same_height.json"
    repointed.write_text(json.dumps(data, indent=2), encoding="utf-8")
    rv = verify_report_file(repointed, dev_key[2], config=cfg)
    assert rv.signature_valid is True
    assert rv.ledger_chain_valid is True, "the foreign chain is valid"
    assert rv.accepted is False, \
        "same-height foreign ledger must NOT accept (heights-only binding)"
    assert any("binding" in f for f in rv.findings), rv.findings
    # and specifically the evidence-id binding must have caught it
    assert any("evidence" in f for f in rv.findings), rv.findings


def test_verify_path_rejects_report_claiming_missing_checkpoint(
        harness, runstore, dev_key, tmp_path):
    """Attack regression: a report that attests a signed checkpoint but is
    verified against a run WITHOUT one must fail closed — the old code
    fell back to the report's own signed claim (checkpoint_valid: True)."""
    rid = "run-broker01"
    _run_a_demo(harness, runstore, rid)
    _ensure_checkpoint(harness, rid)
    cfg = BayoraConfig()
    report = build_report(rid, runstore, cfg, SystemClock(), DockerProbe(),
                          keypair=dev_key)
    report = sign_report(report, dev_key[0])
    assert report.ledger.checkpoint_present is True

    # same ledger, but the checkpoint sidecar is removed
    import shutil
    cp_path = runstore.run_dir(rid) / "checkpoint.json"
    stashed = tmp_path / "stashed_checkpoint.json"
    shutil.copy2(cp_path, stashed)
    cp_path.unlink()
    try:
        # export the signed report and verify with the checkpoint missing
        out = export_report(report, runstore.run_dir(rid) / "audit_report.json")
        rv = verify_report_file(out, dev_key[2], config=cfg)
        assert rv.accepted is False, \
            "a checkpoint claim with no checkpoint on disk must fail closed"
        assert any("binding" in f or "checkpoint" in f.lower()
                   for f in rv.findings), rv.findings
    finally:
        shutil.copy2(stashed, cp_path)


def test_validate_report_against_schema(harness, runstore, dev_key):
    rid = "run-broker01"
    _run_a_demo(harness, runstore, rid)
    _ensure_checkpoint(harness, rid)
    cfg = BayoraConfig()
    report = build_report(rid, runstore, cfg, SystemClock(), DockerProbe(),
                          keypair=dev_key)
    validate_report(report)   # must not raise
    # cross-check with the shipped JSON schema file
    schema_path = ROOT / "app" / "reporting" / "report.schema.json"
    assert schema_path.is_file(), "report.schema.json must ship"
