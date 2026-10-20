"""Shared fixtures: tmp run dirs, fixed clock, secret store, dev key, broker app,
target spy, harness — blueprint §15."""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import BayoraConfig
from app.clock import FixedClock, SystemClock
from app.harness.runstore import RunStore
from app.ledger.chain import Ledger
from app.ledger.checkpoints import LedgerCheckpointSigner
from app.ledger.keys import load_or_generate_keypair
from app.target.adapter import InProcessTargetClient, TargetSpy
from app.target.mock import MockTarget, SecretStore


@pytest.fixture()
def fixed_clock():
    return FixedClock(datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc))


@pytest.fixture()
def tmp_path_run(tmp_path):
    return tmp_path / "runs"


@pytest.fixture()
def runstore(tmp_path_run):
    return RunStore(tmp_path_run)


@pytest.fixture()
def secret_store():
    return SecretStore("BAYORA-CANARY", True, "run-abcdef1234")


@pytest.fixture()
def dev_key(tmp_path):
    return load_or_generate_keypair(tmp_path / "keys")


@pytest.fixture()
def ledger(tmp_path, fixed_clock, dev_key):
    """A ledger with the checkpoint signer attached (cadence, D25)."""
    run_dir = tmp_path / "runs" / "run-test01"
    return Ledger(run_dir, fixed_clock,
                  checkpoint_signer=LedgerCheckpointSigner(dev_key[0], dev_key[1],
                                                           fixed_clock),
                  checkpoint_every=10)


@pytest.fixture()
def broker_app(tmp_path, secret_store, dev_key, fixed_clock):
    """In-process broker over the real ASGI stack (D23) with a fresh ledger."""
    from app.broker.service import create_broker_app
    cfg = BayoraConfig()
    run_dir = tmp_path / "runs" / "run-broker01"
    led = Ledger(run_dir, fixed_clock)
    target = InProcessTargetClient(MockTarget(secret_store))
    app = create_broker_app(cfg, target_client=target, ledger=led,
                            secret_store=secret_store)
    app.state.test_ledger = led
    return app


@pytest.fixture()
def broker_client(broker_app):
    from app.harness.client import InProcessBrokerClient
    return InProcessBrokerClient(broker_app)


@pytest.fixture()
def target_spy(secret_store):
    """Wraps the in-process client; counts calls (D17 proof)."""
    return TargetSpy(InProcessTargetClient(MockTarget(secret_store)))


@pytest.fixture()
def block_mode_config():
    cfg = BayoraConfig()
    return cfg.model_copy(update={
        "broker": cfg.broker.model_copy(update={"block_on_injection": True})})


@pytest.fixture()
def no_checkpoints_config():
    cfg = BayoraConfig()
    return cfg.model_copy(update={
        "ledger": cfg.ledger.model_copy(update={"sign_checkpoints": False})})


@pytest.fixture()
def harness(tmp_path, secret_store, dev_key, fixed_clock, runstore, broker_app):
    """Full in-process harness wiring."""
    from app.harness.client import InProcessBrokerClient
    from app.harness.runner import Harness
    cfg = BayoraConfig()
    led = broker_app.state.ledger
    return Harness(cfg, broker_client=InProcessBrokerClient(broker_app),
                   runstore=runstore, keypair=dev_key, clock=fixed_clock,
                   secret_store=secret_store, ledger=led)


@pytest.fixture()
def harness_no_cp(tmp_path, secret_store, dev_key, fixed_clock, runstore,
                  broker_app, no_checkpoints_config):
    """Harness wired with sign_checkpoints=false (config-gate skip tests)."""
    from app.harness.client import InProcessBrokerClient
    from app.harness.runner import Harness
    led = broker_app.state.ledger
    return Harness(no_checkpoints_config,
                   broker_client=InProcessBrokerClient(broker_app),
                   runstore=runstore, keypair=None, clock=fixed_clock,
                   secret_store=secret_store, ledger=led)


@pytest.fixture()
def runtime_battery():
    from app.harness.runtime_battery import RuntimeBattery
    return RuntimeBattery(project_dir=str(Path(__file__).resolve().parents[1]))
