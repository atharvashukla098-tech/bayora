"""Blue guardrail package."""

from app.guardrails.detection import scan_canary, scan_for_prefix, scan_fs_write, scan_injection
from app.guardrails.redaction import RedactionResult, redact, verify_redaction
from app.guardrails.policy import (
    PolicyRules, RequestDecision, ResponseDecision, resolve_outcome,
)
from app.target.adapter import destination_allowed  # allowlist check (SC-03 + client)

__all__ = [
    "scan_canary", "scan_for_prefix", "scan_fs_write", "scan_injection",
    "RedactionResult", "redact", "verify_redaction",
    "PolicyRules", "RequestDecision", "ResponseDecision", "resolve_outcome",
    "destination_allowed",
]
