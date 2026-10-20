# Bayora — 60-Second Judge Runbook

## Pre-flight (10s)

```bash
python -m venv venv
./venv/Scripts/python.exe -m pip install -r requirements.txt -r requirements-dev.txt
./venv/Scripts/python.exe scripts/gen_keys.py        # dev Ed25519 keypair
```

Check: `./venv/Scripts/python.exe -m pytest -q` → all green, runtime rows
SKIPPED (Docker absent) or PASS (Docker present). The probe result is
printed live either way.

## The demo (45s)

```bash
PYTHON=./venv/Scripts/python.exe ./demo.sh
```

Say while pointing at the output:

1. **BASELINE** — "A benign request runs end-to-end; the ledger verifies
   VALID and a checkpoint is signed at the exact head."
2. **ADVERSARIAL** — "A prompt injection is DETECTED and forwarded; a canary
   disclosure is intercepted — the response the caller receives contains
   `[REDACTED-BAYORA]`, not the secret."
3. **CONTAINMENT PROOF** — "We recompute the canary-absence assertion on the
   recorded released response — not on a log line."
4. **RUNTIME RESTRICTIONS** — Docker-gated: point at the SKIPPED line as an
   honesty feature when Docker is absent ("we refuse to claim a control we
   did not exercise"); with Docker, the in-container battery shows real
   denial signals.
5. **TAMPER CHALLENGE** — "One byte flipped in a DISPOSABLE copy. The
   expected and computed hashes are live values; the verifier fails at
   event #3; the original is byte-identical and still VALID."
6. **SIGNED REPORT** — "The report is signed; the independent verify path
   re-checks the signature and re-verifies the ledger from scratch before
   ACCEPT."

## Independent verification offer (5s)

```bash
./venv/Scripts/python.exe scripts/verify_ledger.py --ledger runs/<id>/ledger.jsonl --explain
./venv/Scripts/python.exe scripts/generate_report.py --verify runs/<id>/audit_report.json
```

`--explain` prints the canonicalization rules so the judge can recompute
hashes by hand. Flipping any byte in the report or ledger fails verification.

## Reset and repeat

```bash
./venv/Scripts/python.exe scripts/reset_demo.py --confirm
```
