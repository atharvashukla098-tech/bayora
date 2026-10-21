"""Containment / environment badges (spec §4.3, §8 honesty rules).

A control shows VERIFIED only when a recorded, executed assertion
established the expected behavior (scenario PASS). Docker-dependent
controls render SKIPPED with their recorded skip reason — never PASS
from config presence. Unknown/unreachable states render as UNKNOWN.
"""

from __future__ import annotations

import streamlit as st

from app.dashboard.artifact_client import ArtifactClient, BackendUnavailable
from app.dashboard.models import Health, badge_color


def fetch_health(client: ArtifactClient) -> Health | None:
    try:
        return client.health()
    except BackendUnavailable:
        return None


def header_badges(health: Health | None) -> None:
    cols = st.columns(4)
    with cols[0]:
        if health is None:
            st.badge("Artifacts: UNKNOWN", color=badge_color("UNKNOWN"))
        else:
            st.badge("Artifacts: REACHABLE", color="green")
    with cols[1]:
        mode = (health.target_mode if health else None) or "UNKNOWN"
        st.badge(
            f"Target: {mode}",
            color=badge_color("UNKNOWN") if health is None else "primary",
            help="Mock responses demonstrate control behavior against defined "
                 "scenarios; they do not prove real-model behavior.",
        )
    with cols[2]:
        offline = health.offline_mode if health else None
        st.badge(
            "Offline: " + ("YES" if offline else
                           ("UNKNOWN" if offline is None else "NO")),
            color="green" if offline else ("gray" if offline is None else "red"),
        )
    with cols[3]:
        docker = health.docker_available if health else None
        st.badge(
            "Docker: " + ("YES" if docker else
                          ("UNKNOWN" if docker is None else "NO")),
            color="green" if docker else "gray",
        )


def containment_panel(client: ArtifactClient) -> None:
    try:
        controls = client.containment()
    except BackendUnavailable as exc:
        st.badge("Containment: UNKNOWN", color=badge_color("UNKNOWN"))
        st.caption(f"Containment state could not be verified — {exc}")
        return

    if not controls:
        st.badge("Containment: NOT EVALUATED", color=badge_color("NOT_EVALUATED"))
        st.caption("No containment controls recorded for this run.")
        return

    for c in controls:
        c1, c2, c3 = st.columns([4, 3, 9])
        with c1:
            st.write(c.name)
        with c2:
            st.badge(c.state, color=badge_color(c.state))
        with c3:
            st.caption(c.evidence or "No evidence recorded.")
