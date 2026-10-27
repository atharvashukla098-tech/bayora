# BAYORA Demo Video — Production Notes (68s festival cut, v11)

## Files
- `BAYORA-demo.mp4` (~4.4MB) — 68s master, 1080p30, stereo
- Same file serves as the upload version (single clean encode)
- Runtime: 1:08 (target: 65–75s per review)

## 7-scene structure (per third review)
1. 0:00 Threat — matte card: "AI CAN BE ATTACKED. CAN ITS DEFENSES BE VERIFIED?"
2. 0:05 Attack — real canary leak, raw output shows the exposed secret
3. 0:15 Interception — broker scrub, released output shows [REDACTED-BAYORA]
4. 0:22 Containment — 5-stage architecture (Red Harness → Policy Broker →
   Target Model → Blue Guardrail → Audit Ledger)
5. 0:35 Evidence — SHA-256 record hash + Ed25519 receipt, SEALED & ATTESTED
6. 0:44 The proof — one-byte tamper: FRAUD DETECTED, BAD_HASH, ALTERED COPY
   REJECTED — the climax, held ~10s, real WebCrypto failure
7. 1:00 Takeaway — "TEST THE ATTACK. ENFORCE THE POLICY. VERIFY THE EVIDENCE."
   + BAYORA + github.com/atharvashukla098-tech/bayora

## The blocker fix
The one-byte tamper test previously rendered its result below the fold —
the test worked but the proof was invisible (looked like an execution
failure). Fixed: result auto-scrolls into view (commit 427091e). All
tamper footage in this cut shows the actual verifier output.

## Voice
en-GB-RyanNeural, plain English, no scenario counts, names match on-screen
labels, continuous narration (~0.2s gaps max).

## Look
Matte, restrained: no neon glows, no grain, no letterbox bars. Red for
detected threats, muted teal for policy, white for verified evidence —
per the review's visual direction.
