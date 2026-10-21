"""Section 7 — attacker-versus-target evaluation matrix.

Rows come from the run's recorded scenario results (state.matrix(),
sourced from demo_result.json + the shipped scenario catalogue). Honest
denominators, per-scenario evidence drawers. A scenario with no executed
assertion stays NOT_EVALUATED — the presence of a defensive component is
never enough to render PASS.
"""

from __future__ import annotations

import pandas as pd
import streamlit as st

from app.dashboard.artifact_client import ArtifactClient, BackendUnavailable
from app.dashboard.models import badge_color, redact, redact_obj, summarize

COLUMNS = [
    "Attack vector",
    "Scenario ID",
    "Isolation or enforcement layer",
    "Detection mechanism",
    "Action taken",
    "Evidence",
    "Result",
]


def render(client: ArtifactClient) -> None:
    err: str | None = None
    try:
        fetched = client.results()
    except BackendUnavailable as exc:
        fetched, err = [], str(exc)[:160]

    rows = [{
        "scenario_id": r.scenario_id,
        "attack_vector": r.attack_vector,
        "layer": r.layer,
        "mechanism": r.mechanism,
        "action_taken": r.action_taken,
        "result": r.result.value,
        "evidence": list(r.evidence),
        "evidence_detail": r.evidence_detail,
    } for r in fetched]
    counts = summarize(rows)

    if err:
        st.warning(
            "No run artifacts available — no assertion results were executed. "
            f"All scenarios shown as NOT_EVALUATED. ({err})"
        )

    top = st.columns([8, 4])
    with top[0]:
        st.write(
            f"**{counts['passed']}/{counts['applicable']} applicable "
            f"assertions passed**"
            f" · {counts['failed']} failed · {counts['errors']} errors ·"
            f" {counts['skipped']} skipped · {counts['not_evaluated']} not "
            f"evaluated · denominator = {counts['applicable']} of "
            f"{counts['total']} scenarios"
        )
    with top[1]:
        st.caption("Applicable = executed to a verdict (PASS/FAIL/ERROR)")

    if rows:
        table = pd.DataFrame(
            [
                {
                    "Attack vector": r["attack_vector"],
                    "Scenario ID": r["scenario_id"],
                    "Isolation or enforcement layer": r["layer"],
                    "Detection mechanism": r["mechanism"],
                    "Action taken": r["action_taken"],
                    "Evidence": redact(", ".join(r["evidence"]) or "—"),
                    "Result": r["result"],
                }
                for r in rows
            ],
            columns=COLUMNS,
        )
        st.dataframe(table, width="stretch", height=340)

    st.markdown("**Evidence drawers**")
    for r in rows:
        label = f"{r['scenario_id']} · {r['attack_vector']} — {r['result']}"
        with st.expander(label):
            c1, c2 = st.columns([2, 10])
            with c1:
                st.badge(r["result"], color=badge_color(r["result"]))
            with c2:
                st.caption(f"Layer: {r['layer']}")
            st.write(f"**Detection mechanism:** {r['mechanism']}")
            st.write(f"**Action taken:** {r['action_taken']}")
            skip = (r["evidence_detail"] or {}).get("skip_reason")
            if skip:
                st.caption(f"Skip reason: {skip}")
            if r["evidence"]:
                st.write("**Evidence references:**")
                for ref in r["evidence"]:
                    st.code(redact(str(ref)), language=None)
            else:
                st.caption("No evidence references recorded.")
            if r["evidence_detail"]:
                with st.expander("Evidence detail"):
                    st.json(redact_obj(r["evidence_detail"]))
            if r["result"] == "NOT_EVALUATED":
                st.caption(
                    "This assertion has not executed in the current run — "
                    "it is neither a pass nor a failure."
                )
