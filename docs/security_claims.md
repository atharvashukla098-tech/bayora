# Bayora — Security Claims Ledger

Every SHIPPED badge maps to a code path and the test that proves it.

## Shipped claims

| Claim | Code path | Test |
|---|---|---|
| Typed request validation, no echo | `app/broker/models.py`, `service.py` handlers | `tests/security/test_oversized_malformed.py::test_422_body_is_brokererror_never_echoes_input` |
| Size limit (413, both gates) | broker middleware + in-handler double gate | `test_oversize_content_length_returns_413_from_middleware`, `test_oversize_handler_path_413_chunked` |
| Rate limit (429) | `app/broker/ratelimit.py` TokenBucket | `tests/security/test_rate_limit_abuse.py::test_rate_limit_returns_429_not_evaluated` |
| Concurrency limit | semaphore gate | `tests/unit/test_error_handling.py` (mapping table) |
| Timeout gate cancels in-flight work | async client + `wait_for` (D22) | `tests/unit/test_error_handling.py::test_wait_for_cancels_sleeping_target` |
| Block precedes target call | request policy step (D17) | `tests/integration/test_enforcement_before_release.py::test_block_mode_never_calls_target` |
| Canary exact-value detection + redaction | `app/guardrails/` | `tests/security/test_canary_no_escape.py` |
| Redaction verified on the released response | broker re-scan (spec §3.4) | `test_canary_absent_from_released_text`, containment scene |
| Destination allowlist, policy-only route | `check-destination` (D20) | `tests/security/test_destination_rejection.py` |
| Hash chain detects byte/seq/link/reorder damage | `app/ledger/verifier.py` | `tests/unit/test_chain_verification.py`, `tests/security/test_tamper_detection.py` |
| Truncation detected vs trusted checkpoint (D12) | `CHECKPOINT_PREFIX_MISMATCH` | `tests/unit/test_checkpoints.py::test_truncation_below_checkpoint_always_detected` |
| Invalid checkpoint signatures rejected | Ed25519 verify (D4) | `tests/security/test_signature_rejection.py::test_forged_checkpoint_fails` |
| Tamper demo never alters the original | disposable copies | `test_original_ledger_untouched_after_tamper_demo` |
| Report status follows the decision table (D15) | `app/reporting/status.py` | `tests/unit/test_status_rules.py` (all rows) |
| Report signature enforced independently | `--verify` ACCEPT rule | `tests/unit/test_report_signing.py::test_unsigned_report_rejected_by_verifier` |
| SKIPPED never silently becomes PASS | runner gates + assertions | `tests/security/test_evidence_gates.py` |
| Stale verification never shows as current | dashboard STALE logic (D8) | `tests/security/test_stale_status.py` |
| Runtime rows honest without Docker | SC-03r/SC-04r gates (D28) | `tests/runtime/test_runtime_gate.py` (Docker-free rows) |

## Signed-field lists (definitionally)

- **Checkpoint**: `schema_version, ledger_id, checkpoint_seq, final_event_hash,
  created_at, key_id` — the `signature` field is excluded from the signing
  input and verified over those bytes.
- **Report**: everything except `report_signature.signature`. The
  `report_signature.key_id` IS signed (identifies the verifying key); so are
  `status`, `verification_steps`, `limitations`, `assertions`, and
  `scenario_results`. `ledger_path` is a provenance pointer outside the signed
  scope (it is how the verifier re-finds the ledger for its fresh check) —
  which is exactly why the verify path BINDS the signed contents to the
  freshly re-verified chain on FOUR axes (run identity, height, checkpoint
  content incl. the signed `checkpoint_final_event_hash`, and every attested
  `evidence_event_id`): a re-pointed `ledger_path` at a different ledger —
  even one of identical height and checkpoint seq — is REJECTED even though
  the signature stays valid.

## Precondition notes

- SC-02 (canary → REDACTED) requires `broker.block_on_injection: false`
  (forward mode); the runner records an honest SKIPPED with the named
  precondition otherwise.
- SC-05b/SC-07 require `ledger.sign_checkpoints: true`; without it they
  record SKIPPED "sign_checkpoints=false — no trusted anchor".
- Runtime rows require Docker AND Compose v2, probed live each run.

## The detail-key allowlist (D24) — what evidence may exist

Ledger events carry a closed `detail` key set per EventType (see
`app/schema.py: DETAIL_KEYS_BY_TYPE`), sanitized against canary markers and
serialized with keys sorted into the hashed canonical bytes. Unknown keys are
rejected at construction and flagged `UNKNOWN_FIELD` by the strict verifier.
This is the definition of what evidence may exist in the ledger.
