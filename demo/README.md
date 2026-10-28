# BAYORA Demo Video - Production Blueprint (68s, 1080p, v12)

**File:** `demo/BAYORA-demo.mp4` (1:08, ~4.4MB)  
**Frames:** `demo/frames/f1..f10_*.png`  
**Primary Interactive Destination:** `https://bayora-defense.vercel.app`  

## Timeline (Refined per Final Review)

| # | Time | Scene | Content |
|---|------|-------|---------|
| f1 | 0:00–0:03 | 1. The threat | Matte title card (3s): "AI CAN BE ATTACKED. CAN ITS DEFENSES BE VERIFIED?" + BAYORA |
| f2 | 0:04–0:07 | 2. Product Intro | Instant transition to live application at `bayora-defense.vercel.app`; clear execution mode banner |
| f3 | 0:08–0:14 | 2. Attack Launch | Real canary-leak attack runs; raw target model output leaks the secret token |
| f4 | 0:15–0:22 | 3. Interception | Broker scrub: released wire output shows `[REDACTED-BAYORA]`; client policy timing labeled |
| f5 | 0:23–0:32 | 4. Containment | The 5-stage architecture: Red Harness / Policy Broker / Target Model / Blue Guardrail / Audit Ledger |
| f6 | 0:33–0:42 | 5. Evidence | Cryptographic receipt: SHA-256 record hash + Ed25519 public key, SEALED & ATTESTED |
| f7 | 0:43–0:49 | 6. The proof (setup) | One-byte tamper dispatched ('E' -> 'X' mutation at byte 160) |
| f8 | 0:50–0:57 | 6. The proof (climax) | `TAMPER DETECTED · BAD_HASH AT BLOCK #0056` |
| f9 | 0:54–0:57 | 6. The proof (hold) | Explicit verifier result: `ORIGINAL RECORD: VALID` · `ALTERED COPY: REJECTED — HASH MISMATCH` |
| f10 | 0:58–1:08 | 7. Takeaway | "TEST THE ATTACK. ENFORCE THE POLICY. VERIFY THE EVIDENCE." + Primary CTA: `bayora-defense.vercel.app` (GitHub repo smaller underneath) |

## Quality & Precision Fixes
- **No Conflated Counts**: Separated into 4 DEFENSE LAYERS, 14 SCENARIOS IN CATALOGUE, and 6 GUIDED DEMO STAGES.
- **Accurate Terminology**: "Tamper detected" replaces "Fraud detected".
- **Truthful Attestation**: Browser demo honestly discloses `IN-BROWSER DEMO (SYNTHETIC CANARY · WEBCRYPTO)` without implying an active backend daemon when offline.
- **Pacing**: Opening title card trimmed to 3s, letting the attack sequence start by 8s and giving the tamper climax a 10s hold.
- **Primary Call to Action**: `bayora-defense.vercel.app` is the prominent URL for technical judges.
