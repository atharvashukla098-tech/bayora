"""Section 6 — interactive tamper simulator.

Invokes the real ``scripts/tamper_demo.py`` against a disposable copy of
the selected run's ledger. Every hash, verdict, and return code shown
here is parsed from that execution's actual output — nothing is
hardcoded. The original evidence ledger is never modified (the script
re-verifies it afterwards and prints UNMODIFIED).
"""

from __future__ import annotations

import streamlit as st

from app.dashboard.artifact_client import ArtifactClient, BackendUnavailable
from app.dashboard.models import badge_color, redact


def render(client: ArtifactClient) -> None:
    st.caption(
        "Corrupts a disposable copy of the selected run's ledger — the "
        "original evidence ledger is never modified. All values below are "
        "read from the live verifier run, not hardcoded."
    )

    try:
        client.health()
        available = True
        unavailable_reason = ""
    except BackendUnavailable as exc:
        available = False
        unavailable_reason = str(exc)[:160]

    col_btn, col_note = st.columns([4, 8])
    with col_btn:
        clicked = st.button(
            "Corrupt a Disposable Ledger Copy",
            type="primary",
            disabled=not available,
            help="Runs scripts/tamper_demo.py against a temporary ledger copy",
        )
    with col_note:
        if not available:
            st.caption(f"Demo requires run artifacts — {unavailable_reason}")

    if clicked:
        with st.spinner("Copying ledger, flipping one byte, running verifier…"):
            try:
                result = client.tamper_demo()
                st.session_state.tamper_result = result.model_dump()
            except (BackendUnavailable, Exception) as exc:
                st.session_state.tamper_result = None
                st.error(f"Tamper demo failed to execute: {exc}")

    result = st.session_state.get("tamper_result")
    if not result:
        st.caption("No tamper demonstration has been run in this session yet.")
        return

    rejected = (result.get("verifier_returncode") or 0) != 0

    row = st.columns([3, 3, 3, 3])
    with row[0]:
        st.badge(
            f"Original ledger: {result.get('original_ledger_status', 'UNKNOWN')}",
            color=badge_color(str(result.get("original_ledger_status", "UNKNOWN"))),
        )
    with row[1]:
        st.badge(
            "Disposable copy: "
            + ("CREATED" if result.get("copy_created") else "NOT CREATED"),
            color="green" if result.get("copy_created") else "red",
        )
    with row[2]:
        st.badge(
            "Original: UNMODIFIED" if result.get("original_unmodified")
            else "Original: UNKNOWN",
            color="green" if result.get("original_unmodified") else "gray",
        )
    with row[3]:
        st.metric(
            "Verifier return code",
            result.get("verifier_returncode")
            if result.get("verifier_returncode") is not None else "—",
        )

    if rejected:
        st.error(
            "[TAMPER REJECTED] Ledger integrity verification failed"
            + (
                f" at event #{result['modified_event']}."
                if result.get("modified_event") is not None else "."
            )
            + " The modified ledger does not match the expected hash chain."
        )
    elif result.get("verifier_returncode") is not None:
        st.success("Verifier accepted the disposable copy — no failure "
                   "detected. Investigate before trusting this ledger.")

    hash_cols = st.columns(2)
    with hash_cols[0]:
        st.caption("Expected hash (original chain)")
        st.code(redact(str(result.get("expected_hash") or "—")), language=None)
    with hash_cols[1]:
        st.caption("Computed hash (tampered copy)")
        st.code(redact(str(result.get("computed_hash") or "—")), language=None)

    if result.get("earliest_failure"):
        st.write(f"**Earliest detected failure:** event "
                 f"#{result['earliest_failure']}")
