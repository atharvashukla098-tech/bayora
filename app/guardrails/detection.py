"""Detection functions (blueprint §8.1).

Limitations, documented here and in the threat model: the injection/fs-write
heuristics are pattern-based; a novel phrasing passes them. That is why
detection is DETECTED, never conflated with containment, and why the canary
check is EXACT-VALUE (the control that matters) while injection/fs-write
detection is advisory (D6, D18). Spec §3.2's "do not rely on a classifier
alone" is satisfied: the exact-value canary rule, not any regex, is the
security boundary. The returned ids (never matched text) are what the ledger
records.
"""

from __future__ import annotations

import re


def _parse_patterns(patterns: list[str]) -> list[tuple[str, re.Pattern]]:
    out: list[tuple[str, re.Pattern]] = []
    for entry in patterns:
        pid, _, regex = entry.partition(":")
        out.append((pid, re.compile(regex)))
    return out


def scan_injection(text: str, patterns: list[str]) -> list[str]:
    """Return matched pattern ids ('inj-3'), never the matched text."""
    matched: list[str] = []
    for pid, pattern in _parse_patterns(patterns):
        if pattern.search(text):
            matched.append(pid)
    return matched


def scan_fs_write(text: str, patterns: list[str]) -> list[str]:
    """Same '<id>:<regex>' convention with fs-1/fs-2 (D18 simulation markers)."""
    matched: list[str] = []
    for pid, pattern in _parse_patterns(patterns):
        if pattern.search(text):
            matched.append(pid)
    return matched


def scan_canary(text: str, canary_value: str, canary_id: str) -> bool:
    """Exact substring match on canary_value — the value is data, not a pattern."""
    _ = canary_id
    return canary_value in text


def scan_for_prefix(text: str, prefix: str) -> bool:
    """Looser prefix check catching partial 'BAYORA-CANARY-…' leakage."""
    return prefix in text
