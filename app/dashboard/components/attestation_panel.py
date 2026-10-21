"""Section 8 — machine-readable signed attestation panel.

Two independent views, shown side by side:

* **Live ledger integrity** — state.py's STALE-aware verification of the
  run's ledger as it exists on disk right now.
* **Signed report** — the recorded ``audit_report.json`` whose status is
  recomputed in this UI (``compute_report_status``) rather than trusted
  from the report's own ``status`` field; a disagreement is surfaced.
"""

from __future__ import annotations

import json

import streamlit as st

from app.dashboard.artifact_client import ArtifactClient, BackendUnavailable
from app.dashboard.models import (
    badge_color,
    compute_report_status,
    redact,
    redact_obj,
)


def _integrity_strip(client: ArtifactClient) -> None:
    integ = client.integrity()
    verification = str(integ.get("verification", "NOT RUN"))
    cols = st.columns(5)
    with cols[0]:
        st.metric("Block height", integ.get("block_height", 0))
    with cols[1]:
        st.metric("Chain verification", verification.split(" (")[0])
    with cols[2]:
        st.metric("Checked at height", integ.get("as_of_height") or "—")
    with cols[3]:
        cp = str(integ.get("checkpoint_status", "ABSENT"))
        st.metric("Checkpoint", cp.split(" (")[0])
    with cols[4]:
        st.metric("Coverage", integ.get("checkpoint_coverage", "none"))
    if integ.get("stale"):
        st.warning(
            "STALE — the last chain verification predates the current block "
            "height; a previously verified ledger never displays VERIFIED "
            "after the chain grows. Re-verify before trusting this state."
        )
    st.caption(
        f"Head hash: `{str(integ.get('head_hash') or 'none')[:24]}` · "
        f"last verified at "
        f"{str(integ.get('last_verified_at') or 'never')[:19]}"
    )


def render(client: ArtifactClient) -> None:
    st.markdown("**Live ledger integrity** (re-read from disk)")
    try:
        _integrity_strip(client)
    except Exception as exc:  # integrity must never crash the section
        st.caption(f"Integrity could not be read: {exc}")

    st.divider()
    st.markdown("**Signed attestation report**")

    try:
        report = client.report()
    except BackendUnavailable as exc:
        st.badge("Status: NOT_VERIFIED", color=badge_color("NOT_EVALUATED"))
        st.warning(
            "Attestation report unavailable — no independent verification "
            f"could be executed. ({exc})"
        )
        return

    computed = compute_report_status(report)
    claimed = str(report.get("status") or "NOT_VERIFIED")

    st.badge(f"Status: {computed.value}", color=badge_color(computed.value))
    if claimed != computed.value:
        st.warning(
            f"Report claims `{claimed}` but independent UI-side computation "
            f"over the same report says `{computed.value}`. "
            "Trusting the stricter result."
        )

    assertions = report.get("assertions") or {}
    ledger = report.get("ledger") or {}
    sig = report.get("report_signature") or {}
    env = report.get("environment") or {}

    m = st.columns(6)
    total = assertions.get("total", 0)
    with m[0]:
        st.metric("Assertions passed", f"{assertions.get('passed', 0)}/{total}")
    with m[1]:
        st.metric("Failed", assertions.get("failed", 0))
    with m[2]:
        st.metric("Errors / Skipped",
                  f"{assertions.get('errors', 0)} / {assertions.get('skipped', 0)}")
    with m[3]:
        st.metric("Not evaluated", assertions.get("not_evaluated", 0))
    with m[4]:
        st.metric("Ledger height", ledger.get("block_height", 0))
    with m[5]:
        st.metric("Target mode", str(report.get("target_mode", "—")))

    checks = st.columns(3)
    with checks[0]:
        st.badge(
            "Ledger chain: " + ("VALID" if ledger.get("chain_valid") else "INVALID"),
            color=badge_color("VALID" if ledger.get("chain_valid") else "INVALID"),
        )
    with checks[1]:
        ck_present = bool(ledger.get("checkpoint_present"))
        st.badge(
            "Checkpoint: " + ("PRESENT" if ck_present else "ABSENT"),
            color="blue" if ck_present else "gray",
        )
    with checks[2]:
        ck_valid = bool(ledger.get("checkpoint_signature_valid"))
        st.badge(
            "Checkpoint signature: " + ("VALID" if ck_valid else "INVALID"),
            color=badge_color("VALID" if ck_valid else "INVALID"),
        )

    steps = report.get("verification_steps") or []
    if steps:
        step_cols = st.columns(len(steps))
        for col, step in zip(step_cols, steps):
            result = str(step.get("result", "not_possible"))
            col.badge(
                f"{step.get('name', '?')}: {result}",
                color=badge_color(
                    {"pass": "VALID", "fail": "INVALID"}.get(result, "UNKNOWN")
                ),
                help=str(step.get("evidence", ""))[:200],
            )

    limitations = report.get("limitations") or []
    st.caption(
        f"Report schema {report.get('schema_version', '?')} · "
        f"run_id {report.get('run_id', '?')} · "
        f"signed with key_id `{sig.get('key_id', '?')}` "
        f"({sig.get('algorithm', '?')}) · "
        f"verification timestamp {report.get('verification_timestamp', '?')} · "
        f"offline={env.get('offline_mode', '?')} · "
        f"docker={env.get('docker_available', '?')}"
    )
    if limitations:
        for lim in limitations:
            st.caption(f"Limitation: {lim}")
    st.caption(
        "Signature covers the canonical report fields excluding "
        "`report_signature` itself; the trusted public key is published "
        "separately (keys/demo_public_key.pem). A signature proves the "
        "report matches the signing key — not the truth of every event."
    )

    with st.expander("Signed report (audit_report.json)"):
        st.json(redact_obj(report))

    with st.expander("Canonical signed payload (as computed by the verifier)"):
        signed_view = {k: v for k, v in report.items()
                       if k != "report_signature"}
        st.code(
            redact(json.dumps(signed_view, indent=2, sort_keys=True,
                              separators=(",", ": "))),
            language="json",
        )
