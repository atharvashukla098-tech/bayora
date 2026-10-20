# Bayora — Threat Model and Limitations

## Assets

- Synthetic canary values (per-run, generated — never real credentials)
- Evaluation inputs and outputs
- The audit ledger and its sidecars (checkpoint.json, verifications.jsonl)
- Ed25519 signing keys (`keys/demo_signing_key.pem`)
- Policy configuration (allowlist, limits, pattern sets)
- Runtime integrity of the target container
- Exported evaluation reports

## Adversaries

| Adversary | Goal | What stops them | What does not |
|---|---|---|---|
| Malicious prompt crafter | trick the target into leaking the canary | exact-value canary scan + redaction + re-scan of the released text | regex heuristics (novel phrasings pass — advisory only, L2) |
| URL smuggler | exfiltrate to an arbitrary host | `extra="forbid"` schema; no URL field on evaluate; policy-only check-destination | a compromised host process with its own sockets (out of scope, L6) |
| Local evidence-flooder | grow the ledger without bound via rejected posts | rate bucket + rejection cap + per-window summaries (D27) | CPU burn; one summary line per window per run still grows slowly (L9) |
| Local tamperer | rewrite the ledger unnoticed | hash chain (any byte/seq/link change) + signed checkpoints vs truncation | a full rewrite WITH the signing key, or without any checkpoint (L3/L4) |
| Report forger | fake a passing report | signature over canonical bytes incl. status/counts/limitations | a stolen private key (L4) |
| Stale-status exploiter | pass off an old verification as current | STALE logic: checked_height must equal block_height at display time (D8) | nothing — recorded verifications are persistent facts |
| Container escapee | egress to the internet / write the rootfs | internal-only network, read-only rootfs, cap-drop, non-root (Docker-gated evidence, D26) | environments without Docker (honest SKIPPED, L5) |

## Trust boundaries

1. **Harness ↔ Broker**: untrusted requests; schema-validated, rate/size-gated.
2. **Broker ↔ Target**: the only egress path; allowlist consulted before dialing.
3. **Broker ↔ Caller**: no-echo error contract; loopback-only deployment (L7).
4. **Ledger ↔ Verifier**: the verifier re-implements hashing from the schema module only — a writer bug cannot hide in the reader.
5. **Key ↔ Host**: dev PEM on disk; a compromised host forges everything (L6).

## What the initial version does NOT guarantee

- Universal prompt-injection prevention (heuristic detection only).
- Protection against every model behavior (the target is a documented mock, L1).
- Security of a compromised host (L6).
- Protection against a stolen signing key (L4).
- Historical proof without a trusted checkpoint (L3) — the verifier prints
  "truncation check: NOT POSSIBLE" rather than guessing.
- Any compliance certification (SOC 2 or otherwise).
- General-purpose pentesting of arbitrary AI systems (L8).

## Design consequence

The canary control is exact-value and verified against the actual released
response (spec §3.4) — it is the security boundary. Injection and fs-write
detection are advisory DETECT layers whose misses are recorded as evidence,
never silently absorbed. Every layer's verdict is one of six states with one
meaning everywhere, and a SKIPPED/UNAVAILABLE result can never become PASS.
