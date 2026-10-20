"""Security: stale status can never masquerade as current verification (D8)."""

from __future__ import annotations

from app.ledger.verifier import verify_ledger
from app.schema import EventType


def test_stale_verification_shows_STALE(harness, tmp_path_run):
    """A verification record older than the chain height reads as STALE."""
    rid = "run-broker01"
    from app.harness.scenarios import build_catalogue
    specs = {s.scenario_id: s for s in build_catalogue()}
    harness.run(specs["SC-01"], run_id=rid)
    vr = verify_ledger(harness.ledger.path)
    harness.runstore.append_verification(rid, vr)

    from app.config import BayoraConfig
    from app.dashboard.state import DashboardState
    cfg = BayoraConfig()
    cfg = cfg.model_copy(update={
        "ledger": cfg.ledger.model_copy(update={
            "runs_dir": tmp_path_run})})
    state = DashboardState(cfg, run_id=rid)
    first = state.ledger_integrity()
    assert first["verification"] == "VALID"
    assert first["stale"] is False

    # the chain grows AFTER the recorded verification
    harness.run(specs["SC-04"], run_id=rid)
    second = state.ledger_integrity()
    assert second["stale"] is True
    assert second["verification"].startswith("STALE"), \
        "an outdated verification must never display as current VALID"


def test_verification_record_carries_height(harness, tmp_path_run):
    rid = "run-broker01"
    from app.harness.scenarios import build_catalogue
    specs = {s.scenario_id: s for s in build_catalogue()}
    harness.run(specs["SC-02"], run_id=rid)
    vr = verify_ledger(harness.ledger.path)
    harness.runstore.append_verification(rid, vr)
    recs = harness.runstore.load_verifications(rid)
    assert recs, "verification must be persisted as a record"
    assert recs[-1]["checked_height"] == vr.checked_height
    assert recs[-1]["valid"] is True
