"""Pydantic v2 request/response models for the broker (blueprint §7.1).

``extra="forbid"`` everywhere. On EvaluateRequest this means an injected
``{"destination": "http://evil"}`` key is itself a schema violation (422) —
a caller cannot smuggle a URL into the evaluation path even before the
allowlist is consulted (spec §3.2 "no user-supplied URLs"). The ONLY place a
caller may name a URL is POST /v1/check-destination, which is policy-only.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, HttpUrl

from app.schema import Outcome


class EvaluateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: str = Field(min_length=1, max_length=4000)   # size also capped at byte level
    scenario_id: Optional[str] = None                    # metadata only, never a control (D7)
    run_id: Optional[str] = None


class CheckDestinationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: HttpUrl


class PolicyDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_rule: str           # "allowlist", "injection", "size", "schema", "fs_write"
    request_action: Literal["ALLOW", "BLOCK"]
    response_action: Literal["RELEASE", "REDACT", "BLOCK", "DETECT"]
    matched_patterns: list[str]   # regex ids ("inj-3", "fs-1") only
    reason_code: str              # from BrokerErrorCode


class EvaluateResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: str
    scenario_id: Optional[str]
    released_text: str          # post-policy response actually handed to caller
    outcome: Outcome            # the single authoritative outcome (precedence §7.4.1)
    policy_decision: PolicyDecision
    events: list[str]           # event_ids linking to ledger evidence
    redaction_applied: bool


class BrokerErrorBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    error: str                  # BrokerErrorCode value
    outcome: Outcome            # (D20): MANDATORY on every error body
    detail: str                # static safe message; never a raw exception
    run_id: Optional[str] = None
