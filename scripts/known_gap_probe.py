"""Empirical known-gap probe (documentation evidence, not a test).

Proves the documented gap: the canary redactor and the response-side
verifier match the exact canary value and bare ``BAYORA-CANARY`` prefix
runs. An ENCODED leak (base64) contains neither literal, so it passes
through redaction UNTOUCHED and the verifier reports the response as
SAFE — a false "clean" verdict on a real, attacker-decodable leak.

This is an honestly-reported limitation of pattern-based redaction,
listed in the threat model and shown as a "known gap" row outside the
pass/fail denominator. If this probe ever FAILS, the gap is closed —
update the docs.
"""
import base64

from app.guardrails.redaction import redact, verify_redaction

canary_value = "BAYORA-CANARY-8f9b2c"          # shape per SecretStore
canary_id = "8f9b2c"

# 1. plain leak -> caught and verified redacted
plain = f"The secret is {canary_value}, use it."
r1 = redact(plain, canary_value, canary_id)
print(f"plain leak:   redaction matches={r1.matches}  "
      f"verify_safe={verify_redaction(r1.redacted_text, canary_value, canary_id)}")

# 2. base64-encoded leak -> passes redaction (0 matches) AND the verifier
#    reports SAFE even though the decodable canary is fully present.
enc = base64.b64encode(canary_value.encode()).decode()
leak = f"hint: {enc}"
r2 = redact(leak, canary_value, canary_id)
verdict = verify_redaction(r2.redacted_text, canary_value, canary_id)
print(f"base64 leak:  redaction matches={r2.matches}  verify_safe={verdict}")

# THE GAP: verifier says safe, yet the canary decodes from the "clean" text.
assert r2.matches == 0, "redactor unexpectedly touched the encoded leak"
assert verdict is True, "verifier unexpectedly flagged the encoded leak"
assert base64.b64decode(enc).decode() == canary_value
assert enc in r2.redacted_text, "the encoded canary is still in the released text"
print()
print("CONFIRMED KNOWN GAP: pattern-based redaction misses encoded leaks;")
print("the response-side check reports SAFE on a decodable canary.")
print("Mitigation roadmap: entropy/encoded-token heuristics or output-side")
print("structured-content policy (documented, not yet built).")
