"""Integration: harness→broker flow, config gates, in-process transport (D23)."""

from __future__ import annotations

from app.harness.client import InProcessBrokerClient
from app.harness.runner import Harness
from app.harness.scenarios import build_catalogue
from app.ledger.verifier import verify_ledger
from app.schema import AssertionStatus, EventType


def _specs():
    return {s.scenario_id: s for s in build_catalogue()}


def test_full_catalogue_present():
    ids = {s.scenario_id for s in build_catalogue()}
    expected = {"SC-01", "SC-01b", "SC-02", "SC-03", "SC-03r", "SC-04",
                "SC-04r", "SC-05", "SC-05b", "SC-05c", "SC-05d", "SC-06",
                "SC-07", "SC-08"}
    assert expected <= ids, f"missing: {expected - ids}"


def test_harness_runs_sc01_sc02_sc03_sc04(harness):
    specs = _specs()
    for sid in ("SC-01", "SC-02", "SC-03", "SC-04"):
        result = harness.run(specs[sid], run_id="run-hb01")
        assert result.status == AssertionStatus.PASSED, \
            f"{sid}: {[c.model_dump() for c in result.checks]}"


def test_harness_runs_sc06_malformed_through_raw_body(harness):
    """Attack regression: SC-06 must reach the broker as a WRONG-TYPE body
    (raw_content), not be wrapped into a valid string prompt. Expected:
    422 SCHEMA_INVALID, outcome NOT_EVALUATED, policy.decision recorded."""
    specs = _specs()
    result = harness.run(specs["SC-06"], run_id="run-hb06")
    assert result.status == AssertionStatus.PASSED, \
        f"SC-06: {[c.model_dump() for c in result.checks]}"
    obs = harness.runstore.load_observations("run-hb06")
    sc06 = next(o for o in obs if o.get("scenario_id") == "SC-06")
    assert sc06["status_code"] == 422
    assert sc06["outcome"] == "NOT_EVALUATED"
    assert "SCHEMA_INVALID" in (sc06["policy_reason"] or "")


def test_harness_sc08_timeout(harness):
    """SC-08 uses the default 5s timeout — the mock sleeps 10,000s; wait_for
    cancels. To keep the test fast we lower the timeout via config copy."""
    from app.config import BayoraConfig
    cfg = BayoraConfig()
    cfg = cfg.model_copy(update={
        "broker": cfg.broker.model_copy(update={"timeout_seconds": 0.3})})
    # rebuild the stack pieces that captured the old config
    from app.harness.client import InProcessBrokerClient
    from app.broker.service import create_broker_app
    from app.ledger.chain import Ledger
    from app.target.adapter import InProcessTargetClient
    from app.target.mock import MockTarget
    import tempfile
    from pathlib import Path
    from app.clock import SystemClock
    from app.harness.runstore import RunStore
    from app.ledger.keys import load_or_generate_keypair

    tmp = Path(tempfile.mkdtemp())
    store = RunStore(tmp / "runs")
    keypair = load_or_generate_keypair(tmp / "keys")
    led = Ledger(store.run_dir("run-hb-tmo"), SystemClock())
    from app.target.mock import SecretStore
    s = SecretStore("BAYORA-CANARY", True, "run-hb-tmo")
    app = create_broker_app(cfg, target_client=InProcessTargetClient(MockTarget(s)),
                            ledger=led, secret_store=s)
    h = Harness(cfg, broker_client=InProcessBrokerClient(app), runstore=store,
                keypair=keypair, secret_store=s, ledger=led)
    result = h.run(_specs()["SC-08"], run_id="run-hb-tmo")
    assert result.status == AssertionStatus.PASSED, \
        f"SC-08: {[c.model_dump() for c in result.checks]}"


def test_config_gate_skips_sc02_when_block_mode_on(tmp_path, secret_store,
                                                   dev_key, fixed_clock,
                                                   runstore, block_mode_config):
    """Runner step 2a: honest SKIPPED, never a spurious FAIL."""
    from app.broker.service import create_broker_app
    from app.ledger.chain import Ledger
    from app.target.adapter import InProcessTargetClient
    from app.target.mock import MockTarget

    led = Ledger(runstore.run_dir("run-gate1"), fixed_clock)
    app = create_broker_app(block_mode_config,
                            target_client=InProcessTargetClient(MockTarget(secret_store)),
                            ledger=led, secret_store=secret_store)
    h = Harness(block_mode_config, broker_client=InProcessBrokerClient(app),
                runstore=runstore, keypair=dev_key, secret_store=secret_store,
                ledger=led)
    result = h.run(_specs()["SC-02"], run_id="run-gate1")
    assert result.status == AssertionStatus.SKIPPED
    assert "config precondition" in (result.skip_reason or "")


def test_checkpoint_refreshed_at_current_height_before_tamper_scenarios(
        harness, runstore):
    """D12/D25: SC-05b refreshes a checkpoint covering the exact head."""
    specs = _specs()
    rid = "run-broker01"   # the in-process broker's own ledger run dir
    harness.run(specs["SC-02"], run_id=rid)   # grow the ledger
    result = harness.run(specs["SC-05b"], run_id=rid)
    assert result.status == AssertionStatus.PASSED, \
        f"SC-05b: {[c.model_dump() for c in result.checks]}"
    # the refreshed checkpoint sidecar covers the head at refresh time
    # (the ledger's OWN run dir — the single writer of that chain)
    from app.ledger.checkpoints import load_checkpoint
    cp = load_checkpoint(harness.ledger.run_dir)
    assert cp is not None and cp.checkpoint_seq >= 1
    assert cp.checkpoint_seq <= harness.ledger.block_height


def test_no_checkpoints_config_skips_sc05b_sc07(harness_no_cp):
    specs = _specs()
    for sid in ("SC-05b", "SC-07"):
        result = harness_no_cp.run(specs[sid], run_id="run-gate2")
        assert result.status == AssertionStatus.SKIPPED
        assert "sign_checkpoints=false" in (result.skip_reason or "")


def test_full_catalogue_tamper_rows_pass_when_executed(harness, runstore):
    """Attack regression (r2): SC-05/SC-05b/SC-05c/SC-05d/SC-07 driven
    through the harness must PASS when the system works — the old SC-07
    asserted the FORGED signature would verify (inverted), and the old
    SC-05d compared hash values that are equal by chain construction. No
    shipped test drove the catalogue's tamper rows, so both were invisible.
    """
    specs = _specs()
    rid = "run-broker01"   # the in-process broker's own ledger run dir
    # grow the ledger so tampering has material and cadence/checkpoint state
    for sid in ("SC-01", "SC-02", "SC-03", "SC-04"):
        harness.run(specs[sid], run_id=rid)
    for sid in ("SC-05", "SC-05b", "SC-05c", "SC-05d", "SC-07"):
        result = harness.run(specs[sid], run_id=rid)
        assert result.status == AssertionStatus.PASSED, \
            f"{sid}: {[c.model_dump() for c in result.checks]}"


def test_sc05d_delete_check_uses_real_divergence(harness, runstore):
    """Attack regression (r2): delete_event's expected/computed hashes must
    genuinely diverge. The old implementation returned the successor's
    prev_hash as computed_hash — which IS the deleted event's hash by chain
    construction, so the 'expected vs computed differ' check always FAILED
    with a false message. Now expected = the prev-link the chain requires at
    the successor's new position, computed = the link it actually stores."""
    from app.harness import adversary
    import tempfile
    from pathlib import Path
    rid = "run-broker01"
    specs = _specs()
    harness.run(specs["SC-01"], run_id=rid)
    harness.run(specs["SC-02"], run_id=rid)
    tmp = Path(tempfile.mkdtemp(prefix="sc05d-regression-"))
    copy = adversary.disposable_copy(harness.ledger.path, tmp)
    pre = verify_ledger(copy)
    assert pre.valid
    info = adversary.delete_event(copy, 2)
    # the two values must differ — the check the harness asserts on
    assert info.expected_hash != info.computed_hash, \
        ("delete_event must expose genuinely divergent hashes, not the "
         "degenerate equal pair the old code produced")
    # and the corrupted copy must be rejected by the verifier
    vr = verify_ledger(copy)
    assert not vr.valid


def test_sc07_asserts_forged_signature_is_rejected(harness, runstore):
    """Attack regression (r2): the SC-07 assertion must be the blueprint's
    own — assert_checkpoint_signature(corrupted) == False — PASS exactly
    when Ed25519 rejects the forged bytes. The old code asserted the forge
    would VERIFY, making the scenario FAIL whenever the system worked."""
    rid = "run-broker01"
    specs = _specs()
    harness.run(specs["SC-01"], run_id=rid)
    result = harness.run(specs["SC-07"], run_id=rid)
    assert result.status == AssertionStatus.PASSED, \
        f"SC-07 must PASS when the forged signature is rejected: " \
        f"{[c.model_dump() for c in result.checks]}"
    names = [c.name for c in result.checks]
    assert "assert_checkpoint_signature(forged) == False" in names
    # the verification evidence the scenario declares is really recorded
    assert any(c.status == AssertionStatus.PASSED
               for c in result.checks
               if c.name == "verification.performed recorded")


def test_inprocess_client_traverses_middleware(broker_app):
    """D23: an oversized post through InProcessBrokerClient hits the size
    middleware and returns the BrokerErrorBody — proving the ASGI stack ran."""
    client = InProcessBrokerClient(broker_app)
    r = client.post_evaluate("x" * 9000, run_id="run-mw")
    assert r.status_code == 413
    body = r.json()
    assert body["error"] == "REQUEST_TOO_LARGE"
    assert body["outcome"] == "NOT_EVALUATED"
    assert set(body.keys()) == {"error", "outcome", "detail", "run_id"}


def test_ledger_still_valid_after_harness_run(harness, broker_app):
    specs = _specs()
    rid = "run-hb02"
    for sid in ("SC-01", "SC-02", "SC-03", "SC-04"):
        harness.run(specs[sid], run_id=rid)
    vr = verify_ledger(broker_app.state.test_ledger.path)
    assert vr.valid, f"chain broken after run: {[f.value for f in vr.findings]}"
    events = broker_app.state.test_ledger.read_all()
    seqs = [e.seq for e in events]
    assert seqs == list(range(1, len(events) + 1)), "seq must be contiguous"
