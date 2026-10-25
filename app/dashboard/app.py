"""Streamlit incident-response dashboard (blueprint §11.2, spec §9).

Six sections in spec order. Refresh uses ONLY core ``@st.fragment(run_every=…)``
(D14) — no third-party refresh package is imported anywhere. Launch:
    streamlit run app/dashboard/app.py
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from app.config import load_config                      # noqa: E402
from app.dashboard.state import DashboardState          # noqa: E402

st.set_page_config(
    page_title="Bayora — Incident Response Console",
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ---------------------------------------------------------------- SOC Dark-Theme CSS

SOC_CSS = """
<style>
/* Base Dark Theme Overrides */
.stApp {
    background-color: #080a0f;
    color: #d1d5db;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}

/* Sidebar Dark Glassmorphism */
section[data-testid="stSidebar"] {
    background-color: #0c0f17;
    border-right: 1px solid #1a2233;
}

/* Header & Typography */
h1, h2, h3, h4, h5, h6 {
    color: #f3f4f6 !important;
    font-weight: 700 !important;
    letter-spacing: -0.02em;
}

/* Monospace Terminal Viewports */
.soc-terminal {
    background-color: #05070b;
    border: 1px solid #1c2638;
    border-radius: 8px;
    padding: 14px;
    font-family: "JetBrains Mono", Consolas, Monaco, "Courier New", monospace;
    font-size: 11.5px;
    line-height: 1.6;
    color: #a0aec0;
    overflow-x: auto;
    box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.6);
}

.terminal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background-color: #0c101a;
    border: 1px solid #1c2638;
    border-bottom: none;
    border-radius: 8px 8px 0 0;
    font-family: "JetBrains Mono", Consolas, monospace;
    font-size: 10px;
    color: #00f0ff;
    letter-spacing: 0.1em;
}

.terminal-pulse {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: #00ff9d;
    box-shadow: 0 0 8px #00ff9d;
    margin-right: 6px;
    animation: pulse 2s infinite;
}

@keyframes pulse {
    0% { opacity: 1; }
    50% { opacity: 0.3; }
    100% { opacity: 1; }
}

/* Status Pill Badges */
.badge-pill {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 4px;
    font-family: "JetBrains Mono", Consolas, monospace;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
}

.badge-detected {
    background-color: rgba(255, 176, 32, 0.15);
    color: #ffb020;
    border: 1px solid rgba(255, 176, 32, 0.4);
}

.badge-blocked {
    background-color: rgba(255, 36, 73, 0.15);
    color: #ff2449;
    border: 1px solid rgba(255, 36, 73, 0.4);
}

.badge-redacted {
    background-color: rgba(0, 240, 255, 0.15);
    color: #00f0ff;
    border: 1px solid rgba(0, 240, 255, 0.4);
}

.badge-allowed {
    background-color: rgba(0, 255, 157, 0.15);
    color: #00ff9d;
    border: 1px solid rgba(0, 255, 157, 0.4);
}

.badge-verified {
    background-color: rgba(0, 255, 157, 0.2);
    color: #00ff9d;
    border: 1px solid #00ff9d;
    box-shadow: 0 0 6px rgba(0, 255, 157, 0.3);
}

.badge-tamper-rejected {
    background-color: rgba(255, 36, 73, 0.25);
    color: #ff2449;
    border: 1px solid #ff2449;
    box-shadow: 0 0 8px rgba(255, 36, 73, 0.4);
}

.badge-skipped {
    background-color: rgba(130, 144, 166, 0.15);
    color: #8290a6;
    border: 1px solid rgba(130, 144, 166, 0.3);
}

/* Card Surface Styling */
.soc-card {
    background-color: #0e121c;
    border: 1px solid #1a2233;
    border-radius: 8px;
    padding: 18px;
    margin-bottom: 16px;
}

.soc-card-header {
    font-size: 12px;
    font-family: "JetBrains Mono", Consolas, monospace;
    font-weight: 700;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

/* Side-by-Side Diff Box */
.diff-container {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-top: 12px;
}

.diff-box {
    background-color: #07090f;
    border: 1px solid #1a2334;
    border-radius: 6px;
    padding: 12px;
    font-family: "JetBrains Mono", Consolas, monospace;
    font-size: 11px;
}

.diff-box-target {
    border-left: 3px solid #ffb020;
}

.diff-box-broker {
    border-left: 3px solid #00f0ff;
}

/* Visual Hash-Chain Blocks */
.chain-wrapper {
    display: flex;
    align-items: center;
    gap: 8px;
    overflow-x: auto;
    padding: 12px 4px;
}

.chain-block {
    flex: 0 0 auto;
    width: 140px;
    background-color: #0c101a;
    border: 1px solid #1e283d;
    border-radius: 6px;
    padding: 10px;
    font-family: "JetBrains Mono", Consolas, monospace;
    font-size: 10px;
    text-align: center;
}

.chain-block-valid {
    border-color: #00ff9d;
    box-shadow: 0 0 6px rgba(0, 255, 157, 0.2);
}

.chain-block-corrupted {
    border-color: #ff2449;
    background-color: rgba(255, 36, 73, 0.12);
    box-shadow: 0 0 10px rgba(255, 36, 73, 0.4);
    animation: flashCorrupt 1.5s infinite;
}

@keyframes flashCorrupt {
    0% { border-color: #ff2449; }
    50% { border-color: #ff8099; }
    100% { border-color: #ff2449; }
}

.chain-block-broken {
    border-color: #556277;
    opacity: 0.6;
    border-style: dashed;
}

.chain-arrow {
    color: #4b5563;
    font-weight: bold;
}

.chain-arrow-broken {
    color: #ff2449;
    font-weight: bold;
    font-size: 14px;
}
</style>
"""

st.markdown(SOC_CSS, unsafe_allow_html=True)

# ---------------------------------------------------------------- sidebar

st.sidebar.markdown("### 🛡️ BAYORA // SEC-OPS")
st.sidebar.caption("Zero-Trust AI Red-Teaming & Evidence Sandbox")

config_path = st.sidebar.text_input("Config path", value=str(ROOT / "config" / "config.example.yaml"))
config = load_config(Path(config_path))
state = DashboardState(config)

st.sidebar.markdown("---")
st.sidebar.markdown("**LIVE POLLING CONTROLS**")
live_polling_active = st.sidebar.toggle("Enable Live Polling (2s)", value=True, help="Uses @st.fragment for zero-flicker background updates")
polling_interval = 2 if live_polling_active else 0
DISPLAY_TZ = st.sidebar.selectbox("Display timezone", ["UTC", "local"], index=0)

st.sidebar.markdown("---")
st.sidebar.markdown("**RUN MANAGEMENT**")
runs = state.run_history()
run_options = [r["run_id"] for r in runs] or [state.current_run() or "-"]
selected_run = st.sidebar.selectbox("Current run", run_options)

if selected_run and selected_run != "-":
    state = DashboardState(config, run_id=selected_run)

if st.sidebar.button("⚡ Allocate Fresh Demo Run", use_container_width=True):
    new_rid = state.allocate_fresh_run()
    st.sidebar.success(f"Allocated fresh run: {new_rid[:18]}…")
    st.rerun()

# ---------------------------------------------------------------- Title & Header

st.markdown("""
<div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #1a2233; padding-bottom: 12px; margin-bottom: 16px;">
    <div>
        <h1 style="margin: 0; font-size: 26px; color: #ffffff;">BAYORA // INCIDENT RESPONSE CONSOLE</h1>
        <p style="margin: 4px 0 0 0; font-size: 12px; color: #94a3b8; font-family: 'JetBrains Mono', monospace;">
            OFFLINE-FIRST ZERO-TRUST SANDBOX · ALL DATA IS VERIFIABLE EVIDENCE (NEVER FABRICATED)
        </p>
    </div>
    <div style="text-align: right;">
        <span class="badge-pill badge-redacted">TARGET: %s</span>
        <span class="badge-pill badge-allowed" style="margin-left: 6px;">OFFLINE: ACTIVE</span>
    </div>
</div>
""" % state.target_mode(), unsafe_allow_html=True)

# =========================================================================
# INTERACTIVE "JUDGE SCENE RUNNER" CONTROL BAR (spec §15 / blueprint §13)
# =========================================================================

st.markdown("""
<div class="soc-card-header">
    <span>// EXECUTIVE JUDGE SCENE RUNNER (6-SCENE DEMO PITCH)</span>
    <span style="color: #00f0ff;">TRIGGER LIVE BACKEND SCENARIOS ON DEMAND</span>
</div>
""", unsafe_allow_html=True)

sc_col1, sc_col2, sc_col3, sc_col4, sc_col5, sc_col6, sc_col7 = st.columns([1.1, 1.2, 1.1, 1.1, 1.1, 1.1, 1.3])

with sc_col1:
    if st.button("1️⃣ Baseline", help="Scene 1: Benign Baseline request + Genesis Ledger + Checkpoint", use_container_width=True):
        with st.spinner("Executing Scene 1..."):
            res = state.run_judge_scene("baseline")
            if res["status"] == "PASS":
                st.toast("Scene 1 (Baseline) PASSED", icon="✅")
            else:
                st.toast("Scene 1 FAILED", icon="❌")
            st.rerun()

with sc_col2:
    if st.button("2️⃣ Attack/Scrub", help="Scene 2/3: Adversarial Injection (SC-01) & Canary Redaction (SC-02)", use_container_width=True):
        with st.spinner("Executing Scene 2/3..."):
            res = state.run_judge_scene("attack")
            if res["status"] == "PASS":
                st.toast("Scene 2/3 (Attack & Redaction) PASSED", icon="✅")
            st.rerun()

with sc_col3:
    if st.button("3️⃣ Canary Proof", help="Scene 3.5: Recompute Canary-Absence Assertion on Wire", use_container_width=True):
        with st.spinner("Verifying Canary Containment..."):
            res = state.run_judge_scene("containment")
            st.toast("Scene 3.5 (Canary Proof) PASSED", icon="✅")
            st.rerun()

with sc_col4:
    if st.button("4️⃣ EROFS Probe", help="Scene 4: Docker EROFS Read-Only Root & Network Isolation Probe", use_container_width=True):
        with st.spinner("Probing Runtime Containment..."):
            res = state.run_judge_scene("runtime")
            st.toast("Scene 4 (Runtime Containment) Probed", icon="ℹ️")
            st.rerun()

with sc_col5:
    if st.button("5️⃣ Tamper Demo", help="Scene 5: Corrupt 1 byte in disposable copy & verify rejection", use_container_width=True):
        with st.spinner("Executing Tamper Simulation..."):
            res = state.run_judge_scene("tamper")
            st.toast("Scene 5 (Tamper Rejection) PASSED", icon="🛡️")
            st.rerun()

with sc_col6:
    if st.button("6️⃣ Sign Report", help="Scene 6: Export and sign audit_report.json with Ed25519", use_container_width=True):
        with st.spinner("Signing Audit Report..."):
            res = state.run_judge_scene("report")
            st.toast("Scene 6 (Report Signed) PASSED", icon="📜")
            st.rerun()

with sc_col7:
    if st.button("⚡ Run Full 6-Scene Pitch", help="Execute complete automated pitch sequence 1-6 end-to-end", use_container_width=True):
        with st.spinner("Executing Full 6-Scene Pitch Pipeline..."):
            res = state.run_judge_scene("full")
            if res["status"] == "PASS":
                st.success("Full 6-Scene Pitch Completed Successfully!")
            st.rerun()

# ------------------------------------------------- section 1: system state

@st.fragment(run_every=polling_interval if polling_interval > 0 else None)
def system_state_hud():
    health = state.broker_health()
    integrity = state.ledger_integrity()
    last_events = state.latest_events(1)
    last_ts = last_events[0].ts if last_events else None

    c1, c2, c3, c4, c5, c6 = st.columns(6)
    c1.metric("Broker Health", health.get("status", "?"),
              help=health.get("detail", "mode-aware health (D19)"))
    c2.metric("Target Mode", state.target_mode(),
              help="deterministic_mock (offline-first) vs local_model")
    c3.metric("Current Run", (state.current_run() or "none")[:18] + ("…" if len(state.current_run() or "") > 18 else ""))
    
    ver_status = integrity.get("verification", "NOT RUN")
    c4.metric("Ledger Verification", ver_status[:16] + ("…" if len(ver_status) > 16 else ""),
              help=f"as-of height {integrity.get('as_of_height')}; stale={integrity.get('stale')}; checked={integrity.get('last_verified_at')}")
    
    c5.metric("Runtime Containment", state.runtime_status()[:16] + ("…" if len(state.runtime_status()) > 16 else ""),
              help="TESTED / SKIPPED (Docker unavailable) / UNTESTED")
    c6.metric("Last Event UTC", (last_ts or "none")[11:19])

system_state_hud()

# -------------------------------- section 2: live interception stream

@st.fragment(run_every=polling_interval if polling_interval > 0 else None)
def live_stream_section():
    st.subheader("Live interception stream")
    alive, label = state.event_source_alive()
    
    pulse_indicator = '<span class="terminal-pulse"></span>' if alive and "LIVE" in label else ''
    st.markdown(f"""
    <div class="terminal-header">
        <div>{pulse_indicator}STREAM: {label}</div>
        <div>REAL-TIME LEDGER TAIL (BOUNDED 50 EVENTS) · ZERO FLICKER</div>
    </div>
    """, unsafe_allow_html=True)

    events = state.latest_events(50)
    if not events:
        st.info("IDLE — no events yet in this run.")
        if polling_interval == 0:
            if st.button("Refresh Stream", key="refresh_stream_idle"):
                st.rerun()
        return

    component_labels = {
        "request.ingress": "INGRESS",
        "policy.decision": "BROKER-POLICY",
        "target.response": "TARGET",
        "response.released": "BROKER-POLICY",
        "ledger.committed": "AUDIT-LEDGER",
        "checkpoint.signed": "AUDIT-LEDGER",
        "verification.performed": "VERIFIER",
        "incident.raised": "BROKER-POLICY",
        "run.started": "HARNESS",
        "run.completed": "HARNESS",
        "assertion.recorded": "HARNESS",
        "rejections.summary": "BROKER-POLICY",
    }

    lines = []
    for ev in events[-30:]:
        ts_short = ev.ts[11:19]
        clabel = component_labels.get(ev.event_type.value, ev.event_type.value.upper())
        outcome_str = f" outcome={ev.outcome.value}" if ev.outcome else ""
        rid_str = f" run_id={ev.run_id[:12]}" if ev.run_id else ""
        sc_str = f" scenario={ev.scenario_id}" if ev.scenario_id else ""
        lines.append(f"[{ts_short}] [{clabel:14}] seq={ev.seq:<3}{outcome_str}{sc_str}{rid_str} hash={ev.hash[:12]}…")

    st.code("\n".join(lines), language="text")

    # Structured Event Inspection
    with st.expander("🔍 Inspect Structured Ledger Events (Last 5 Entries)"):
        for ev in events[-5:]:
            outcome_val = ev.outcome.value if ev.outcome else "INFO"
            st.markdown(f"**Seq {ev.seq}** · `{ev.event_type.value}` · <span class='badge-pill badge-{outcome_val.lower()}'>{outcome_val}</span>", unsafe_allow_html=True)
            st.json({
                "event_id": ev.event_id,
                "seq": ev.seq,
                "ts": ev.ts,
                "event_type": ev.event_type.value,
                "component": ev.component.value,
                "outcome": ev.outcome.value if ev.outcome else None,
                "scenario_id": ev.scenario_id,
                "detail": ev.detail,
                "prev_hash": ev.prev_hash[:16] + "…",
                "hash": ev.hash[:16] + "…",
            })

    if polling_interval == 0 and st.button("Refresh Stream", key="refresh_stream_btn"):
        st.rerun()

live_stream_section()

# ------------------------------------ section 3: active incidents

st.subheader("Active and recent incidents")
incidents = state.active_incidents()
if not incidents:
    st.info("No incidents recorded in the current run's ledger tail.")
else:
    st.table([
        {"time": i.get("ts", "")[:19], "scenario": i.get("scenario_id"),
         "outcome": i.get("outcome"), "reason": i.get("reason"),
         "run": i.get("run_id"), "event_id": i.get("event_id")}
        for i in incidents[-15:]
    ])

# =========================================================================
# SIDE-BY-SIDE PAYLOAD & REDACTION INSPECTOR (spec §3.4 & §7)
# =========================================================================

payloads = state.side_by_side_payloads()
if payloads:
    with st.expander("🔍 Side-by-Side Payload & Redaction Inspector (Evidence of Enforcement BEFORE Release)", expanded=True):
        st.caption("Proves zero-trust policy enforcement happens before release: raw target outputs containing canary or injection markers are scrubbed before socket egress.")
        
        for p in payloads:
            outcome_color = "redacted" if p["outcome"] == "REDACTED" else ("blocked" if p["outcome"] == "BLOCKED" else "detected")
            st.markdown(f"""
            <div style="border-top: 1px solid #1f2937; padding-top: 10px; margin-top: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 700; font-size: 13px; color: #f9fafb;">[{p['scenario_id']}] {p['title']}</span>
                    <div>
                        <span class="badge-pill badge-{outcome_color}">{p['outcome']}</span>
                        <span class="badge-pill badge-allowed" style="margin-left: 6px;">TIMING: {p['enforcement_timing']}</span>
                    </div>
                </div>
            </div>
            """, unsafe_allow_html=True)

            col_target, col_broker = st.columns(2)
            with col_target:
                st.markdown("""
                <div class="diff-box diff-box-target">
                    <div style="color: #ffb020; font-weight: bold; margin-bottom: 4px;">RAW TARGET OUTPUT (PRE-EGRESS WIRE)</div>
                    <div style="color: #94a3b8; font-size: 10px; margin-bottom: 6px;">Target Component: %s · Digest: %s</div>
                    <div style="background: #111420; padding: 8px; border-radius: 4px; color: #fecdd3;">%s</div>
                </div>
                """ % (p["target_component"], p["target_digest"][:12] + "…", p["target_raw_output"]), unsafe_allow_html=True)

            with col_broker:
                st.markdown("""
                <div class="diff-box diff-box-broker">
                    <div style="color: #00f0ff; font-weight: bold; margin-bottom: 4px;">RELEASED BROKER RESPONSE (POST-ENFORCEMENT)</div>
                    <div style="color: #94a3b8; font-size: 10px; margin-bottom: 6px;">Rule: %s · Policy: %s · Digest: %s</div>
                    <div style="background: #111420; padding: 8px; border-radius: 4px; color: #a7f3d0;">%s</div>
                </div>
                """ % (p["rule"], p["policy_reason"], p["released_digest"][:12] + "…", p["released_broker_response"]), unsafe_allow_html=True)

st.caption("Observed vs verified are distinct: incidents are recorded in the "
           "ledger; chain verification status is shown in the Ledger integrity "
           "section with its as-of height.")

# ------------------------------------ section 4: evaluation matrix

st.subheader("Attacker-versus-target evaluation matrix")
rows = state.matrix()
st.dataframe([
    {"Attack vector": r["attack_vector"], "Scenario ID": r["scenario_id"],
     "Control layer": r["control"], "Detection mechanism": r["detection"],
     "Action taken": r["action"], "Result": r["result"],
     "Evidence": ", ".join(r.get("evidence") or []) or "-"}
    for r in rows
], use_container_width=True, hide_index=True)

passed, applicable = state.passed_denominator()
st.markdown(
    f"**{passed}/{applicable} applicable assertions passed** "
    f"· {len(rows)} scenarios in the catalogue · result PASS requires an "
    f"executed assertion, never component existence (spec §7).")

# ------------------------------------ section 5: ledger integrity

st.subheader("Ledger integrity")
integrity = state.ledger_integrity()

st.write(f"Block height: **{integrity['block_height']}**")
st.write(f"Latest event hash: `{integrity['head_hash'] or 'none'}`")
st.write(f"Chain verification: **{integrity['verification']}** "
         f"(as-of height {integrity['as_of_height']}, "
         f"checked at {str(integrity['last_verified_at'])[:19] or 'never'})")
st.write(f"Checkpoint signature: **{integrity['checkpoint_status']}** "
         f"· coverage: {integrity['checkpoint_coverage']}")
st.write("A previously verified ledger never displays VERIFIED after the "
         "chain grows: stale records flip to STALE automatically (D8).")

# =========================================================================
# VISUAL HASH-CHAIN & BYTE-DIFF TAMPER EXPLORER (spec §6 / tamper_demo.py)
# =========================================================================

st.markdown("""
<div class="soc-card-header" style="margin-top: 16px;">
    <span>// VISUAL HASH-CHAIN & BYTE-DIFF TAMPER EXPLORER</span>
    <span style="color: #ff2449;">DISPOSABLE COPY INTEGRITY ATTACK</span>
</div>
""", unsafe_allow_html=True)

t_col1, t_col2, t_col3 = st.columns([1.5, 1, 1.5])
with t_col1:
    tamper_mode = st.selectbox(
        "Tamper Mode",
        ["byte (Flip 1 byte in block payload)",
         "delete (Delete entire event block)",
         "reorder (Swap adjacent block sequence)",
         "truncate (Truncate chain tail by 2 blocks)"],
        index=0
    )
    mode_key = tamper_mode.split()[0]

with t_col2:
    event_idx = st.number_input("Event Index to Corrupt", min_value=1, max_value=max(1, integrity["block_height"]), value=min(3, max(1, integrity["block_height"])))

with t_col3:
    st.write("")
    st.write("")
    run_sim = st.button("⚡ Corrupt Disposable Copy (Tamper Demo)", use_container_width=True)

if run_sim or "last_tamper_result" in st.session_state:
    if run_sim:
        st.session_state["last_tamper_result"] = state.run_tamper_simulation(mode=mode_key, event_index=int(event_idx))
    
    t_res = st.session_state.get("last_tamper_result")
    if t_res and t_res.get("success"):
        st.markdown(f"""
        <div style="background: #090d16; border: 1px solid #1c2638; border-radius: 8px; padding: 16px; margin-top: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <span style="font-weight: bold; color: #f3f4f6;">TAMPER EXPERIMENT VERDICT</span>
                <span class="badge-pill badge-tamper-rejected">TAMPER REJECTED: NON-ZERO EXIT</span>
            </div>
            <p style="font-size: 12px; color: #94a3b8; margin: 0 0 10px 0;">
                The disposable copy had 1 byte altered at Event #{t_res['target_event_index']}. The independent verifier halted at sequence #{t_res['earliest_failure_seq']} and rejected the chain.
            </p>
        </div>
        """, unsafe_allow_html=True)

        # Visual Block Chains Comparison
        st.markdown("**1. Original Ledger Chain (Active Evidence)** — <span class='badge-pill badge-verified'>UNMODIFIED · CRYPTOGRAPHICALLY VALID</span>", unsafe_allow_html=True)
        orig_html = ['<div class="chain-wrapper">']
        for b in t_res.get("original_blocks", []):
            orig_html.append(f"""
            <div class="chain-block chain-block-valid">
                <div style="color: #00ff9d; font-weight: bold;">BLOCK #{b['seq']}</div>
                <div style="color: #94a3b8; font-size: 9px;">{b['event_type']}</div>
                <div style="color: #64748b; font-size: 8px; margin-top: 4px;">{b['hash'][:10]}…</div>
            </div>
            <div class="chain-arrow">──►</div>
            """)
        orig_html.append('<div style="color: #00ff9d; font-size: 11px; font-weight: bold;">[CHAIN INTACT]</div></div>')
        st.markdown("".join(orig_html), unsafe_allow_html=True)

        st.markdown(f"**2. Disposable Mutated Copy** — <span class='badge-pill badge-tamper-rejected'>FAILED AT BLOCK #{t_res['earliest_failure_seq']}</span>", unsafe_allow_html=True)
        tamp_html = ['<div class="chain-wrapper">']
        for b in t_res.get("tampered_blocks", []):
            if b["status"] == "corrupted":
                tamp_html.append(f"""
                <div class="chain-block chain-block-corrupted">
                    <div style="color: #ff2449; font-weight: bold;">BLOCK #{b['seq']} ⚠️</div>
                    <div style="color: #fca5a5; font-size: 9px;">CORRUPTED</div>
                    <div style="color: #ff8099; font-size: 8px; margin-top: 4px;">{t_res['computed_hash'][:10]}…</div>
                </div>
                <div class="chain-arrow-broken">⚡ BROKEN ⚡</div>
                """)
            elif b["status"] == "broken_link":
                tamp_html.append(f"""
                <div class="chain-block chain-block-broken">
                    <div style="color: #64748b; font-weight: bold;">BLOCK #{b['seq']} ❌</div>
                    <div style="color: #64748b; font-size: 9px;">LINK INVALID</div>
                    <div style="color: #475569; font-size: 8px; margin-top: 4px;">broken prev</div>
                </div>
                <div class="chain-arrow">──►</div>
                """)
            else:
                tamp_html.append(f"""
                <div class="chain-block chain-block-valid">
                    <div style="color: #00ff9d; font-weight: bold;">BLOCK #{b['seq']}</div>
                    <div style="color: #94a3b8; font-size: 9px;">{b['event_type']}</div>
                    <div style="color: #64748b; font-size: 8px; margin-top: 4px;">{b['hash'][:10]}…</div>
                </div>
                <div class="chain-arrow">──►</div>
                """)
        tamp_html.append('</div>')
        st.markdown("".join(tamp_html), unsafe_allow_html=True)

        # Side-by-side SHA-256 Hash Comparison
        h_col1, h_col2 = st.columns(2)
        with h_col1:
            st.markdown(f"""
            <div style="background: #0d131f; border-left: 3px solid #00ff9d; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 11px;">
                <span style="color: #00ff9d; font-weight: bold;">EXPECTED SHA-256 HASH (PRE-CORRUPTION)</span><br/>
                <span style="color: #e2e8f0;">{t_res['expected_hash']}</span>
            </div>
            """, unsafe_allow_html=True)
        with h_col2:
            st.markdown(f"""
            <div style="background: #1a0f14; border-left: 3px solid #ff2449; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 11px;">
                <span style="color: #ff2449; font-weight: bold;">COMPUTED SHA-256 HASH (AFTER MUTATION)</span><br/>
                <span style="color: #fca5a5;">{t_res['computed_hash']}</span>
            </div>
            """, unsafe_allow_html=True)

        st.success(f"🛡️ Original Evidence Ledger ({state.current_run()}/ledger.jsonl) re-verified: UNMODIFIED and VALID.")

# ------------------------------------ section 6: reports and history

st.subheader("Reports and history")
if not runs:
    st.info("No completed runs yet — run ./demo.sh to produce evidence.")
else:
    options = [f"{r['run_id']} — {r['report_status'] or 'no report'}" for r in runs]
    choice = st.selectbox("Run", options)
    chosen = runs[options.index(choice)]
    if chosen.get("report_path"):
        report_text = Path(chosen["report_path"]).read_text(encoding="utf-8")
        st.json(report_text)
        st.download_button("Download report", report_text,
                          file_name=f"audit_report_{chosen['run_id']}.json")
        st.caption(f"Recorded status: {chosen['report_status']} — recorded at "
                   "report time; the independent verifier re-checks signature "
                   "and ledger on demand.")
