"""Security: tamper detection on disposable copies; original never altered."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

from app.harness.adversary import (
    delete_event, disposable_copy, flip_one_byte, reorder_events, truncate_tail,
)
from app.ledger.chain import Ledger
from app.ledger.verifier import verify_ledger
from app.schema import Component, EventType, Finding


def _populate(ledger: Ledger, n: int = 5, run_id="run-td01") -> None:
    for i in range(n):
        ledger.append(EventType.REQUEST_INGRESS, Component.BROKER,
                      run_id=run_id, detail={"prompt_digest": f"{i:016x}"})


def test_original_ledger_untouched_after_tamper_demo(tmp_path, fixed_clock,
                                                     dev_key):
    """Byte-compare pre/post + re-verify the original (spec §6 step 8)."""
    led = Ledger(tmp_path / "run-tamper0", fixed_clock)
    _populate(led, 6)
    before = led.path.read_bytes()

    copy = disposable_copy(led.path, tmp_path / "copydir")
    flip_one_byte(copy, 3)
    vr = verify_ledger(copy)
    assert not vr.valid

    assert led.path.read_bytes() == before, "the ORIGINAL was modified!"
    assert verify_ledger(led.path).valid


def test_tamper_demo_script_output_shape(tmp_path, fixed_clock):
    """scripts/tamper_demo.py matches the spec §6 template with real hashes."""
    led = Ledger(tmp_path / "run-tamper1", fixed_clock)
    _populate(led, 6, run_id="run-td-script")
    proc = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "tamper_demo.py"),
         "--ledger", str(led.path), "--mode", "byte", "--event", "3"],
        capture_output=True, text=True, timeout=120)
    out = proc.stdout
    assert proc.returncode == 1, "verifier failure must exit non-zero"
    for needle in ("BAYORA LEDGER TAMPER DEMONSTRATION",
                   "Original ledger:", "Disposable copy:",
                   "Modified event:", "Expected hash:", "Computed hash:",
                   "[TAMPER REJECTED]", "UNMODIFIED"):
        assert needle in out, f"missing template line: {needle}"
    # expected != computed, both real 64-hex values
    import re
    hashes = re.findall(r"([0-9a-f]{64})", out)
    assert len(hashes) >= 2 and hashes[0] != hashes[1]


def test_tamper_demo_other_modes(tmp_path, fixed_clock, dev_key):
    led = Ledger(tmp_path / "run-tamper2", fixed_clock)
    _populate(led, 6, run_id="run-td-modes")
    # structural tampers are detected by the chain alone
    for mode in ("delete", "reorder"):
        copy = disposable_copy(led.path, tmp_path / f"c-{mode}")
        if mode == "delete":
            delete_event(copy, 2)
        else:
            reorder_events(copy, 2, 4)
        vr = verify_ledger(copy)
        assert not vr.valid, f"{mode} tamper not detected"
    # truncation is detectable ONLY vs a trusted checkpoint (honest limit L3):
    # without one, a chain-consistent prefix is indistinguishable from a full ledger
    copy = disposable_copy(led.path, tmp_path / "c-truncate")
    truncate_tail(copy, 2)
    vr_no_cp = verify_ledger(copy)
    assert vr_no_cp.valid and vr_no_cp.checkpoint_coverage == "none", \
        "truncation must NOT be claimed detectable without a checkpoint"
    # WITH the checkpoint refreshed at the head, it is detected (D12)
    from app.ledger.checkpoints import checkpoint_at_head
    priv, key_id, pub = dev_key
    cp = checkpoint_at_head(led, priv, key_id, fixed_clock)
    vr_cp = verify_ledger(copy, checkpoint=cp, trusted_public_key=pub)
    assert not vr_cp.valid, "truncation must be detected against the checkpoint"
    assert verify_ledger(led.path).valid, "original must remain VALID"


def test_byte_flip_reports_earliest_failure(tmp_path, fixed_clock):
    led = Ledger(tmp_path / "run-tamper3", fixed_clock)
    _populate(led, 5)
    copy = disposable_copy(led.path, tmp_path / "c3")
    flip_one_byte(copy, 2)
    vr = verify_ledger(copy)
    assert vr.earliest_failure_seq == 2, "the flipped event is the earliest failure"


def test_forged_checkpoint_rejected_end_to_end(tmp_path, fixed_clock, dev_key):
    from app.harness.adversary import forge_checkpoint_signature
    from app.ledger.checkpoints import checkpoint_at_head, verify_checkpoint

    priv, key_id, pub = dev_key
    led = Ledger(tmp_path / "run-tamper4", fixed_clock)
    _populate(led, 5)
    cp = checkpoint_at_head(led, priv, key_id, fixed_clock)
    forged = forge_checkpoint_signature(cp)
    assert not verify_checkpoint(forged, pub)
    vr = verify_ledger(led.path, checkpoint=forged, trusted_public_key=pub)
    assert not vr.valid
    assert Finding.CHECKPOINT_SIG_INVALID in vr.findings
