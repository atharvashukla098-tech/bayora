"""Bayora — Forensic Dossier incident dashboard (pure Python, no HTML).

Layout: case-file header → live threat stream → 3D evidence chain →
evaluation matrix → tamper simulator → signed attestation.

Data comes exclusively from run artifacts on disk via ArtifactClient —
nothing is fabricated, and Docker-dependent controls never claim PASS.

Launch (from the repo root):  streamlit run app/dashboard/app.py
"""

from __future__ import annotations

import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from app.config import load_config                         # noqa: E402
from app.dashboard.artifact_client import ArtifactClient  # noqa: E402
from app.dashboard.components import (                     # noqa: E402
    attestation_panel,
    containment_badges,
    evidence_chain,
    event_stream,
    evaluation_matrix,
    tamper_panel,
)
from app.harness.scenarios import build_catalogue          # noqa: E402

st.set_page_config(
    page_title="Bayora — AI Red-Teaming Case File",
    page_icon="\u2696\ufe0f",
    layout="wide",
)

# Fixed, conservative refresh rate — the stream polls disk artifacts, so a
# slow tick is plenty and never overwhelms anything.
POLL_SECONDS = 1.0

# ---------------------------------------------------------------- sidebar
with st.sidebar:
    st.title("\u2696\ufe0f Bayora")

    try:
        config = load_config(None)          # config/config.yaml → example → defaults
        config_error = None
    except Exception as exc:
        config = None
        config_error = str(exc)[:200]

    if config_error:
        st.error(f"Config failed closed: {config_error}")
        st.stop()

    probe = ArtifactClient(config)
    history = probe.state.run_history()
    run_options = [r["run_id"] for r in reversed(history)]
    if not run_options:
        run_options = ["(no runs yet — one is allocated on first scene run)"]

    selected = st.selectbox("Case file", run_options)
    run_id = selected if not selected.startswith("(no runs") else None

    catalogue = build_catalogue()
    scenario_label = st.selectbox(
        "Scenario focus",
        [f"{spec.scenario_id} — {spec.name}" for spec in catalogue],
    )
    scenario_id = scenario_label.split(" \u2014 ")[0]

    client = ArtifactClient(config, run_id=run_id)

    if st.button(
        "Run scene through pipeline",
        type="primary",
        help="Dispatches the mapped offline demo scene via "
             "scripts/run_demo_pipeline.py; every step travels through the "
             "policy broker, ledger, and verifier — never direct to target",
    ):
        effective_run = run_id or (
            f"manual-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}-"
            f"{uuid.uuid4().hex[:6]}"
        )
        with st.spinner(f"Running scene for {scenario_id}…"):
            try:
                result = client.trigger_run(effective_run, scenario_id)
                st.session_state.manual_run_id = effective_run
                st.toast(f"Scene {result['scene']} completed for "
                         f"{effective_run}", icon="\u26a1")
            except Exception as exc:
                st.error(f"Scene run failed: {exc}")

    st.divider()
    st.markdown("**Environment & containment**")
    with st.expander("Verified containment states"):
        st.caption(
            "A control shows VERIFIED only when an executed assertion "
            "established the expected behavior. Config presence alone never "
            "qualifies; Docker-dependent controls report SKIPPED with the "
            "recorded reason."
        )
        containment_badges.containment_panel(client)

# ----------------------------------------------------------------- header
st.title("Bayora")
st.caption("Zero-Trust AI Red-Teaming · Runtime Containment · "
           "Verifiable Security Evidence")
containment_badges.header_badges(containment_badges.fetch_health(client))
st.divider()

# ---------------------------------------------------- live threat stream
st.subheader("Live Threat Interception")


@st.fragment(run_every=POLL_SECONDS)
def live_stream_section() -> None:
    event_stream.render(client)


live_stream_section()
st.divider()

# ------------------------------------------------------- 3D evidence chain
st.subheader("Evidence Chain")
evidence_chain.render(client)
st.divider()

# ------------------------------------------------------ evaluation matrix
st.subheader("Attacker-versus-Target Evaluation Matrix")
evaluation_matrix.render(client)
st.divider()

# ------------------------------------------------------- tamper simulator
st.subheader("Interactive Tamper Simulator")
tamper_panel.render(client)
st.divider()

# ----------------------------------------------------- signed attestation
st.subheader("Machine-Readable Signed Attestation")
attestation_panel.render(client)
