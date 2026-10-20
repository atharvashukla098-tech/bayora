"""Unit: checkpoints — sign/verify, refresh-at-head, cadence (D12/D25)."""

from __future__ import annotations

import pytest

from app.harness.adversary import truncate_tail, disposable_copy
from app.ledger.chain import Ledger
from app.ledger.checkpoints import (
    Checkpoint, checkpoint_at_head, load_checkpoint, sign_checkpoint,
    verify_checkpoint, write_checkpoint,
)
from app.ledger.keys import load_or_generate_keypair
from app.ledger.verifier import verify_ledger
from app.schema import Component, EventType, Finding


def _populate(ledger: Ledger, n: int = 5) -> None:
    for i in range(n):
        ledger.append(EventType.REQUEST_INGRESS, Component.BROKER,
                       run_id="run-cp", detail={"prompt_digest": f"{i:016x}"})


def test_sign_and_verify_roundtrip(tmp_path, fixed_clock, dev_key):
    priv, key_id, pub = dev_key
    led = Ledger(tmp_path / "run-cp1", fixed_clock)
    _populate(led)
    cp = checkpoint_at_head(led, priv, key_id, fixed_clock)
    assert verify_checkpoint(cp, pub)
    assert cp.checkpoint_seq == 5


def test_wrong_key_rejected(tmp_path, fixed_clock):
    priv, key_id, _ = load_or_generate_keypair(tmp_path / "keys-a")
    other_priv, other_key_id, other_pub = load_or_generate_keypair(tmp_path / "keys-b")
    led = Ledger(tmp_path / "run-cp2", fixed_clock)
    _populate(led)
    cp = checkpoint_at_head(led, priv, key_id, fixed_clock)
    assert not verify_checkpoint(cp, other_pub), "another key must NOT verify it"
    assert verify_checkpoint(cp, priv.public_key())


def test_forged_checkpoint_signature_fails(tmp_path, fixed_clock, dev_key):
    priv, key_id, pub = dev_key
    led = Ledger(tmp_path / "run-cp3", fixed_clock)
    _populate(led)
    cp = checkpoint_at_head(led, priv, key_id, fixed_clock)
    forged = cp.model_copy(update={"signature": cp.signature[:-4] + "AAAA"})
    assert not verify_checkpoint(forged, pub)


def test_refresh_signs_without_appending(tmp_path, fixed_clock, dev_key):
    """D25: checkpoint_at_head must leave ledger.jsonl byte-identical."""
    priv, key_id, _pub = dev_key
    led = Ledger(tmp_path / "run-cp4", fixed_clock)
    _populate(led, 4)
    before_bytes = led.path.read_bytes()
    before_height = led.block_height
    cp = checkpoint_at_head(led, priv, key_id, fixed_clock)
    assert led.path.read_bytes() == before_bytes, "refresh appended to the ledger!"
    assert led.block_height == before_height
    assert cp.checkpoint_seq == before_height
    # sidecars written
    assert (led.run_dir / "checkpoint.json").is_file()
    assert (led.run_dir / "checkpoint_history.jsonl").is_file()


def test_cadence_checkpoint_appends_checkpoint_signed(tmp_path, fixed_clock, dev_key):
    """D25: at height 10 the Ledger signs FIRST, then announces (event 11)."""
    from app.ledger.checkpoints import LedgerCheckpointSigner
    priv, key_id, _pub = dev_key
    led = Ledger(tmp_path / "run-cp5", fixed_clock,
                  checkpoint_signer=LedgerCheckpointSigner(priv, key_id, fixed_clock),
                  checkpoint_every=10)
    _populate(led, 11)   # 11 ingresses; cadence fires when height hits 10
    events = led.read_all()
    assert len(events) == 12, "one CHECKPOINT_SIGNED announcement expected"
    announcement = events[10]
    assert announcement.event_type == EventType.CHECKPOINT_SIGNED
    assert announcement.seq == 11, "announcement must be the event AFTER signing"
    assert announcement.detail["checkpoint_seq"] == "10"
    assert verify_ledger(led.path).valid


def test_truncation_below_checkpoint_always_detected(tmp_path, fixed_clock, dev_key):
    """D12: any strict prefix of the checkpoint's coverage is rejected."""
    priv, key_id, pub = dev_key
    led = Ledger(tmp_path / "run-cp6", fixed_clock)
    _populate(led, 5)
    cp = checkpoint_at_head(led, priv, key_id, fixed_clock)
    for drop in (1, 2, 5):
        copy = disposable_copy(led.path, tmp_path / f"copy-t{drop}")
        truncate_tail(copy, drop)
        vr = verify_ledger(copy, checkpoint=cp, trusted_public_key=pub)
        assert not vr.valid, f"truncation by {drop} was not detected"
        assert Finding.CHECKPOINT_PREFIX_MISMATCH in vr.findings
        assert Finding.BELOW_CHECKPOINT in vr.findings
        assert vr.checkpoint_coverage == "prefix"


def test_truncation_undetectable_without_checkpoint(tmp_path, fixed_clock, dev_key):
    """Honest limitation (L3): no checkpoint => coverage=none."""
    priv, key_id, _pub = dev_key
    led = Ledger(tmp_path / "run-cp7", fixed_clock)
    _populate(led, 5)
    copy = disposable_copy(led.path, tmp_path / "copy-nocp")
    truncate_tail(copy, 2)
    vr = verify_ledger(copy)
    assert vr.valid, "a chain-consistent prefix verifies without a checkpoint"
    assert vr.checkpoint_coverage == "none"


def test_checkpoint_covers_head_and_verifies_full(tmp_path, fixed_clock, dev_key):
    priv, key_id, pub = dev_key
    led = Ledger(tmp_path / "run-cp8", fixed_clock)
    _populate(led, 5)
    cp = checkpoint_at_head(led, priv, key_id, fixed_clock)
    vr = verify_ledger(led.path, checkpoint=cp, trusted_public_key=pub)
    assert vr.valid
    assert vr.checkpoint_coverage == "full"


def test_stale_checkpoint_after_growth_reports_prefix_of_coverage(
        tmp_path, fixed_clock, dev_key):
    """A checkpoint from an earlier height still vouches for its prefix:
    height 7 > cp_seq 5 => full coverage with the covered prefix checked."""
    priv, key_id, pub = dev_key
    led = Ledger(tmp_path / "run-cp9", fixed_clock)
    _populate(led, 5)
    cp = checkpoint_at_head(led, priv, key_id, fixed_clock)
    _populate(led, 2)  # chain grows to 7
    vr = verify_ledger(led.path, checkpoint=cp, trusted_public_key=pub)
    assert vr.valid, "growth after checkpoint must not invalidate the prefix"
    assert vr.checkpoint_coverage == "full"
