# BAYORA Demo Video — For Antigravity Review (76s, 1080p)

**File:** `demo/BAYORA-demo.mp4` (1:16, 16MB)
**Frames:** `demo/frames/f1..f11_*.png` — keyframes at the moments below (use these if you cannot play video)

## What this video shows
A 76-second festival cut of the BAYORA product demo. Every verdict on screen is a **real backend execution** — no staged UI. Structure:

| # | Frame (t=) | Content |
|---|-----------|---------|
| f1 | 2s | Title card: A BAYORA PRODUCTION — "Don't Trust AI. Prove It." |
| f2 | 6s | Hero: light landing scroll ("Don't Trust AI. Prove It." + live stages card) |
| f3 | 15s | Dark hero: MATHEMATICAL ATTESTATION + Ed25519 / 0 BYTES / STRICT spec dock |
| f4 | 25s | Four defense cards row (SC-01..04) |
| f5 | 35s | SC-01 Neural Gateway 3D world — FIRED: red alarm state, DETECTED / 1 RUN |
| f6 | 44s | SC-02 Canary Knot 3D world — FIRED: REDACTED / 1 RUN |
| f7 | 53s | SC-04 island world — the EROFS seal |
| f8 | 57s | Iridescent typography beat (VERIFY EVERY PROMPT / CONTAIN AT THE ROOT) |
| f9 | 60s | Defense sandbox console (attack-test tab) |
| f10 | 68s | Tamper test result: [REJECTED - TAMPER FOUND], BAD_HASH at block #3, cryptographic fraud detected |
| f11 | 73s | Outro over hero |

## The four live verdicts (real broker runs, captured live)
1. SC-01 prompt injection → **DETECTED** (inj-1 + inj-3 matched, world goes red)
2. SC-02 canary exfiltration → **REDACTED** (exact-value canary scan)
3. SC-03 SSRF/egress → **BLOCKED** (allowlist answers before socket)
4. SC-04 filesystem write → **DENIED** (kernel EROFS)
5. Ledger tamper (byte flip) → **REJECTED at block #3, BAD_HASH**

## Narration (voice: en-GB-RyanNeural, "hard realistic" male, light British)
- 0:01 "Every ninety seconds, a language model does exactly what it was told. Not what its owner intended. Bayora makes AI security provable."
- 0:13 "Don't trust AI. Prove it. Four attack scenarios, real tests, real verdicts."
- 0:22 "A prompt injection crosses the wire. The broker reads it before the model ever sees it. Detected. Contained."
- 0:32 "A canary token tries to escape. The guardrail finds it and rips it from the stream. Redacted. An unsafe request hits the egress boundary. Blocked before a socket is ever built. A hostile write hits the filesystem. The kernel itself refuses. The seal holds."
- 0:55 "Every result is sealed into a hash chain. Corrupt one byte, and the verifier catches it instantly. Bad hash. Tamper rejected."
- 1:07 "Fourteen scenarios. Zero trust. Don't trust AI. Prove it. Bayora."

## What we'd like reviewed
1. Pacing/energy of the 76s cut (festival cap is 60–90s)
2. Does the narration land the value proposition clearly for non-technical judges?
3. Any visual moment that looks weak/fake vs. premium?
4. Anything missing a first-time viewer would need to understand the product?

## Production
- Footage: user's own screen recordings (hero/cards/console) + Playwright 25fps native captures (fired 3D worlds)
- Film grade: contrast curves, grain, vignette, 2.39:1 letterbox
- Score: synthesized sub-drone (D1+A1, tremolo, dark reverb), -16 LUFS mix
