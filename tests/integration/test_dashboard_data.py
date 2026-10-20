"""Integration: dashboard reads real data; mode-aware health (D19); core
fragment only (D14)."""

from __future__ import annotations

import json
from pathlib import Path

from app.config import BayoraConfig
from app.dashboard.state import DashboardState
from app.harness.runner import Harness
from app.harness.scenarios import build_catalogue


LEDGER_RUN = "run-broker01"   # the in-process broker's own ledger run dir


def _state_for(runstore_dir) -> DashboardState:
    cfg = BayoraConfig()
    cfg = cfg.model_copy(update={
        "ledger": cfg.ledger.model_copy(update={"runs_dir": Path(runstore_dir)})})
    return DashboardState(cfg)


def _run_scenarios(harness, rid):
    specs = {s.scenario_id: s for s in build_catalogue()}
    harness.run(specs["SC-01"], run_id=rid)
    harness.run(specs["SC-02"], run_id=rid)


def test_latest_events_reflect_ledger_tail(harness, tmp_path_run):
    rid = LEDGER_RUN
    _run_scenarios(harness, LEDGER_RUN)
    state = _state_for(tmp_path_run)
    state.run_id = LEDGER_RUN
    events = state.latest_events(50)
    assert events, "dashboard must read the run's real ledger"
    assert events[-1].seq >= events[0].seq
    types = {e.event_type.value for e in events}
    assert "request.ingress" in types


def test_broker_health_mode_aware_in_process(harness, tmp_path_run):
    rid = LEDGER_RUN
    _run_scenarios(harness, LEDGER_RUN)
    state = _state_for(tmp_path_run)
    state.run_id = LEDGER_RUN
    health = state.broker_health()
    assert health["status"] in ("ACTIVE", "IDLE")
    assert "in-process mode" in health["detail"], \
        "in-process mode must say why there is no socket probe (D19)"


def test_broker_health_not_started(tmp_path_run):
    state = _state_for(tmp_path_run)
    state.run_id = None
    health = state.broker_health()
    assert health["status"] == "NOT_STARTED"


def test_matrix_rows_carry_event_ids(harness, tmp_path_run):
    rid = LEDGER_RUN
    _run_scenarios(harness, LEDGER_RUN)
    # also record demo entries so the matrix finds statuses
    harness.runstore.append_demo_result(LEDGER_RUN, {
        "scene": "attack", "scenario_id": "SC-01", "status": "PASS",
        "event_ids": ["ev-1"], "checks": []})
    state = _state_for(tmp_path_run)
    state.run_id = LEDGER_RUN
    rows = state.matrix()
    assert len(rows) >= 14, "the full catalogue must render as rows"
    sc01 = next(r for r in rows if r["scenario_id"] == "SC-01")
    assert sc01["result"] == "PASS"
    assert sc01["evidence"]


def test_stale_verification_shows_stale(harness, tmp_path_run, tmp_path):
    """D8: after the chain grows, the old verification must read as STALE."""
    rid = LEDGER_RUN
    _run_scenarios(harness, LEDGER_RUN)
    from app.ledger.verifier import verify_ledger
    vr = verify_ledger(harness.ledger.path)
    harness.runstore.append_verification(LEDGER_RUN, vr)
    integrity = _state_for(tmp_path_run)
    integrity.run_id = rid
    before = integrity.ledger_integrity()
    assert before["verification"] == "VALID"
    # grow the chain (the stale trigger)
    harness.run({s.scenario_id: s for s in build_catalogue()}["SC-04"], run_id=rid)
    after = integrity.ledger_integrity()
    assert after["stale"] is True
    assert after["verification"].startswith("STALE"), \
        "a grown ledger must never keep displaying VALID from an old check"


def test_historical_run_shows_recorded_status(harness, tmp_path_run):
    rid = LEDGER_RUN
    _run_scenarios(harness, LEDGER_RUN)
    state = _state_for(tmp_path_run)
    history = state.run_history()
    assert any(h["run_id"] == rid for h in history)


def test_refresh_uses_core_fragment_only():
    """D14: @st.fragment present; no third-party autorefresh anywhere."""
    app_py = (Path(__file__).resolve().parents[2]
              / "app" / "dashboard" / "app.py")
    text = app_py.read_text(encoding="utf-8")
    assert "@st.fragment(" in text, "refresh must use the core fragment API"
    dashboard_dir = app_py.parent
    for f in dashboard_dir.rglob("*.py"):
        assert "autorefresh" not in f.read_text(encoding="utf-8"), \
            f"third-party autorefresh found in {f}"


def test_idle_vs_disconnected_labels(harness, tmp_path_run):
    state = _state_for(tmp_path_run)
    state.run_id = "run-never-existed"
    alive, label = state.event_source_alive()
    assert alive is False and "DISCONNECTED" in label
    state.run_id = None
    alive2, label2 = state.event_source_alive()
    assert alive2 is False
