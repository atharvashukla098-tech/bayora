"""Security: the full-rehash attack (spec §6 step 4).

The strongest tamper: attacker edits an event AND recomputes every later
hash, producing a chain that is INTERNALLY CONSISTENT (hash linkage alone
reads VALID). The only thing that catches it is the signed checkpoint.
This is THE justification for Ed25519 checkpoints — if this test fails,
the product's core claim collapses.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

from app.harness.adversary import disposable_copy, rehash_chain
from app.ledger.chain import Ledger
from app.ledger.checkpoints import checkpoint_at_head
from app.ledger.verifier import verify_ledger
from app.schema import Component, EventType


def _build_signed_ledger(tmp_path, clock, keypair, n_events=8):
    """A valid ledger of n_events with a checkpoint signed at its head."""
    run_dir = tmp_path / "runs" / "run-rehash"
    led = Ledger(run_dir, clock)
    for i in range(n_events):
        led.append(EventType.REQUEST_INGRESS, Component.BROKER,
                   run_id="run-rehash", detail={"prompt_digest": f"{i:016x}"})
    checkpoint_at_head(led, keypair[0], keypair[1], clock)  # (priv, key_id)
    return led


def test_rehash_attack_chain_valid_but_checkpoint_rejects(
        tmp_path, fixed_clock, dev_key):
    """Edit event #3, recompute every later hash:

    1. the forged chain's hash-linkage ALONE must read VALID
       (that is what makes this the strongest attack), and
    2. verification against the signed checkpoint MUST reject it
       (CHECKPOINT_MISMATCH) — the signature is the detection layer.
    """
    led = _build_signed_ledger(tmp_path, fixed_clock, dev_key, n_events=8)
    original = led.path

    # locate the checkpoint sidecar the CLI would use
    from app.ledger.checkpoints import load_checkpoint
    checkpoint = load_checkpoint(original.parent)
    assert checkpoint is not None, "checkpoint_at_head must persist sidecar"

    # -- pre: the original is valid and the checkpoint seals the head --
    pre = verify_ledger(original, checkpoint=checkpoint,
                        trusted_public_key=dev_key[2])
    assert pre.valid

    copy = disposable_copy(original, tmp_path)
    info = rehash_chain(copy, event_index=3)

    # 1. the forged chain is internally consistent: linkage alone VALID
    linkage = verify_ledger(copy)
    assert linkage.valid, \
        "rehash_chain must forge an internally-consistent chain " \
        "(the attack's premise); weaker linkage failure = weaker demo"

    # 2. the sealed checkpoint catches what the chain cannot
    vr = verify_ledger(copy, checkpoint=checkpoint,
                       trusted_public_key=dev_key[2])
    assert not vr.valid
    assert "CHECKPOINT_MISMATCH" in [f.value for f in vr.findings]

    # sealed head ≠ forged head — the divergence is real, not cosmetic
    assert checkpoint.final_event_hash != info.computed_hash
    assert info.computed_hash != info.expected_hash

    # 3. the ORIGINAL is byte-untouched
    post = verify_ledger(original, checkpoint=checkpoint,
                         trusted_public_key=dev_key[2])
    assert post.valid


def test_rehash_via_script_matches_contract(tmp_path, fixed_clock, dev_key):
    """The CLI demo (tamper_demo.py --mode rehash) exits 1 (tampered copy
    rejected), prints the detection story, and leaves the original valid."""
    led = _build_signed_ledger(tmp_path, fixed_clock, dev_key, n_events=8)
    pub_pem = tmp_path / "keys" / "demo_public_key.pem"   # dev_key fixture dir
    proc = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "tamper_demo.py"),
         "--ledger", str(led.path), "--mode", "rehash", "--event", "3",
         "--public-key", str(pub_pem)],
        capture_output=True, text=True, timeout=120,
        cwd=str(ROOT),
    )
    out = (proc.stdout + proc.stderr).replace("\r", "")
    assert "TAMPER REJECTED" in out
    assert "CHECKPOINT_MISMATCH" in out
    assert "Hash-linkage result:    VALID" in out
    assert "UNMODIFIED (re-verified: VALID)" in out, \
        "the original ledger must provably survive the demo"
    assert proc.returncode == 1, "tampered copy rejected ⇒ non-zero exit"
