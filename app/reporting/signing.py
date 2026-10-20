"""Canonical report bytes + Ed25519 signing/verification (blueprint §10.3).

Signed fields are exactly: everything except ``report_signature.signature``
(the ``key_id`` inside report_signature IS signed — it identifies which key
must verify; so are verification_steps, limitations, and status).

The ACCEPT rule (the demo gate): accept iff recorded_status in
{VERIFIED, VERIFIED_WITH_LIMITATIONS} AND (signature valid OR signing
disabled by config with the recorded limitation). A VERIFIED* report with an
absent/invalid signature while signing is enabled is REJECTED — this is what
makes the report signature load-bearing despite status never reading it (D15).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from pydantic import BaseModel, ConfigDict

from app.config import BayoraConfig
from app.reporting.report import AuditReport


def canonical_report_bytes(report: AuditReport) -> bytes:
    """Fixed top-level field order, separators=(",",":"), ensure_ascii=False.

    Excludes report_signature.signature; the nested report_signature object
    is represented WITHOUT its signature key (key_id remains — it is signed).
    """
    data = report.model_dump(mode="json")
    signature_obj = {k: v for k, v in data["report_signature"].items()
                      if k != "signature"}
    fields = ("schema_version", "platform", "platform_version", "run_id",
              "verification_timestamp", "target_mode", "environment",
              "assertions", "scenario_results", "ledger", "verification_steps",
              "limitations", "status", "report_signature")
    data["report_signature"] = signature_obj
    payload = {field: data[field] for field in fields}
    return json.dumps(payload, separators=(",", ":"), sort_keys=False,
                      ensure_ascii=False).encode("utf-8")


def sign_report(report: AuditReport, private_key: Ed25519PrivateKey) -> AuditReport:
    sig = private_key.sign(canonical_report_bytes(report))
    import base64
    new_sig = report.model_copy(update={
        "report_signature": report.report_signature.model_copy(
            update={"signature": base64.b64encode(sig).decode("ascii")})})
    return new_sig


def verify_report_signature(report: AuditReport,
                            public_key: Optional[Ed25519PublicKey]) -> bool:
    """False on any error — never raises to the caller."""
    import base64
    if public_key is None:
        return False
    sig = report.report_signature.signature
    if not sig:
        return False
    try:
        public_key.verify(base64.b64decode(sig), canonical_report_bytes(report))
        return True
    except Exception:
        return False


class ReportVerification(BaseModel):
    model_config = ConfigDict(extra="forbid")
    signature_valid: Optional[bool]   # None = not_applicable (signing disabled)
    ledger_chain_valid: bool
    checkpoint_valid: bool
    recorded_status: str
    accepted: bool
    findings: list[str]


def verify_report_file(path: Path, public_key: Optional[Ed25519PublicKey], *,
                       config: BayoraConfig) -> ReportVerification:
    """Independent verify path: signature over canonical bytes AND a fresh
    ledger re-verification from scratch, AND a binding check that the
    freshly-verified chain actually matches the SIGNED ledger block inside
    the report. Applies the ACCEPT rule."""
    from app.ledger.verifier import verify_ledger
    from app.schema import ReportStatus

    findings: list[str] = []
    report = AuditReport.model_validate_json(
        Path(path).read_text(encoding="utf-8"))

    # signature check
    if config.report.signing_enabled:
        sig_ok = verify_report_signature(report, public_key)
        if not sig_ok:
            findings.append("report signature absent or invalid")
    else:
        sig_ok = None
        if ("report signing disabled by config" not in report.limitations):
            findings.append("signing disabled but limitation not recorded")

    # ledger re-verification from scratch
    ledger_path = Path(report.ledger_path)
    checkpoint = None
    if report.ledger.checkpoint_present:
        from app.ledger.checkpoints import load_checkpoint
        checkpoint = load_checkpoint(ledger_path.parent)
    vr = verify_ledger(ledger_path, checkpoint=checkpoint,
                       trusted_public_key=public_key)
    chain_ok = vr.valid
    if not chain_ok:
        findings.append(f"ledger re-verification failed: "
                        f"{[f.value for f in vr.findings]}")

    # Read the referenced chain once for the binding checks below (raw JSON
    # lines — independent of the writer, same spirit as the verifier).
    import json as _json
    chain_event_ids: set = set()
    chain_hash_by_seq: dict = {}
    with ledger_path.open("r", encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            try:
                obj = _json.loads(line)
            except Exception:
                continue
            if isinstance(obj, dict):
                if obj.get("event_id"):
                    chain_event_ids.add(obj["event_id"])
                seq = obj.get("seq")
                if isinstance(seq, int):
                    chain_hash_by_seq[seq] = obj.get("hash")

    # BINDING CHECK (attack regression): the freshly-verified chain must be
    # the chain the SIGNED report attests. Height-only binding is defeated
    # by any same-height foreign ledger (deterministic pipelines produce
    # equal heights), so the check binds FOUR signed facts:
    #   1. run identity  — the chain's run_id must equal the report's run_id
    #   2. height        — checked_height == signed block_height
    #   3. checkpoint    — attested checkpoint_seq matches the sidecar AND
    #                      the sidecar's signed final_event_hash matches the
    #                      referenced chain's event at that seq AND the
    #                      sidecar's ledger_id matches the chain's run_id
    #   4. evidence      — every attested evidence_event_id exists in the
    #                      referenced chain
    # ledger_path is an unsigned provenance pointer; with these checks a
    # re-pointed report can never re-bind its attestation to foreign
    # evidence even when heights and checkpoint seqs coincide.
    signed = report.ledger
    if chain_ok:
        if vr.run_id is not None and vr.run_id != report.run_id:
            findings.append(
                f"ledger binding failed: report run_id={report.run_id} but "
                f"the referenced chain belongs to run {vr.run_id}")
        if vr.checked_height != signed.block_height:
            findings.append(
                f"ledger binding failed: signed block_height="
                f"{signed.block_height} but the referenced chain has height "
                f"{vr.checked_height}")
        if signed.checkpoint_present and checkpoint is None:
            findings.append(
                "ledger binding failed: the report attests a signed "
                "checkpoint but the referenced run has none")
        if signed.checkpoint_present and checkpoint is not None:
            if checkpoint.checkpoint_seq != (signed.checkpoint_seq or -1):
                findings.append(
                    f"ledger binding failed: signed checkpoint_seq="
                    f"{signed.checkpoint_seq} but the referenced run's "
                    f"checkpoint covers seq={checkpoint.checkpoint_seq}")
            else:
                # content binding: the SIGNED final_event_hash must equal the
                # hash of the referenced chain's event at checkpoint_seq (the
                # sidecar alone could be re-signed for a foreign chain)
                ref_hash = chain_hash_by_seq.get(checkpoint.checkpoint_seq)
                if (signed.checkpoint_final_event_hash is not None
                        and ref_hash != signed.checkpoint_final_event_hash):
                    findings.append(
                        f"ledger binding failed: signed "
                        f"checkpoint_final_event_hash does not match event "
                        f"#{checkpoint.checkpoint_seq} of the referenced "
                        f"chain")
                if ref_hash is None or ref_hash != checkpoint.final_event_hash:
                    findings.append(
                        f"ledger binding failed: the signed checkpoint's "
                        f"final_event_hash does not match event "
                        f"#{checkpoint.checkpoint_seq} of the referenced "
                        f"chain")
                if (checkpoint.ledger_id not in (None, "unknown")
                        and vr.run_id is not None
                        and checkpoint.ledger_id != vr.run_id):
                    findings.append(
                        f"ledger binding failed: checkpoint ledger_id="
                        f"{checkpoint.ledger_id} but the referenced chain "
                        f"belongs to run {vr.run_id}")
        # every attested evidence id must exist in the referenced chain
        missing_ids = [
            eid for row in report.scenario_results
            for eid in row.evidence_event_ids if eid not in chain_event_ids]
        if missing_ids:
            findings.append(
                f"ledger binding failed: {len(missing_ids)} attested "
                f"evidence event id(s) absent from the referenced chain "
                f"(first: {missing_ids[0]})")
        if signed.checkpoint_present and (checkpoint is None
                                          or public_key is None):
            cp_ok = False
        else:
            cp_ok = (signed.checkpoint_signature_valid
                     and (checkpoint is None or vr.checkpoint_coverage != "none"))
        # authoritative checkpoint validity: fresh verify with trusted key
        if checkpoint is not None and public_key is not None:
            from app.ledger.checkpoints import verify_checkpoint
            cp_ok = verify_checkpoint(checkpoint, public_key)
    else:
        cp_ok = False

    recorded = report.status
    accepted_status = recorded in (ReportStatus.VERIFIED,
                                   ReportStatus.VERIFIED_WITH_LIMITATIONS)
    accepted_sig = (sig_ok is True) or (
        config.report.signing_enabled is False
        and "report signing disabled by config" in report.limitations)
    accepted = accepted_status and chain_ok and not findings and accepted_sig

    return ReportVerification(
        signature_valid=sig_ok,
        ledger_chain_valid=chain_ok,
        checkpoint_valid=cp_ok,
        recorded_status=recorded.value if hasattr(recorded, "value") else str(recorded),
        accepted=accepted,
        findings=findings)
