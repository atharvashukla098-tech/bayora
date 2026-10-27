# Bayora — Zero-Trust AI Red-Teaming Sandbox

Team Binary Blizzards · v1.0.0 · offline-first, mock-first, evidence-first.

**Bayora does not merely report that a security test passed. It connects the
attack attempt, the enforcement decision, the observed outcome, and the
cryptographically verifiable evidence into one traceable evaluation.**

```
RED HARNESS  →  POLICY BROKER  →  MOCK TARGET  →  BLUE GUARDRAIL
                                                      ↓
REPORT  ←  VERIFIER  ←  SIGNED CHECKPOINTS  ←  AUDIT LEDGER (SHA-256 chain)
```

## Quickstart (Windows / git-bash, offline)

```bash
# 1. create the venv and install pinned deps (any python >= 3.12)
python -m venv venv
./venv/Scripts/python.exe -m pip install -r requirements.txt -r requirements-dev.txt

# 2. run the full test suite (unit + integration + security + runtime gates)
./venv/Scripts/python.exe -m pytest

# 3. run the 6-scene judge demo (exit 0, prints every status from real results)
PYTHON=./venv/Scripts/python.exe ./demo.sh

# 4. (optional) launch the incident-response dashboard (Forensic Dossier UI)
./venv/Scripts/python.exe -m pip install -r requirements-dashboard.txt
./venv/Scripts/python.exe -m streamlit run app/dashboard/app.py

# 5. (optional) launch the public 3D evidence site
./venv/Scripts/python.exe -m app.site_server      # -> http://127.0.0.1:8010
```

The **public site** (`site/`) is a scroll-driven WebGL experience built on
the same run artifacts: the hash-chained ledger rendered as a 3D strand,
the attack that was intercepted, a tamper that breaks the chain, and the
signed attestation. It is free to run and free to host — three.js (MIT) and
the OFL fonts are vendored into the repo, so the browser makes **zero
external requests**. See `docs/site.md` for the chapter map, the data
contract and the design tokens.

The dashboard is offline and artifact-driven: it reads the run artifacts in
`runs/<run_id>/` (ledger, state, demo result, signed report) through
`app/dashboard/artifact_client.py` — no HTTP server, no new attack surface.
Its theme lives in `.streamlit/config.toml` (aged-paper dossier, no CDN
assets). It shows the live interception stream, the attacker-versus-target
matrix with explicit denominators, the disposable-copy tamper demo (it
executes `scripts/tamper_demo.py` and prints the real hashes), and the
signed attestation whose status is recomputed in the UI rather than
trusted from the report's own `status` field.

No network is used at runtime: the target is the deterministic in-process
mock, the transport is Starlette's TestClient over the real ASGI app, and the
runtime containment rows (SC-03r/SC-04r) report **SKIPPED — never PASS —**
when Docker is absent (the probe is live, `docker info` + `docker compose
version`). With Docker present, run the in-container battery:

```bash
docker compose up -d --wait && ./venv/Scripts/python.exe -m pytest tests/runtime -m ""
```

## Honest claims table

| Claim | State | Evidence |
|---|---|---|
| RED HARNESS — scenarios w/ unique run IDs | **SHIPPED** | `app/harness/`, 14-scenario catalogue §12, `tests/integration/test_harness_broker_flow.py` |
| POLICY BROKER — typed validation, size/rate/timeout/concurrency limits | **SHIPPED** | `app/broker/`, all four limits live; `tests/unit/test_validation.py`, `test_rate_limiting.py` |
| BLUE GUARDRAIL — canary detect + redact | **SHIPPED** | `app/guardrails/`; `tests/security/test_canary_no_escape.py` |
| HASH-CHAINED LEDGER — SHA-256 links | **SHIPPED** | `app/ledger/`; `tests/unit/test_chain_verification.py`, `tests/security/test_tamper_detection.py` |
| SIGNED CHECKPOINTS — Ed25519 anchors | **SHIPPED** (dev key; production key mgmt stays PLANNED) | `app/ledger/checkpoints.py`; tamper demo prints real expected/computed hashes |
| RUNTIME CONTAINMENT — net/fs restrictions | **STAGED HONESTLY** | Docker-gated in-container battery; SKIPPED without Docker, never PASS; PASS requires positive denial signals (D16) |
| Tamper demo (slide 7) | **SHIPPED** | `scripts/tamper_demo.py`, real hash output |
| Every assertion reported honestly (pass/fail/skip/…) | **SHIPPED** | six outcome states + four report statuses + `verification_steps[]` |
| Market figures ($1.22B→$11.57B) | **external business claim** | Sourced to the Dataintelo report; not an engineering claim |

## What Bayora does NOT guarantee (L1–L9)

- **L1** The mock proves the controls fire on the defined scenarios, not real-model behavior.
- **L2/L2b** Injection and fs-write detection are regex heuristics / simulation markers — advisory, not a boundary. The canary control is exact-value.
- **L3** A hash chain detects tampering only relative to a trusted checkpoint; the verifier says "NOT POSSIBLE" without one, and a strict prefix is reported as truncation, never as valid-but-shorter.
- **L4** Ed25519 signatures prove integrity + key-based origin only; a stolen dev key defeats them; no non-repudiation, no legal weight, no compliance certification.
- **L5** Runtime containment is verified only where Docker + Compose v2 exist; timeout-only external probes yield NOT_EVALUATED, never PASS.
- **L6** A compromised host can forge everything.
- **L7** The broker has no authn/authz; safe only on loopback / trusted LAN.
- **L8** Not a general-purpose pentest tool.
- **L9** Rate limiting + the rejection budget bound evidence-channel abuse, not compute; flood rejections are summarized, not itemized (the buffer is drained at process exit, so even a burst ending inside a summary window lands as a `rejections.summary` event — never dropped).

## Key scripts

| Command | Purpose |
|---|---|
| `./demo.sh` | 6-scene judge demo; exit 0 only when every required gate passes |
| `python scripts/verify_ledger.py --ledger runs/<id>/ledger.jsonl --explain` | independent verification + canonicalization rules for hand-recomputation |
| `python scripts/tamper_demo.py --ledger … --mode byte\|delete\|reorder\|truncate\|forge\|rehash` | disposable-copy tamper demo (original untouched, byte-verified); `rehash` = the full-rewrite attack where the chain reads VALID and only the SIGNED CHECKPOINT catches it |
| `python scripts/generate_report.py --run <id>` / `--verify <file>` | build+sign / independently verify `audit_report.json` |
| `python scripts/reset_demo.py --confirm` | wipe `runs/` for a clean repeat |

## Verify it yourself (judges: 60 seconds, any laptop)

The evidence is not a screenshot — it is a file you can verify with the
public key, on your machine, offline:

```bash
# 1. trusted public key (pinned; fingerprint below)
python - <<'PY'
from cryptography.hazmat.primitives import serialization
pem = open("keys/demo_public_key.pem","rb").read()
k = serialization.load_pem_public_key(pem)
print("ed25519 fingerprint:", k.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex())
PY

# 2. verify the ledger chain + checkpoint signature
python scripts/verify_ledger.py \
  --ledger runs/demo-20261020-220724-a39d92/ledger.jsonl \
  --checkpoint runs/demo-20261020-220724-a39d92/checkpoint.json \
  --public-key keys/demo_public_key.pem

# 3. try to cheat: edit an event AND recompute every later hash
python scripts/tamper_demo.py \
  --ledger runs/demo-20261020-220724-a39d92/ledger.jsonl \
  --mode rehash --event 3
# chain reads VALID … the signed checkpoint still says REJECTED.
```

The verifier intentionally does not import the ledger writer — it
re-implements the hashing from `app/schema.py` rules only, so a bug in
the writer cannot hide in the reader.

### Pinned public-key fingerprint

`keys/demo_public_key.pem` (Ed25519), raw public key hex:

```
0858c30ea2a84166bd7fc02fef472fe1cc8495fc011766675333e01160409410
```

The verifier refuses any key whose signature does not verify against the
supplied public key; treat the fingerprint above as the identity of the
trusted key. A regenerated key invalidates old signatures (limitation
L4) — which is exactly the failure you would see if the evidence were
forged.


## Layout

See `docs/architecture.md` for the component/pipeline design,
`docs/threat_model.md` for assets/adversaries/limitations,
`docs/security_claims.md` for the shipped-claims ledger, and
`docs/demo_runbook.md` for the 60-second judge script.
