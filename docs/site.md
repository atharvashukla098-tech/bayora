# Bayora — the public 3D evidence site

A scroll-driven WebGL site that tells the Bayora story from **real run
artifacts**: the hash-chained ledger rendered as a 3D strand, the policy
decisions that intercepted an attack, a tamper that breaks the chain, and
the signed attestation at the end.

Everything on the page is read from disk. Nothing is simulated, nothing is
decorative-only, and no verdict is claimed by the 3D view.

---

## Run it

```bash
# 1. produce evidence (the site reads whatever the last run wrote)
./demo.sh

# 2. serve the site (loopback, read-only)
python -m app.site_server            # -> http://127.0.0.1:8010
```

The site reads `/api/site/run.json` (live) and falls back to
`site/data/run-snapshot.json` (static) when the API is not running.

To publish a purely static copy (any static host, no Python process):

```bash
python scripts/export_site_snapshot.py          # writes site/data/run-snapshot.json
```

Deep links: `?ch=0` … `?ch=5` isolate a single chapter — useful for
reviewing or demoing one beat at a time.

---

## The six chapters

| # | Chapter | What the 3D shows | What the copy says |
|---|---------|-------------------|--------------------|
| 0 | Hero | the whole strand, camera drifting | the run's headline numbers |
| 1 | The attack | the ingress block, the adversarial request | what the harness sent, and through what boundary |
| 2 | The decision | the broker block, outcome-coloured | detected ≠ blocked ≠ redacted — different claims |
| 3 | The evidence | the camera travelling the chain, links lighting up | each event carries the previous event's hash |
| 4 | The tamper | a copy of the strand, one block flipped, its link red | the verifier rejects the copy; the original is untouched |
| 5 | The attestation | the head of the chain, the signed checkpoint seal | signed, then verified by a separate path |

---

## Data contract

`GET /api/site/run.json[?run=<run_id>]` returns:

```jsonc
{
  "run":       { "run_id", "started_at", "status", "target_mode",
                 "broker_status", "runtime_status", "offline",
                 "docker_available" },
  "events":    [ { "seq", "ts", "run_id", "event_type", "component",
                   "outcome", "scenario_id", "hash", "prev_hash" } ],
  "matrix":    [ { "scenario_id", "attack_vector", "control", "detection",
                   "action", "result", "evidence", "skip_reason" } ],
  "report":    { /* audit_report.json, as signed */ },
  "checkpoint":{ "checkpoint_seq", "final_event_hash", "key_id",
                 "created_at", "signature_valid" },
  "integrity": { "block_height", "verification", "stale", "as_of_height",
                 "checkpoint_status", "checkpoint_coverage", "head_hash" },
  "summary":   { "total", "passed", "failed", "errors", "skipped",
                 "not_evaluated", "report_status" }
}
```

Rules the bundle obeys (`app/site_bundle.py`):

* **Never fabricate.** A missing artifact is reported as missing.
* **Never leak.** Raw event `detail` is not published at all, and the
  whole bundle passes through the dashboard redaction helper, so no
  canary value or secret can reach a browser.
* **Read-only.** The site exposes no mutating route (enforced by a test).

---

## Design system — "Nocturne Graphite"

| Token | Hex | Role |
|---|---|---|
| `--void` | `#08090B` | canvas base |
| `--ink` | `#0E1013` | glass panels |
| `--bone` | `#EDEAE3` | primary type |
| `--ash` | `#8B8F98` | muted type |
| `--amber` | `#E8A33D` | DETECTED / intercepted |
| `--alarm` | `#E5484D` | BLOCKED / FAIL / tampered |
| `--mint` | `#5FE3A1` | PASS / ALLOWED |
| `--cyan` | `#4CC9F0` | VERIFIED (cryptographic) |
| `--violet` | `#8B7CF6` | ERROR |

Type: **Syne** (display), **Manrope** (body), **JetBrains Mono** (data) —
all SIL OFL, vendored as woff2 in `site/assets/fonts/` with `OFL.txt`.

---

## Cost: zero

| Item | Cost |
|---|---|
| three.js r180 (MIT) | vendored in `site/assets/vendor/` + LICENSE — $0 |
| Webfonts (OFL) | vendored + OFL.txt — $0 |
| CDN / font service / analytics / map tiles | **none** — zero external requests at runtime |
| Python dependencies | **none new** (fastapi + uvicorn already pinned) |
| Hosting | local, or any static host (free tier) |

The site makes no external network request at runtime; a test enforces it
(`tests/integration/test_site_server.py::test_site_makes_no_external_resource_requests`).

---

## Accessibility & robustness

* `prefers-reduced-motion` disables the reveal animations and the scroll
  prompt; the copy remains fully readable.
* If WebGL is unavailable the page says so and the evidence tables stay
  complete and accurate.
* The page works without JavaScript: the copy is in the HTML; only the
  live numbers and the 3D need JS.
* Keyboard: no custom focus traps; every link is reachable.
