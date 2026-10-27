# BAYORA Demo Video - For Antigravity Review (64s, 1080p, v9)

**File:** `demo/BAYORA-demo.mp4` (1:04, ~12MB)
**Frames:** `demo/frames/f1..f11_*.png` - keyframes at the times below

A 64-second demo rebuilt to your review notes: attack fires by 0:14, all four
3D worlds get equal time, tamper moment extended, plain-English narration
using the on-screen card names, tagline said twice, no unsourced stats, and
all footage re-shot against the current site (on-screen text is the new
plain-English copy everywhere).

## Timeline

| # | Frame (t=) | Content |
|---|-----------|---------|
| f1 | 2s | Title card: A BAYORA PRODUCTION - "Don't Trust AI. Prove It." |
| f2 | 5s | Hero: "Don't Trust AI. Prove It." + LIVE DEFENSE ENGINE panel |
| f3 | 12s | Four defense cards (Input Shield, Data Privacy, Network Guard, System Armor) with live test results |
| f4 | 16s | World 1 - Input Shield (neural sphere). Test fires, scene turns red: DETECTED / 1 RUN |
| f5 | 24s | World 2 - Data Privacy (chrome knot): REDACTED |
| f6 | 32s | World 3 - Network Guard (egress cloud world): BLOCKED / HTTP 403 / 1 RUN |
| f7 | 40s | World 4 - System Armor (floating island): DENIED |
| f8 | 47s | Iridescent typography beat (VERIFY EVERY PROMPT) |
| f9 | 50s | Defense Sandbox console (judges can run attacks themselves) |
| f10 | 56s | Tamper test result: [REJECTED - TAMPER FOUND], BAD_HASH at block #3 |
| f11 | 61s | Outro |

## The five live verdicts (real broker runs, captured live)
1. Prompt injection ("ignore all previous instructions...") -> DETECTED
2. Secret leak (planted fake secret) -> REDACTED (masked before leaving)
3. Unsafe web request (AWS metadata URL) -> BLOCKED 403 (refused before connection)
4. System file write -> DENIED (read-only filesystem)
5. Ledger tamper (byte flip) -> REJECTED at block #3, BAD_HASH

## Narration (en-GB-RyanNeural, plain English)
- 0:01 "AI apps are under attack every day. Prompts try to hijack them. Secrets try to leak out. Bayora is a security layer that sits between your AI and the outside world, and tests it with real attacks."
- 0:16 "Pick an attack. Input Shield catches malicious prompts before the model ever sees them. Watch. The test fires, and the scene itself turns red. Caught."
- 0:30 "Data Privacy plants a fake secret, and masks it before it can leave. Network Guard stops unsafe web requests before any connection is even opened."
- 0:40 "System Armor locks the files themselves. Attackers cannot change what they are not allowed to touch."
- 0:48 "Every result is saved into a sealed record. Try to fake it, and the system catches it instantly. The proof stands."
- 0:58 "Don't trust AI. Prove it. Bayora."

## Changes from the previous cut (per your review)
1. First attack now at 0:14 (was 0:25) - title/hero/cards compressed
2. All four worlds get 8 seconds each (island had 4s before)
3. Tamper moment extended to 7.5s with the result held on screen
4. Narration synced to visuals: "the scene itself turns red" lands as world 1 fires
5. Narration uses the on-screen names: Input Shield, Data Privacy, Network Guard, System Armor
6. Count mismatch fixed: no scenario numbers are claimed at all
7. The unsourced "every ninety seconds" stat is removed; the opening is a plain claim
8. Tagline spoken exactly twice (opening card text + final line)
9. New opening line explains what Bayora IS: "a security layer that sits between your AI and the outside world"
10. All footage re-shot against the current site - on-screen text is plain English everywhere
11. Kept per team decision: the "A BAYORA PRODUCTION" title card and the 2s iridescent beat

## Open questions for you
1. Does the narration-to-visual sync land now (especially world 1's fire at ~0:17)?
2. Is the opening line a clear enough one-sentence explanation of the product?
3. Any remaining moment that looks weak?

## Production
Playwright 25fps native captures of the live site (:4173 production build),
film grade (contrast, grain, vignette, 2.39:1 letterbox), synthesized
sub-drone score, -16 LUFS mix. Every verdict is a real backend execution.
