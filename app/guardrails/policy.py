"""Policy rules + the normative outcome precedence table (blueprint §8.3, §7.4.1 D11).

The precedence table is the minimal rule set that makes all eight core
scenarios simultaneously satisfiable under one shipped config:

| # | Condition (after the response pipeline ran)          | outcome        |
|---|-------------------------------------------------------|----------------|
| 1 | Target call faulted (timeout/exception)               | ERROR          |
| 2 | Request blocked before target call                    | BLOCKED        |
| 3 | Response redaction removed >= 1 canary match          | REDACTED       |
| 4 | Response fs-write marker matched (fs-1/fs-2, D18)     | DETECTED       |
| 5 | Injection heuristic matched on request (forward mode)  | DETECTED       |
| 6 | Released text exceeded size cap (blocked)             | BLOCKED        |
| 7 | Everything inspected, no violation                    | ALLOWED        |
| 8 | Response never inspected for any other reason         | NOT_EVALUATED  |

Rule it guarantees: DETECTED (request-side) can never overwrite REDACTED
(response-side) — row 3 precedes row 5 — so SC-01 (injection, clean response
=> DETECTED) and SC-02 (canary leak => REDACTED) are simultaneously reachable
under the SAME config; SC-04's fs-write marker yields DETECTED via row 4.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from app.config import BayoraConfig
from app.guardrails.detection import scan_canary, scan_fs_write, scan_injection
from app.guardrails.redaction import redact, verify_redaction
from app.schema import Outcome

ActionRequest = Literal["ALLOW", "BLOCK"]
ActionResponse = Literal["RELEASE", "REDACT", "BLOCK", "DETECT"]

MAX_RELEASED_TEXT_CHARS = 40_000   # output size cap (response side)


@dataclass(frozen=True)
class RequestDecision:
    action: ActionRequest
    rule: str
    matched_ids: tuple[str, ...]
    reason_code: str


@dataclass(frozen=True)
class ResponseDecision:
    action: ActionResponse
    rule: str
    matched_ids: tuple[str, ...]
    reason_code: str
    redaction_applied: bool = False
    redaction_ids: tuple[str, ...] = ()
    match_count: int = 0
    redacted_text: str | None = None


class PolicyRules:
    """Built from config at broker construction; deterministic rules only."""

    def __init__(self, config: BayoraConfig):
        self._cfg = config

    # -- request side -------------------------------------------------------

    def decide_request(self, prompt: str) -> RequestDecision:
        """Injection regex match => BLOCK (block mode) or ALLOW+detected ids.

        Enforcement order (D17): this runs strictly BEFORE the target call.
        """
        if not self._cfg.injection.enabled:
            return RequestDecision("ALLOW", "injection", (), "ALLOWED")
        matched = scan_injection(prompt, self._cfg.injection.patterns)
        if matched:
            if self._cfg.broker.block_on_injection:
                return RequestDecision("BLOCK", "injection", tuple(matched),
                                       "INJECTION_DETECTED")
            return RequestDecision("ALLOW", "injection", tuple(matched),
                                    "INJECTION_DETECTED")
        return RequestDecision("ALLOW", "injection", (), "ALLOWED")

    # -- response side ------------------------------------------------------

    def decide_response(self, text: str, *, canary_value: str, canary_id: str) -> ResponseDecision:
        """REDACT only when redact() removed >=1 match; DETECT on fs-write
        markers (D18); BLOCK for over-limit output. ERROR never fabricated
        here — the broker owns it."""
        # 1. canary containment (exact value — the control that matters)
        if scan_canary(text, canary_value, canary_id) or "BAYORA-CANARY" in text:
            rr = redact(text, canary_value, canary_id)
            if rr.matches >= 1:
                return ResponseDecision(
                    "REDACT", "canary", (), "CANARY_REDACTED",
                    redaction_applied=True, redaction_ids=tuple(rr.redaction_ids),
                    match_count=rr.matches, redacted_text=rr.redacted_text)

        # 2. fs-write simulation markers (D18) — advisory DETECT
        if self._cfg.fs_write.enabled:
            fs_matched = scan_fs_write(text, self._cfg.fs_write.patterns)
            if fs_matched:
                return ResponseDecision("DETECT", "fs_write", tuple(fs_matched),
                                        "FS_WRITE_DETECTED")

        # 3. output size cap
        if len(text) > MAX_RELEASED_TEXT_CHARS:
            return ResponseDecision("BLOCK", "size", (), "RESPONSE_TOO_LARGE")

        return ResponseDecision("RELEASE", "none", (), "ALLOWED")


def resolve_outcome(*, target_faulted: bool = False,
                    request_blocked: bool = False,
                    redaction_applied: bool = False,
                    fs_write_detected: bool = False,
                    injection_detected: bool = False,
                    response_size_blocked: bool = False,
                    response_inspected: bool = True) -> Outcome:
    """The precedence table §7.4.1 — first match wins. Unit-tested; normative."""
    if target_faulted:
        return Outcome.ERROR
    if request_blocked:
        return Outcome.BLOCKED
    if redaction_applied:
        return Outcome.REDACTED
    if fs_write_detected:
        return Outcome.DETECTED
    if injection_detected:
        return Outcome.DETECTED
    if response_size_blocked:
        return Outcome.BLOCKED
    if response_inspected:
        return Outcome.ALLOWED
    return Outcome.NOT_EVALUATED
