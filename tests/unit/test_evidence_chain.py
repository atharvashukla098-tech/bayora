"""Unit tests for the 3D evidence chain builder and the dashboard's
information-hygiene rules.

The chain must be a faithful projection of recorded events — never a
pretty picture of data that does not exist.
"""

from __future__ import annotations

from app.dashboard.components.evidence_chain import (
    LANES,
    OUTCOME_COLOR,
    _camera,
    build_figure,
)


def _event(seq: int, component: str, status: str = "ALLOWED") -> dict:
    return {"seq": seq, "component": component, "status": status,
            "event_type": "policy.decision", "message": "x", "hash": "a" * 64,
            "ts_utc": "2026-10-21T00:00:00Z", "run_id": "r", "block": None,
            "details": {}}


def test_no_events_means_no_figure():
    assert build_figure([]) is None


def test_figure_has_link_and_block_traces():
    fig = build_figure([_event(1, "INGRESS"), _event(2, "AUDIT-LEDGER")])
    assert fig is not None
    assert len(fig.data) >= 2
    assert fig.data[0].type == "scatter3d"   # hash links
    assert fig.data[1].type == "scatter3d"   # blocks


def test_one_block_per_event():
    events = [_event(i, "TARGET") for i in range(1, 6)]
    fig = build_figure(events)
    assert len(fig.data[1].x) == len(events)
    assert list(fig.data[1].x) == [1, 2, 3, 4, 5]


def test_link_trace_has_one_segment_per_consecutive_pair():
    events = [_event(i, "TARGET") for i in range(1, 5)]
    fig = build_figure(events)
    links = fig.data[0]
    # each segment is (x, y, None) -> 3 points per link
    assert len(links.x) == 3 * (len(events) - 1)
    assert links.x.count(None) == len(events) - 1


def test_outcome_colours_are_mapped():
    events = [
        _event(1, "INGRESS", "ALLOWED"),
        _event(2, "BROKER-POLICY", "REDACTED"),
        _event(3, "BROKER-POLICY", "BLOCKED"),
    ]
    fig = build_figure(events)
    colors = list(fig.data[1].marker.color)
    assert colors[0] == OUTCOME_COLOR["ALLOWED"]
    assert colors[1] == OUTCOME_COLOR["REDACTED"]
    assert colors[2] == OUTCOME_COLOR["BLOCKED"]


def test_unknown_outcome_falls_back_to_slate():
    fig = build_figure([_event(1, "TARGET", "SOMETHING_NEW")])
    assert list(fig.data[1].marker.color) == [OUTCOME_COLOR[""]]


def test_tampered_event_is_marked_and_sized():
    fig = build_figure([_event(1, "INGRESS"), _event(2, "AUDIT-LEDGER")],
                       tamper_seq=2)
    assert list(fig.data[1].marker.symbol) == ["square", "x"]
    assert list(fig.data[1].marker.size)[1] > list(fig.data[1].marker.size)[0]


def test_lanes_cover_every_component_labelled_by_the_stream():
    for lane in ("INGRESS", "TARGET", "BROKER-POLICY", "AUDIT-LEDGER",
                 "VERIFIER", "HARNESS"):
        assert lane in LANES


def test_camera_moves_with_the_sliders():
    a = _camera(0, 30)
    b = _camera(90, 30)
    assert a != b
    # elevation raises the eye above the scene
    low = _camera(35, 10)["z"]
    high = _camera(35, 70)["z"]
    assert high > low


def test_scene_uses_dossier_background():
    fig = build_figure([_event(1, "INGRESS")])
    assert fig.layout.paper_bgcolor == "#F4F0E8"
    assert fig.layout.scene.xaxis.backgroundcolor == "#F4F0E8"
