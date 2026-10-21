"""Section 5 — live threat interception event stream.

Consumes real ledger events via the artifact client. Rules:

* Only events that actually exist in the run's ledger are displayed.
* Bounded tail (client caps at 400, pane shows the last 10).
* IDLE (run exists, no events yet) is distinct from DISCONNECTED
  (event source not found).
* Timestamps are UTC and labelled as such.
* Canary values and obvious secrets are redacted at render time —
  observed events are not claimed as verified; that distinction lives
  in the attestation section.
"""

from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from typing import Any

import streamlit as st

from app.dashboard.artifact_client import ArtifactClient, BackendUnavailable
from app.dashboard.models import redact, redact_obj

MAX_EVENTS = 400
PANE_LINES = 10


def _init_state() -> None:
    ss = st.session_state
    if "stream_events" not in ss:
        ss.stream_events = deque(maxlen=MAX_EVENTS)
    if "stream_last_seq" not in ss:
        ss.stream_last_seq = 0
    if "stream_state" not in ss:
        ss.stream_state = "UNKNOWN"
    if "stream_last_ok" not in ss:
        ss.stream_last_ok = None
    if "stream_error" not in ss:
        ss.stream_error = ""
    if "stream_run_key" not in ss:
        ss.stream_run_key = None


def _poll(client: ArtifactClient) -> None:
    _init_state()
    ss = st.session_state
    run_key = client.state.run_id
    if run_key != ss.stream_run_key:
        # Different run selected: buffers must not leak across runs.
        ss.stream_events = deque(maxlen=MAX_EVENTS)
        ss.stream_last_seq = 0
        ss.stream_run_key = run_key
    try:
        new_events = client.events(since_seq=ss.stream_last_seq)
        ss.stream_last_ok = datetime.now(timezone.utc)
        ss.stream_error = ""
        for ev in new_events:
            ss.stream_events.append(ev.model_dump())
            ss.stream_last_seq = max(ss.stream_last_seq, ev.seq)
        ss.stream_state = "LIVE" if new_events else "IDLE"
    except BackendUnavailable as exc:
        ss.stream_state = "DISCONNECTED"
        ss.stream_error = str(exc)[:160]


def _fmt_ts(iso: str, display_tz: str = "UTC") -> str:
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        if display_tz == "local":
            local = dt.astimezone()
            return local.strftime("%H:%M:%S local (UTC%z)")
        return dt.astimezone(timezone.utc).strftime("%H:%M:%S UTC")
    except (ValueError, AttributeError):
        return "--:--:-- UTC"


def _fmt_event(ev: dict[str, Any], display_tz: str = "UTC") -> str:
    head = (f"[{_fmt_ts(str(ev.get('ts_utc', '')), display_tz)}] "
            f"[{str(ev.get('component', '?')):<13}] "
            f"{redact(str(ev.get('message', '')))}")
    parts: list[str] = []
    if ev.get("run_id"):
        parts.append(f"run_id={ev['run_id']}")
    if ev.get("status"):
        parts.append(f"status={ev['status']}")
    if ev.get("block") not in (None, ""):
        parts.append(f"block={ev['block']}")
    if ev.get("hash"):
        parts.append(f"hash={str(ev['hash'])[:12]}...")
    for key, val in list((ev.get("details") or {}).items())[:4]:
        parts.append(f"{key}={redact(str(val))}")
    body = " ".join(parts)
    return f"{head}\n  {body}" if body else head


def _age_caption(display_tz: str = "UTC") -> str:
    ss = st.session_state
    if ss.stream_last_ok:
        age = (datetime.now(timezone.utc) - ss.stream_last_ok).total_seconds()
        last_ok = f"last successful poll {int(age)}s ago"
    else:
        last_ok = "no successful poll yet"
    tz_note = "Times in UTC" if display_tz == "UTC" else "Times in local time"
    if ss.stream_events:
        last = ss.stream_events[-1]
        return f"{tz_note} · {last_ok} · newest event #{last['seq']}"
    return f"{tz_note} · {last_ok} · no events yet"


def render(client: ArtifactClient, display_tz: str = "UTC") -> None:
    _poll(client)
    ss = st.session_state

    badge = {"LIVE": "green", "IDLE": "gray", "DISCONNECTED": "red",
             "UNKNOWN": "gray"}[ss.stream_state]
    label = {"LIVE": "SOURCE: LIVE", "IDLE": "SOURCE: IDLE",
             "DISCONNECTED": "SOURCE: DISCONNECTED",
             "UNKNOWN": "SOURCE: UNKNOWN"}[ss.stream_state]

    top = st.columns([3, 6, 3])
    with top[0]:
        st.badge(label, color=badge)
    with top[1]:
        st.caption(_age_caption(display_tz))
    with top[2]:
        st.caption(f"buffered {len(ss.stream_events)}/{MAX_EVENTS}")

    if ss.stream_state == "DISCONNECTED" and ss.stream_error:
        st.caption(f"Event source unavailable — {ss.stream_error}")

    lines = [_fmt_event(ev, display_tz)
             for ev in list(ss.stream_events)[-PANE_LINES:]]
    if not lines:
        if ss.stream_state == "DISCONNECTED":
            placeholder = ("[--:--:-- UTC] [SYSTEM]        event source "
                           "unavailable\n  no events can be displayed until "
                           "a run produces a ledger")
        else:
            placeholder = ("[--:--:-- UTC] [SYSTEM]        waiting for "
                           "events — source healthy\n  run ./demo.sh or a "
                           "scene from the sidebar to generate activity")
        lines = [placeholder]

    pane = st.container(height=320)
    with pane:
        st.code("\n\n".join(lines), language=None)

    st.caption(
        "Lines above are observed pipeline events from the run's hash-chained "
        "ledger. An observed event is not a cryptographic claim — verification "
        "status is reported only in section 8."
    )

    recent = list(ss.stream_events)[-15:]
    if recent:
        options = {
            f"#{e['seq']} · {e['component']} · {str(e['message'])[:48]}": e
            for e in reversed(recent)
        }
        choice = st.selectbox("Inspect event details", list(options.keys()))
        if choice:
            st.json(redact_obj(options[choice]))
