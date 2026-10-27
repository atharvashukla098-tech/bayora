# BAYORA Demo Video - For Antigravity Review (68s, 1080p, v11)

**File:** `demo/BAYORA-demo.mp4` (1:08, ~4.4MB)
**Frames:** `demo/frames/f1..f10_*.png` - keyframes at the times below

Rebuilt per your third review, following your 7-scene structure. All footage
is fresh capture of the LIVE product. The blocker you flagged (tamper test
showing an execution failure) is FIXED and is now the climax of the film.

## Timeline (your 7 scenes)

| # | Frame (t=) | Scene | Content |
|---|-----------|-------|---------|
| f1 | 2s | 1. The threat | Matte title card: "AI CAN BE ATTACKED. CAN ITS DEFENSES BE VERIFIED?" + BAYORA |
| f2 | 8s | 2. Attack | Real canary-leak request runs; raw target output shows the exposed secret |
| f3 | 13s | 2. Attack | Raw output vs released output side by side (secret visible in raw) |
| f4 | 18s | 3. Interception | Broker scrub: released wire output shows [REDACTED-BAYORA] |
| f5 | 27s | 4. Containment | The 5-stage architecture: Red Harness / Policy Broker / Target Model / Blue Guardrail / Audit Ledger |
| f6 | 38s | 5. Evidence | Cryptographic receipt: SHA-256 record hash + Ed25519 public key, SEALED & ATTESTED |
| f7 | 47s | 6. The proof | One-byte tamper dispatched (E -> X at byte 160) |
| f8 | 53s | 6. The proof | FRAUD DETECTED - BAD_HASH AT BLOCK #0056, original vs altered hashes, signature failed |
| f9 | 57s | 6. The proof | Long hold on ALTERED COPY REJECTED + the expected/computed digest mismatch |
| f10 | 63s | 7. Takeaway | "TEST THE ATTACK. ENFORCE THE POLICY. VERIFY THE EVIDENCE." + BAYORA + repo URL |

## The blocker, fixed first
You were right: the one-byte tamper test showed an execution failure, not
confirmed proof. Root cause: the tamper result rendered BELOW THE FOLD (the
hero panel is taller than the viewport) - the test itself worked, but the
proof was invisible. Fix: the result now auto-scrolls into view when it
appears (commit 427091e). Re-tested end to end: real WebCrypto SHA-256 digest
mismatch + real Ed25519 signature failure, verified in frame at f8/f9.
No faked animation - the failure on screen is the actual verifier result.

## Feature coverage (your checklist)
- A. Red-team attack + target response: Scene 2 (raw canary leak visible)
- B. Canary redaction with explicit policy decision: Scene 3 (raw vs released side by side)
- C. Trust boundaries: Scene 4 (5 distinct stages, real enforced paths)
- D. Cryptographic audit receipt: Scene 5 (values from the actual event being demonstrated)
- E. One-byte tamper rejection: Scene 6 - the climax, held ~10s
- F. Machine-readable evidence: DOWNLOAD REPORT (.JSON) visible in the console panel; in-browser WebCrypto labeled ("REAL WEBCRYPTO" badge, "LIVE BACKEND - LOCAL - OFFLINE - DETERMINISTIC" status)

## Narration (en-GB-RyanNeural, claims verified)
- 0:00 "AI can be attacked. Can its defenses be verified? Bayora tests real attacks, and proves the results with cryptography."
- 0:11 "A real attack. The prompt asks the model to print a planted secret. The model leaks it. This is the threat."
- 0:20 "The broker intercepts. The secret is masked. The leak never reaches the wire."
- 0:27 "Every component has its own boundary. Red harness. Policy broker. Target model. Blue guardrail. Audit ledger."
- 0:38 "Each event is sealed. SHA-256 hash. Ed25519 signature. Real cryptography, checked in your browser."
- 0:50 "Now the proof. Change one letter. The hash breaks. The signature fails. Rejected."
- 1:00 "Test the attack. Enforce the policy. Verify the evidence. Bayora."

No scenario counts are claimed in narration (your earlier note). Names match
the on-screen labels. The offline/in-browser mode is labeled on screen, not
claimed as the live pipeline.

## Production
Playwright captures of the live product (:4173 production build, live backend
on :8000). Every value on screen (canary, hashes, signature) comes from the
run being recorded. Audio: stereo, peaks -2.3 dBFS, restrained low drone bed,
continuous narration with no long gaps. Visual grade: matte, minimal - no
neon glows, no film grain, no letterbox bars.

## Open questions
1. Does the scene structure now match what you prescribed (threat -> attack -> intercept -> containment -> evidence -> proof -> takeaway)?
2. Is the tamper proof convincing and held long enough (f8/f9, ~10s)?
3. Is the restrained visual direction better than the previous neon-cyan look?
