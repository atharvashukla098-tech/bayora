"""3D evidence chain — the run's hash-chained ledger rendered spatially.

Pure Python (Plotly figure API): no hand-written HTML, no CDN assets, no
new network dependency. Streamlit serves plotly.js from its own local
bundle, so the scene renders fully offline.

What the scene shows
-------------------
* one block per ledger event, positioned by sequence (x) and by pipeline
  component lane (y);
* colour by outcome, so a redacted or blocked event is visible at a
  glance;
* the hash links between consecutive events drawn as a line trace — the
  chain itself, made spatial;
* a depth grid behind the chain, so rotating the camera produces real
  parallax between the chain and the background;
* the tampered event (if the tamper demo has run in this session) marked
  in red inside the same scene.

What the scene does NOT claim: this is a visualization of recorded
events. Verification status is stated only in the signed attestation
section — a pretty picture is never evidence.
"""

from __future__ import annotations

import math
from typing import Any, Optional

import streamlit as st

from app.dashboard.artifact_client import ArtifactClient, BackendUnavailable

# Dossier palette (mirrors .streamlit/config.toml).
PAPER = "#F4F0E8"
INK = "#1C2029"
RULE = "#D8D0C0"
LINK = "#B9AC92"
OXBLOOD = "#8C2F39"

OUTCOME_COLOR: dict[str, str] = {
    "ALLOWED": "#4E9A6B",      # forest
    "DETECTED": "#C8871B",     # amber
    "REDACTED": "#B25E1C",     # burnt orange
    "BLOCKED": "#A8322B",      # oxblood
    "ERROR": "#6B4E9E",        # violet
    "NOT_EVALUATED": "#8A8478",  # slate
    "": "#8A8478",
}

# Lane order (y axis) — the pipeline order the events flow through.
LANES: list[str] = [
    "HARNESS", "INGRESS", "TARGET", "BROKER-POLICY",
    "AUDIT-LEDGER", "VERIFIER",
]
LANE_INDEX = {name: i for i, name in enumerate(LANES)}


def _camera(azimuth: float, elevation: float) -> dict[str, float]:
    """Spherical camera position — the parallax control."""
    az = math.radians(azimuth)
    el = math.radians(elevation)
    r = 2.1
    return {
        "x": round(r * math.cos(el) * math.cos(az), 4),
        "y": round(r * math.cos(el) * math.sin(az), 4),
        "z": round(r * math.sin(el) + 0.55, 4),
    }


def build_figure(events: list[dict[str, Any]], *, azimuth: float = 35.0,
                 elevation: float = 24.0,
                 tamper_seq: Optional[int] = None):
    """Build the 3D chain figure. Returns None when there is nothing to draw."""
    if not events:
        return None

    import plotly.graph_objects as go

    xs, ys, zs, colors, sizes, symbols, hover = [], [], [], [], [], [], []
    link_x, link_y, link_z = [], [], []

    prev = None
    for ev in events:
        seq = ev.get("seq")
        comp = str(ev.get("component", ""))
        lane = LANE_INDEX.get(comp, len(LANES) - 1)
        status = str(ev.get("status") or "")
        color = OUTCOME_COLOR.get(status, OUTCOME_COLOR[""])
        xs.append(seq)
        ys.append(lane)
        zs.append(0)
        colors.append(color)
        sizes.append(2.4 if seq == tamper_seq else 1.5)
        symbols.append("x" if seq == tamper_seq else "square")
        hover.append(
            f"#{seq} · {comp} · {status or 'no outcome'}"
            + (f" · TAMPERED" if seq == tamper_seq else "")
        )
        if prev is not None:
            link_x += [prev[0], seq, None]
            link_y += [prev[1], lane, None]
            link_z += [prev[2], 0, None]
        prev = (seq, lane, 0)

    fig = go.Figure()

    # hash links (drawn first so blocks sit on top)
    fig.add_trace(go.Scatter3d(
        x=link_x, y=link_y, z=link_z, mode="lines",
        line=dict(color=LINK, width=3),
        hoverinfo="skip", showlegend=False, name="hash link",
    ))

    # the chain blocks
    fig.add_trace(go.Scatter3d(
        x=xs, y=ys, z=zs, mode="markers",
        marker=dict(size=sizes, color=colors, symbol=symbols,
                    line=dict(width=0.5, color=INK), opacity=0.95),
        text=hover, hoverinfo="text", showlegend=False, name="event",
    ))

    fig.update_layout(
        paper_bgcolor=PAPER,
        plot_bgcolor=PAPER,
        font=dict(family="Georgia, 'Source Serif', serif", color=INK, size=12),
        margin=dict(l=0, r=0, t=0, b=0),
        height=430,
        showlegend=False,
        scene=dict(
            xaxis=dict(
                title=dict(text="ledger sequence", font=dict(size=11)),
                backgroundcolor=PAPER, gridcolor=RULE, zerolinecolor=RULE,
                color=INK, showbackground=True, dtick=5,
            ),
            yaxis=dict(
                title=dict(text="pipeline component", font=dict(size=11)),
                backgroundcolor=PAPER, gridcolor=RULE, zerolinecolor=RULE,
                color=INK, showbackground=True,
                tickmode="array",
                tickvals=list(range(len(LANES))),
                ticktext=LANES,
            ),
            zaxis=dict(
                title=dict(text="", font=dict(size=11)),
                backgroundcolor=PAPER, gridcolor=RULE, zerolinecolor=RULE,
                color=INK, showbackground=True, range=[-1, 1], dtick=2,
            ),
            camera=dict(eye=_camera(azimuth, elevation),
                        up=dict(x=0, y=0, z=1)),
        ),
    )
    return fig


def _event_dicts(client: ArtifactClient) -> list[dict[str, Any]]:
    try:
        return [e.model_dump() for e in client.events()]
    except BackendUnavailable:
        return []


def render(client: ArtifactClient) -> None:
    events = _event_dicts(client)
    if not events:
        st.info("No ledger events to plot for this run yet.")
        return

    tamper = st.session_state.get("tamper_result") or {}
    tamper_seq = tamper.get("modified_event")

    c1, c2 = st.columns([1, 1])
    with c1:
        azimuth = st.slider("View azimuth (°)", 0, 360, 35, 5)
    with c2:
        elevation = st.slider("View elevation (°)", 5, 80, 24, 1)

    run_key = (client.state.run_id, len(events),
               events[-1].get("seq") if events else None)
    cached = st.session_state.get("chain_figure")
    if not cached or cached["key"] != run_key:
        cached = {"key": run_key,
                  "fig": build_figure(events, azimuth=azimuth,
                                      elevation=elevation,
                                      tamper_seq=tamper_seq)}
        st.session_state.chain_figure = cached

    fig = cached["fig"]
    if fig is None:
        st.info("No ledger events to plot for this run yet.")
        return

    # camera moves are cheap; the figure itself is reused
    fig.update_layout(scene=dict(camera=dict(eye=_camera(azimuth, elevation),
                                             up=dict(x=0, y=0, z=1))))
    st.plotly_chart(
        fig, width="stretch",
        config={"displaylogo": False,
                "modeBarButtonsToRemove": ["toImage", "select2d", "lasso2d"]},
    )

    legend = st.columns(6)
    for col, (label, color) in zip(legend, [
        ("ALLOWED", "green"),
        ("DETECTED", "yellow"),
        ("REDACTED", "orange"),
        ("BLOCKED", "red"),
        ("ERROR", "violet"),
        ("TAMPERED", "primary"),
    ]):
        with col:
            st.badge(label, color=color)
    st.caption(
        f"Visualization of {len(events)} recorded ledger events and their "
        "hash links. Drag to rotate — depth between the chain and the grid "
        "gives the parallax. A scene is not a verdict: verification status "
        "is stated in the signed attestation section."
    )
