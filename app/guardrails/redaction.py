"""Canary redaction + verification against the ACTUAL released text (spec §3.4).

``verify_redaction`` rescans the text the caller actually receives — the test
inspects the released response, never a log line.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict

REDACTION_TOKEN = "[REDACTED-BAYORA]"
CANARY_PREFIX = "BAYORA-CANARY"


class RedactionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    redacted_text: str
    matches: int
    redaction_ids: list[str]      # stable ids r1..rN


def redact(text: str, canary_value: str, canary_id: str) -> RedactionResult:
    """Replace every canary occurrence (and bare prefix runs) with the token.

    Ids r1..rN are stable and positional; count is the number of replacements.
    """
    _ = canary_id
    redaction_ids: list[str] = []

    # Exact-value occurrences first (the control that matters).
    n_value = text.count(canary_value)
    out = text.replace(canary_value, REDACTION_TOKEN)
    for i in range(n_value):
        redaction_ids.append(f"r{i + 1}")

    # Bare prefix runs (partial leakage like "BAYORA-CANARY-8f9b" fragments).
    prefix_pattern = re.compile(re.escape(CANARY_PREFIX) + r"[A-Za-z0-9\-]*")
    n_prefix = len(prefix_pattern.findall(out))
    if n_prefix:
        out = prefix_pattern.sub(REDACTION_TOKEN, out)
        start = len(redaction_ids)
        for i in range(n_prefix):
            redaction_ids.append(f"r{start + i + 1}")

    return RedactionResult(redacted_text=out, matches=n_value + n_prefix,
                           redaction_ids=redaction_ids)


def verify_redaction(released_text: str, canary_value: str, canary_id: str) -> bool:
    """Rescan the released text: True iff NO canary trace remains."""
    _ = canary_id
    if canary_value and canary_value in released_text:
        return False
    if CANARY_PREFIX in released_text:
        return False
    return True
