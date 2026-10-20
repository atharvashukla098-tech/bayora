"""Security: invalid signatures + prefix truncation vs stale checkpoint (D12)."""

from __future__ import annotations

from app.harness.adversary import disposable_copy, truncate_tail
from app.ledger.chain import Ledger
from app.ledger.checkpoints import checkpoint_at_head, verify_checkpoint
from app.ledger.keys import load_or_generate_keypair
from app.ledger.verifier import verify_ledger
from app.schema import Component, EventType, Finding


def _populate(ledger: Ledger, n=5, run_id="run-sr01") -> None:
    for i in range(n):
        ledger.append(EventType.REQUEST_INGRESS, Component.BROKER,
                      run_id=run_id, detail={"prompt_digest": f"{i:016x}"})


def test_forged_checkpoint_fails(tmp_path, fixed_clock, dev_key):
    priv, key_id, pub = dev_key
    led = Ledger(tmp_path / "run-sr1", fixed_clock)
    _populate(led)
    cp = checkpoint_at_head(led, priv, key_id, fixed_clock)
    # corrupt the signature bytes
    forged = cp.model_copy(update={"signature": (cp.signature or "")[:-4] + "AAAA"})
    assert not verify_checkpoint(forged, pub)


def test_prefix_truncation_vs_stale_checkpoint_detected(tmp_path, fixed_clock,
                                                        dev_key):
    """D12: checkpoint at height 5, then truncate the ledger to 3 — the
    checkpoint does not vouch for the shorter chain; BOTH findings appear."""
    priv, key_id, pub = dev_key
    led = Ledger(tmp_path / "run-sr2", fixed_clock)
    _populate(led, 5)
    cp = checkpoint_at_head(led, priv, key_id, fixed_clock)
    copy = disposable_copy(led.path, tmp_path / "c-sr2")
    truncate_tail(copy, 2)
    vr = verify_ledger(copy, checkpoint=cp, trusted_public_key=pub)
    assert not vr.valid
    assert Finding.BELOW_CHECKPOINT in vr.findings
    assert Finding.CHECKPOINT_PREFIX_MISMATCH in vr.findings
    assert vr.checkpoint_coverage == "prefix"


def test_valid_checkpoint_passes_full_coverage(tmp_path, fixed_clock, dev_key):
    priv, key_id, pub = dev_key
    led = Ledger(tmp_path / "run-sr3", fixed_clock)
    _populate(led, 5)
    cp = checkpoint_at_head(led, priv, key_id, fixed_clock)
    vr = verify_ledger(led.path, checkpoint=cp, trusted_public_key=pub)
    assert vr.valid and vr.checkpoint_coverage == "full"


def test_rotated_key_invalidates_signatures(tmp_path, fixed_clock):
    """L4: a regenerated key invalidates old signatures (documented trust limit)."""
    priv1, kid1, pub1 = load_or_generate_keypair(tmp_path / "k1")
    led = Ledger(tmp_path / "run-sr4", fixed_clock)
    _populate(led, 5)
    cp = checkpoint_at_head(led, priv1, kid1, fixed_clock)
    assert verify_checkpoint(cp, pub1)
    # regenerate in the SAME dir => new key
    priv2, kid2, pub2 = load_or_generate_keypair(tmp_path / "k1")
    if pub2.public_bytes_raw() != pub1.public_bytes_raw():
        assert not verify_checkpoint(cp, pub2), \
            "an old signature must not verify under a rotated key"


def test_no_trusted_key_supplied_fails_closed(tmp_path, fixed_clock, dev_key):
    """A signed checkpoint without the trusted key => CHECKPOINT_SIG_INVALID."""
    priv, key_id, _pub = dev_key
    led = Ledger(tmp_path / "run-sr5", fixed_clock)
    _populate(led, 5)
    cp = checkpoint_at_head(led, priv, key_id, fixed_clock)
    vr = verify_ledger(led.path, checkpoint=cp, trusted_public_key=None)
    assert not vr.valid
    assert Finding.CHECKPOINT_SIG_INVALID in vr.findings
