"""Unit tests for the site's evidence bundle.

The bundle is the only thing the public 3D site knows about a run. Two
properties matter: it must be a faithful projection of the artifacts on
disk, and it must never carry a secret.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.config import BayoraConfig
from app.site_bundle import (
    SiteDataUnavailable,
    build_bundle,
    list_runs,
)


def _cfg(tmp_path: Path) -> BayoraConfig:
    cfg = BayoraConfig()
    return cfg.model_copy(update={
        "ledger": cfg.ledger.model_copy(update={"runs_dir": tmp_path})})


def _write_run(runs_dir: Path, run_id: str) -> Path:
    run_dir = runs_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    events = [
        {"schema_version": "1.0", "event_id": "a", "seq": 1,
         "ts": "2026-10-21T00:00:00+00:00", "run_id": run_id,
         "event_type": "run.started", "component": "red-harness",
         "outcome": None, "scenario_id": None,
         "detail": {"mode": "deterministic_mock"},
         "prev_hash": "0" * 64, "hash": "1" * 64},
        {"schema_version": "1.0", "event_id": "b", "seq": 2,
         "ts": "2026-10-21T00:00:01+00:00", "run_id": run_id,
         "event_type": "policy.decision", "component": "policy-broker",
         "outcome": "REDACTED", "scenario_id": "SC-02",
         "detail": {"canary": "BAYORA-CANARY-abc123", "action": "REDACT"},
         "prev_hash": "1" * 64, "hash": "2" * 64},
    ]
    (run_dir / "ledger.jsonl").write_text(
        "".join(json.dumps(e) + "\n" for e in events), encoding="utf-8")
    (run_dir / "state.json").write_text(json.dumps({
        "run_id": run_id, "status": "complete",
        "started_at": "2026-10-21T00:00:00+00:00",
        "assertions": {"total": 2, "passed": 2, "failed": 0, "errors": 0,
                       "skipped": 0, "not_evaluated": 0},
        "scenario_status": {"SC-02": "PASS"},
    }), encoding="utf-8")
    (run_dir / "demo_result.json").write_text(json.dumps({"scenes": [
        {"scene": "attack", "scenario_id": "SC-02", "status": "PASS",
         "event_ids": ["a", "b"], "checks": []},
    ]}), encoding="utf-8")
    (run_dir / "audit_report.json").write_text(json.dumps({
        "schema_version": "1.0", "platform": "Bayora",
        "platform_version": "1.0.0", "run_id": run_id,
        "verification_timestamp": "2026-10-21T00:00:00Z",
        "target_mode": "deterministic_mock",
        "environment": {"offline_mode": True, "docker_available": False,
                        "os": "test"},
        "assertions": {"total": 2, "passed": 2, "failed": 0, "errors": 0,
                       "skipped": 0, "not_evaluated": 0},
        "ledger": {"block_height": 2, "chain_valid": True,
                   "checkpoint_present": True,
                   "checkpoint_signature_valid": True},
        "verification_steps": [], "limitations": ["docker unavailable"],
        "status": "VERIFIED_WITH_LIMITATIONS",
        "report_signature": {"algorithm": "Ed25519", "key_id": "k",
                             "signature": "sig"},
    }), encoding="utf-8")
    return run_dir


def test_bundle_requires_artifacts(tmp_path: Path):
    cfg = _cfg(tmp_path)
    with pytest.raises(SiteDataUnavailable):
        build_bundle(cfg)


def test_bundle_shape_and_fidelity(tmp_path: Path):
    runs = tmp_path / "runs"
    runs.mkdir()
    _write_run(runs, "run-test-1")
    bundle = build_bundle(_cfg(runs))

    assert set(bundle) == {"run", "events", "matrix", "report", "checkpoint",
                           "integrity", "summary"}
    assert bundle["run"]["run_id"] == "run-test-1"
    assert len(bundle["events"]) == 2
    # each event carries the previous event's hash - the link is the chain
    assert bundle["events"][0]["prev_hash"] == "0" * 64
    assert bundle["events"][0]["hash"] == "1" * 64
    assert bundle["events"][1]["prev_hash"] == "1" * 64
    assert bundle["events"][1]["hash"] == "2" * 64
    assert bundle["summary"]["passed"] == 2
    assert bundle["summary"]["report_status"] == "VERIFIED_WITH_LIMITATIONS"


def test_bundle_redacts_canary_values(tmp_path: Path):
    runs = tmp_path / "runs"
    runs.mkdir()
    _write_run(runs, "run-test-2")
    bundle = build_bundle(_cfg(runs))
    blob = json.dumps(bundle)
    assert "BAYORA-CANARY-abc123" not in blob
    # raw event details are never published at all
    assert "detail" not in bundle["events"][1]
    for event in bundle["events"]:
        assert set(event) == {"seq", "ts", "run_id", "event_type", "component",
                              "outcome", "scenario_id", "hash", "prev_hash"}


def test_bundle_matrix_reflects_recorded_results(tmp_path: Path):
    runs = tmp_path / "runs"
    runs.mkdir()
    _write_run(runs, "run-test-3")
    bundle = build_bundle(_cfg(runs))
    rows = {r["scenario_id"]: r for r in bundle["matrix"]}
    assert rows["SC-02"]["result"] == "PASS"
    assert rows["SC-02"]["evidence"] == ["a", "b"]
    # catalogue scenarios that never ran stay NOT_EVALUATED
    assert rows["SC-01"]["result"] == "NOT_EVALUATED"


def test_list_runs_returns_recorded_runs(tmp_path: Path):
    runs = tmp_path / "runs"
    runs.mkdir()
    _write_run(runs, "run-test-4")
    listed = list_runs(_cfg(runs))
    assert listed and listed[0]["run_id"] == "run-test-4"
    assert listed[0]["report_status"] == "VERIFIED_WITH_LIMITATIONS"


def test_bundle_never_invents_a_report(tmp_path: Path):
    runs = tmp_path / "runs"
    runs.mkdir()
    run_dir = _write_run(runs, "run-test-5")
    (run_dir / "audit_report.json").unlink()
    bundle = build_bundle(_cfg(runs))
    assert bundle["report"] is None
    assert bundle["summary"]["report_status"] is None
