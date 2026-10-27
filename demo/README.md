# BAYORA Demo Video - For Antigravity Review (68s, 1080p, v10)

**File:** `demo/BAYORA-demo.mp4` (1:08, ~13MB)
**Frames:** `demo/frames/f1..f15_*.png` - keyframes at the times below

Rebuilt per your second review. Headlines: verdicts are now IN FRAME in every
attack scene, each verdict gets its own large 1.5s title card, the tamper
climax is bright and held, the title card has no ghosted page behind it, the
first attack fires at 0:10, the ending is a real end card with the repo URL,
and the audio is now stereo with safe peaks and an audible music bed.

## Timeline

| # | Frame (t=) | Content |
|---|-----------|---------|
| f1 | 1s | Clean title card (flat black, no ghost page) |
| f2 | 4s | Hero (4s) |
| f3 | 8s | Four defense cards (4s) |
| f4 | 14s | World 1 - Input Shield fires; scene turns red |
| f5 | 19s | World 1 verdict IN FRAME: big DETECTED + output diff + audit log |
| f6 | 22s | Verdict card: DETECTED (large, 1.5s) |
| f7 | 27s | World 2 - Data Privacy fires |
| f8 | 32s | World 2 verdict IN FRAME: REDACTED + masked-secret diff |
| f9 | 36s | Verdict card: REDACTED (large, 1.5s) |
| f10 | 42s | World 3 - Network Guard fires |
| f11 | 46s | World 3 verdict IN FRAME: BLOCKED |
| f12 | 52s | World 4 - System Armor fires |
| f13 | 57s | Tamper test: result held bright on screen |
| f14 | 59s | Tamper climax card: REJECTED - TAMPER FOUND (2s) |
| f15 | 66s | End card: BAYORA + tagline + github.com/atharvashukla098-tech/bayora + "TRY THE LIVE SANDBOX YOURSELF" |

## Fixes from your second review
1. Verdicts no longer cropped: every attack scene scrolls the result panel
   (verdict headline, output-vs-released diff, audit log) into frame after
   firing. Verified in frames f5/f8/f11.
2. Each verdict also gets a large dedicated title card for 1.5 seconds.
3. Tamper test: result held ~7s at full brightness, then a 2s climax card.
4. Title card is clean flat black - the Oryzo ghost page is gone.
5. Home page appears once (4s); first attack now at 0:10.
6. Ending is an end card with the repo URL and a spoken call to action.
7. Audio: stereo, peaks -2.7 dBFS (no clipping), audible dark-tone music bed.

## Narration (en-GB-RyanNeural, plain English)
- 0:03 "AI apps are under attack every day. Prompts try to hijack them. Secrets try to leak out. Bayora is a security layer that sits between your AI and the outside world, and tests it with real attacks."
- 0:18 "Pick an attack. Input Shield catches malicious prompts before the model ever sees them. Watch. The test fires, and the scene itself turns red. Caught."
- 0:32 "Data Privacy plants a fake secret, and masks it before it can leave. Network Guard stops unsafe web requests before any connection is even opened."
- 0:42 "System Armor locks the files themselves. Attackers cannot change what they are not allowed to touch."
- 0:50 "Every result is saved into a sealed record. Try to fake it, and the system catches it instantly. The proof stands."
- 0:59 "Don't trust AI. Prove it. Bayora. The sandbox is open. Try it yourself."

## Open questions
1. Are the verdicts readable in-frame now (f5/f8/f11)?
2. Does the ending land (URL + spoken CTA)?
3. Any remaining weak moment?

## Production
Playwright captures of the live site (:4173 production build); every verdict
is a real backend execution. Verdict cards + end card rendered clean.
