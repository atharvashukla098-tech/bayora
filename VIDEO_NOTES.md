# BAYORA Demo Video — Production Notes (68s festival cut, v12)

## Files
- `BAYORA-demo.mp4` (~4.4MB) — 68s master, 1080p30, stereo
- Runtime: 1:08 (target: 65–75s per review)
- Live Web Application: `https://bayora-defense.vercel.app`

## 7-scene structure (Refined per Final Judges' Review)
1. 0:00 Threat — matte title card (tightened to 3–4s max): "AI CAN BE ATTACKED. CAN ITS DEFENSES BE VERIFIED?"
2. 0:04 Product Introduction — website appears swiftly; live/browser WebCrypto execution mode clearly labeled.
3. 0:08 Attack Sequence Begins — real canary-leak query dispatched; raw target model output leaks the secret.
4. 0:16 Interception — broker scrub: released output shows `[REDACTED-BAYORA]`; client policy timing labeled.
5. 0:24 Containment — 5-stage architecture (Red Harness → Policy Broker → Target Model → Blue Guardrail → Audit Ledger).
6. 0:34 Evidence — SHA-256 block hash + Ed25519 asymmetric receipt, SEALED & ATTESTED.
7. 0:43 The proof — one-byte tamper: `TAMPER DETECTED · BAD_HASH AT BLOCK #0056`
   - Explicit confirmation: `ORIGINAL RECORD: VALID` vs `ALTERED COPY: REJECTED — HASH MISMATCH`
   - Real WebCrypto digest mismatch held ~10s as the deliberate climax.
8. 0:58 Takeaway & Closing Card —
   - Headline: "TEST THE ATTACK. ENFORCE THE POLICY. VERIFY THE EVIDENCE."
   - Primary Call-to-Action: **`bayora-defense.vercel.app`** (prominent interactive destination).
   - Secondary underneath: `github.com/atharvashukla098-tech/bayora`

## Review Fixes Applied
- **Timing & Pace**: Title card shortened from 6–8s down to 3–4s; product introduced immediately with attack running by 8s.
- **Accurate Labeling**:
  - Stats on homepage clearly separated into: `4 DEFENSE LAYERS`, `14 SCENARIOS IN CATALOGUE`, `6 GUIDED DEMO STAGES`.
  - Browser demo honestly labeled: `IN-BROWSER DEMO (SYNTHETIC CANARY · WEBCRYPTO)` vs `LIVE BACKEND DAEMON`.
  - Latency clearly qualified as client policy evaluation timing.
- **Precision Terminology**: Shifted from dramatic "FRAUD DETECTED" to professional "TAMPER DETECTED · BAD_HASH AT BLOCK #0056", explicitly confirming `ORIGINAL RECORD: VALID` and `ALTERED COPY: REJECTED — HASH MISMATCH`.
- **Primary CTA**: `bayora-defense.vercel.app` placed front-and-center on final card and footer.
- **Scroll & Transition**: Transition into zero-trust terminal elevated to prevent header clipping by overlays or tickers.

## Voice & Audio
en-GB-RyanNeural, plain English, no conflated scenario counts, names match on-screen labels, continuous narration (~0.2s gaps max).

## Visual Direction
Matte, restrained: zero neon glows, zero film grain, zero letterbox bars. Red for detected threats, muted teal for policy, white for verified cryptographic evidence.
