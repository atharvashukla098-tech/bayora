"""Observation model (pure; kept separate to avoid a runner<->assertions
circular import). Captured WITHOUT declaring containment (spec §3.1) — the
outcome is read from the parsed response body per §7.4.2's single rule."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.schema import Outcome


class Observation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scenario_id: str
    status_code: Optional[int] = None
    outcome: Optional[Outcome] = None
    released_text: Optional[str] = None
    policy_reason: Optional[str] = None
    event_ids: list[str] = []
    recorded_event_types: list[str] = []
    request_digest: Optional[str] = None
    transport_failed: bool = False
    detail: Optional[str] = None
