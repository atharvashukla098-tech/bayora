"""Bayora — Forensic Dossier incident dashboard (pure Python, no HTML).

Replaces the previous dashboard with the dossier-themed UI. Layout:
case-file header → §5 live threat stream → incidents strip → §7
evaluation matrix → §6 tamper simulator → §8 signed attestation.
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

from app.config import load_config                      # noqa: E402
from app.dashboard.artifact_client import ArtifactClient  # noqa: E402
from app.dashboard.components import (                  # noqa: E402
    attestation_panel,
    containment_badges,
    event_stream,
    evaluation_matrix,
    tamper_panel,
)
from app.dashboard.models import badge_color            # noqa: E402
from app.harness.scenarios import build_catalogue       # noqa: E402

st.set_page_config(
    page_title="Bayora — AI Red-Teaming Case File",
    page_icon="\u2696\ufe0f",
    layout="wide",
)

# ---------------------------------------------------------------- sidebar
with st.sidebar:
    st.title("\u2696\ufe0f Bayora")
    st.caption("Zero-trust AI red-teaming — case controls")

    config_path = st.text_input(
        "Config path", value=str(ROOT / "config" / "config.example.yaml"))
    try:
        config = load_config(Path(config_path))
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
        run_options = ["(no runs yet — will allocate on first scene run)"]

    selected = st.selectbox("Case file (run)", run_options)
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
    poll_interval = st.slider(
        "Event poll interval (s)", 0.5, 5.0, 1.0, 0.5,
        help="Controlled refresh rate — keeps disk polling lightweight",
    )
    display_tz = st.selectbox("Display timezone", ["UTC", "local"], index=0)

    st.divider()
    st.caption(f"Case file run_id: `{client.state.run_id or 'none'}`")
    st.caption(f"Runs directory: `{config.ledger.runs_dir}`")

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
st.caption(
    "Zero-Trust AI Red-Teaming \u00b7 Runtime Containment \u00b7 "
    "Verifiable Security Evidence"
)
health = containment_badges.fetch_health(client)
containment_badges.header_badges(health)
st.divider()

# --------------------------------------------------- \u00a75 live threat stream
st.subheader("\u00a75\u2003Live Threat Interception")


@st.fragment(run_every=poll_interval)
def live_stream_section() -> None:
    event_stream.render(client, display_tz)


live_stream_section()
st.divider()

# ------------------------------------------------------------- incidents
st.subheader("Active & recent incidents")
st.caption(
    "Detected/blocked/redacted/errored outcomes recorded in the ledger "
    "tail — observed incidents, not verdicts; verdicts live in the matrix."
)
try:
    incidents = client.incidents()
except Exception:
    incidents = []
if incidents:
    st.dataframe(
        [
            {
                "Time (UTC)": str(i.get("ts", ""))[:19],
                "Scenario": i.get("scenario_id"),
                "Outcome": i.get("outcome"),
                "Reason": i.get("reason"),
                "Event": str(i.get("event_id", ""))[:12],
            }
            for i in incidents[-20:]
        ],
        width="stretch",
        hide_index=True,
    )
    for inc in incidents[-3:]:
        with st.expander(
            f"{str(inc.get('ts', ''))[:19]} · {inc.get('scenario_id')} · "
            f"{inc.get('outcome')}"
        ):
            st.json(inc)
else:
    st.info("No incidents recorded in the current run's ledger tail.")
st.divider()

# --------------------------------------------------- \u00a77 evaluation matrix
st.subheader("\u00a77\u2003Attacker-versus-Target Evaluation Matrix")
evaluation_matrix.render(client)
st.divider()

# ------------------------------------------------------ \u00a76 tamper simulator
st.subheader("\u00a76\u2003Interactive Tamper Simulator")
tamper_panel.render(client)
st.divider()

# ----------------------------------------------------- \u00a78 signed attestation
st.subheader("\u00a78\u2003Machine-Readable Signed Attestation")
attestation_panel.render(client)
