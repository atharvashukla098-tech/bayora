# Bayora — Architecture

## Components and the request→release pipeline

```
Harness ──POST /v1/evaluate──▶ Broker ──▶ MockTarget (in-process / HTTP)
                                   │            │
                                   ▼            ▼
                          Request policy    raw response
                                   │            │
                                   ▼            ▼
                            (BLOCK?)      Response policy: canary REDACT
                                   │            + re-scan, fs-write DETECT
                                   ▼            ▼
                              Ledger  ◀──── RESPONSE_RELEASED
                                   │
                                   ▼
                        Verifier / Checkpoints / Report
```

Enforcement order (blueprint §7.4): **rate gate → size gate (Content-Length)
→ schema gate → ingress event → concurrency gate → request policy → target
call (asyncio.wait_for) → response policy (redact + re-scan the ACTUAL
released text) → RESPONSE_RELEASED → single outcome**. Blocking happens
strictly before the target call (spy-asserted in block mode, D17).

### Outcome precedence (D11 — normative)

| # | Condition | outcome |
|---|---|---|
| 1 | target faulted | ERROR |
| 2 | request blocked pre-call | BLOCKED |
| 3 | redaction removed ≥1 canary | REDACTED (outranks request-side DETECTED) |
| 4 | fs-write marker matched | DETECTED |
| 5 | injection heuristic matched (forward) | DETECTED |
| 6 | released text over cap | BLOCKED |
| 7 | clean | ALLOWED |
| 8 | response never inspected | NOT_EVALUATED |

### Outcome ↔ HTTP status (D20 — normative)

200 released · 403 injection-block/destination-rejected (BLOCKED) ·
429 rate/too-busy (NOT_EVALUATED) · 413 size (NOT_EVALUATED) ·
422 schema (NOT_EVALUATED) · 504 timeout (ERROR) · 502 target error (ERROR) ·
500 internal (ERROR). **Every error body is exactly
`{"error", "outcome", "detail", "run_id"}`** — static messages only; the
submitted values are never echoed (D13).

## Why the rate/size middleware RETURN instead of raising (D21)

Starlette builds the stack as `ServerErrorMiddleware(ExceptionMiddleware(Router))`.
App-level exception handlers are registered on `ExceptionMiddleware`, which
wraps **only the router** — an exception raised in app-added middleware
propagates past it and surfaces as a 500. Therefore both gates return their
`BrokerErrorBody` themselves; the `OversizeError` handler serves only the
in-handler double gate (chunked / absent Content-Length), whose raise happens
in router scope.

## The in-process transport is TestClient over the real ASGI app (D23)

`InProcessBrokerClient` = `TestClient(broker_app, raise_server_exceptions=False)`:
httpx in memory, zero sockets, but the FULL middleware stack runs — SC-06's
413/422 behavior offline is the same code path as under Docker.

## The async target client (D22)

`TargetClient.call` is a coroutine — forced, not chosen: `asyncio.wait_for`
over a sync return value raises TypeError, and the TIMEOUT behavior must hold
the coroutine open past the deadline so the gate cancels genuinely in-flight
work. The mock's TIMEOUT behavior sleeps past any configured deadline.

## Hash chain + checkpoints

- Canonical bytes: fixed field order, `separators=(",",":")`, `detail` keys
  SORTED (D24), hash input excludes the event's own `hash`, includes
  `prev_hash`. `scripts/verify_ledger.py --explain` prints the rules.
- Checkpoints: Ed25519 over `CHECKPOINT_SIGNED_FIELDS` (signature excluded
  from signing input). `checkpoint_at_head` refreshes at the exact current
  head and appends NOTHING to the ledger (D25) — so
  `checkpoint_seq == block_height` holds after refresh, making truncation
  detectable by construction (D12). A strict prefix of the checkpoint's
  coverage is reported `BELOW_CHECKPOINT + CHECKPOINT_PREFIX_MISMATCH`,
  never as valid-but-shorter.
- Cadence: at every `checkpoint_every` events the Ledger signs FIRST, then
  appends the `CHECKPOINT_SIGNED` announcement — a checkpoint never covers
  its own announcement.

## Mock target trigger table (spec §3.3, documented mapping)

| Trigger (substring, first match wins) | Behavior | Output |
|---|---|---|
| "ignore previous"/"disregard the system" | INJECTION_FOLLOWED | echo preamble + rest |
| "print the secret", canary+reveal/leak, api key+reveal | CANARY_DISCLOSURE | raw synthetic canary placed in the response |
| "write" + /etc/ or passwd or protected | FS_WRITE_ATTEMPT | the exact `fs-1` marker phrase (simulated only) |
| "malformed" | MALFORMED | noise text |
| "timeout"/"hang" | TIMEOUT | normal text + latency past any deadline |
| else | BENIGN | "Acknowledged: " + prompt |

The mock never reads `scenario_id` or any control field (D7). The FS-write
behavior is a simulation report; the real filesystem control is the
Docker-gated EROFS test (SC-04r).

## Destination model

`EvaluateRequest` has no URL field (`extra="forbid"` makes a smuggled
`destination` key a 422 by itself). The only route that names a URL is
`POST /v1/check-destination` — policy-only, never dials. The allowlist
matches scheme+host+port exactly.

## Docker trust boundaries

- `internal_net` is `internal: true` — no default route; external packets are
  typically silently dropped, so the probe battery counts only positive
  denial signals (refused / unreachable / DNS failure) from the EXTERNAL
  probes 4–6 as evidence; the on-link machinery probe is a control (D16).
- The target is never published; only the broker binds `127.0.0.1:8010`.
- Target: non-root, `read_only: true`, `cap_drop ALL`, no-new-privileges,
  tmpfs `/tmp`, pids/mem/cpu limits, zero mounts, no docker.sock.
- The runtime battery executes IN-CONTAINER via `docker compose exec`
  (D26) — host-run probes prove nothing about the container's namespace.

## Report verification protocol (D15 — two-party)

The report's `status` attests to RUN evidence only (chain, checkpoint,
truncation check, counts); it never reads its own signature — that would be
circular. The independent `--verify` path enforces the signature over the
canonical bytes (everything except `report_signature.signature`; `key_id`,
`status`, `verification_steps`, `limitations` are all signed), re-verifies
the referenced ledger from scratch, AND BINDS the freshly-verified chain to
the SIGNED report contents — not by heights alone (two deterministic runs
produce equal heights and checkpoint seqs), but by FOUR signed facts:

1. **run identity** — the referenced chain's `run_id` must equal the
   report's signed `run_id`;
2. **height** — `checked_height == signed block_height`;
3. **checkpoint content** — the attested `checkpoint_seq` matches the
   sidecar's, the sidecar's signed `final_event_hash` matches the
   referenced chain's event at that seq, the sidecar's `ledger_id` matches
   the chain's run, and the SIGNED `checkpoint_final_event_hash` in the
   report's ledger block matches too (a re-signed foreign checkpoint cannot
   re-bind the attestation);
4. **evidence ids** — every attested `evidence_event_id` in
   `scenario_results` must exist in the referenced chain.

`ledger_path` (the one unsigned field) is only a provenance pointer for
re-finding the evidence; with these checks a re-pointed report can never
re-bind its attestation to foreign evidence — even a same-height,
same-checkpoint-seq foreign ledger is REJECTED. ACCEPT additionally
requires recorded status ∈ {VERIFIED, VERIFIED_WITH_LIMITATIONS} AND a
valid signature (or signing disabled with the recorded limitation). A
VERIFIED* unsigned report is REJECTED with exit 1.

## Rate limiting + rejection budget (D27)

Per-client token bucket (120/min default) gates before size and covers EVERY
route that can write evidence — `/v1/evaluate` AND `/v1/check-destination`
(a flood on either must never mean one fsynced ledger event per call).
Rejections (size/schema/rate/busy/destination) flow through a
`RejectionBuffer`: the first `max_error_events_per_run` are committed
individually, the remainder collapse into per-window `REJECTIONS_SUMMARY`
events with per-reason counts. **Every scene process drains the buffer at
exit (`flush()`, blueprint §7.4 step 10)** — a burst that ends inside a
window is summarized on the ledger, never dropped with the process. Ledger
growth under hostile flooding is O(windows), not O(requests).

## Run lifecycle (blueprint §9.2 + D25)

The demo pipeline emits the blueprint's full run lifecycle: `RUN_STARTED`
(baseline scene), a `VERIFICATION_PERFORMED` event + `verifications.jsonl`
record per tamper-scenario verification (D8), and at the report scene —
before the report is built, so the attestation covers the FINAL chain —
`RUN_COMPLETED` (detail: outcome + six-part counts), the completion
checkpoint issuance (sign the head FIRST, then append the
`CHECKPOINT_SIGNED` announcement — D25's "used exactly twice" contract),
and `state.json → status: complete`, so a finished run is distinguishable
from an interrupted one. `runtime_tests.json` accumulates BOTH runtime
batteries under their scenario ids (`{"batteries": {"SC-03r": …,
"SC-04r": …}}`) — SC-03r's external-denial probe record survives SC-04r's
run instead of being overwritten.

## Six outcome states — one meaning everywhere

DETECTED (control observed; response path ran) · BLOCKED (stopped before
release) · REDACTED (released with canary removed) · ALLOWED (inspected,
clean, unmodified) · ERROR (infrastructure fault — never success) ·
NOT_EVALUATED (never inspected — recorded, never guessed). Matrix results:
PASS only when the named assertion executed and held; SKIPPED carries its
reason; ERROR is an infrastructure fault, never a control verdict.
