"""Streamlit incident-response dashboard (blueprint §11.2, spec §9).

Six sections in spec order. Refresh uses ONLY core ``@st.fragment(run_every=…)``
(D14) — no third-party refresh package is imported anywhere. Launch:
    streamlit run app/dashboard/app.py
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from app.config import load_config                      # noqa: E402
from app.dashboard.state import DashboardState          # noqa: E402

st.set_page_config(page_title="Bayora — Incident Response", layout="wide")

# ---------------------------------------------------------------- sidebar

st.sidebar.title("Bayora")
config_path = st.sidebar.text_input("Config path", value=str(ROOT / "config" / "config.example.yaml"))
REFRESH_SECONDS = st.sidebar.slider("Auto-refresh (seconds)", 0, 10, 2, help="0 = OFF")
DISPLAY_TZ = st.sidebar.selectbox("Display timezone", ["UTC", "local"], index=0)

config = load_config(Path(config_path))
state = DashboardState(config)
runs = state.run_history()
run_options = [r["run_id"] for r in runs] or [state.current_run() or "-"]
selected_run = st.sidebar.selectbox("Current run", run_options)
if selected_run and selected_run != "-":
    state = DashboardState(config, run_id=selected_run)

st.title("Bayora — Incident Response Dashboard")
st.caption("Zero-trust AI red-teaming sandbox · every value below originates "
           "from run artifacts or a live probe — nothing is fabricated.")

# ------------------------------------------------- section 1: system state

health = state.broker_health()
integrity = state.ledger_integrity()
c1, c2, c3, c4, c5, c6 = st.columns(6)
c1.metric("Broker", health.get("status", "?"),
          help=health.get("detail", "mode-aware health (D19)"))
c2.metric("Target mode", state.target_mode())
c3.metric("Current run", state.current_run() or "none")
c4.metric("Ledger verification", integrity.get("verification", "NOT RUN"),
          help=f"as-of height {integrity.get('as_of_height')}; "
               f"stale={integrity.get('stale')}")
c5.metric("Runtime containment", state.runtime_status())
last_events = state.latest_events(1)
last_ts = last_events[0].ts if last_events else None
c6.metric("Last event", (last_ts or "none")[:19])

# -------------------------------- section 2: live interception stream

@st.fragment(run_every=REFRESH_SECONDS if REFRESH_SECONDS > 0 else None)
def live_stream_section():
    st.subheader("Live interception stream")
    alive, label = state.event_source_alive()
    if not alive:
        st.warning(label)
    else:
        st.caption(f"Stream: {label}")
    events = state.latest_events(50)
    if not events:
        st.info("IDLE — no events yet in this run.")
        if REFRESH_SECONDS == 0:
            if st.button("Refresh"):
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
        label = component_labels.get(ev.event_type.value, ev.event_type.value.upper())
        outcome = f" outcome={ev.outcome.value}" if ev.outcome else ""
        rid = f" run_id={ev.run_id}" if ev.run_id else ""
        lines.append(f"[{ts_short}] [{label}] seq={ev.seq}{outcome}{rid} "
                     f"hash={ev.hash[:12]}…")
    st.code("\n".join(lines), language="text")
    for ev in events[-5:]:
        with st.expander(f"{ev.seq} · {ev.event_type.value} · "
                         f"{ev.outcome.value if ev.outcome else '-'}"):
            st.json({
                "event_id": ev.event_id, "seq": ev.seq, "ts": ev.ts,
                "run_id": ev.run_id, "scenario_id": ev.scenario_id,
                "outcome": ev.outcome.value if ev.outcome else None,
                "hash": ev.hash[:16] + "…",
            })
    if REFRESH_SECONDS == 0 and st.button("Refresh"):
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
st.write(f"Block height: **{integrity['block_height']}**")
st.write(f"Latest event hash: `{integrity['head_hash'] or 'none'}`")
st.write(f"Chain verification: **{integrity['verification']}** "
         f"(as-of height {integrity['as_of_height']}, "
         f"checked at {str(integrity['last_verified_at'])[:19] or 'never'})")
st.write(f"Checkpoint signature: **{integrity['checkpoint_status']}** "
         f"· coverage: {integrity['checkpoint_coverage']}")
st.write("A previously verified ledger never displays VERIFIED after the "
         "chain grows: stale records flip to STALE automatically (D8).")

if st.button("Corrupt a disposable ledger copy (tamper demo)"):
    if state.run_id:
        ledger = state.runs_dir / state.run_id / "ledger.jsonl"
        if ledger.is_file():
            proc = subprocess.run(
                [sys.executable, str(ROOT / "scripts" / "tamper_demo.py"),
                 "--ledger", str(ledger), "--mode", "byte", "--event", "3"],
                capture_output=True, text=True, timeout=120)
            st.code(proc.stdout or proc.stderr)
            st.success("Original ledger untouched — integrity re-read below.")
            integrity = state.ledger_integrity()
            st.write(f"Re-read: height {integrity['block_height']}, "
                     f"verification {integrity['verification']}")
    else:
        st.warning("No run selected.")

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
