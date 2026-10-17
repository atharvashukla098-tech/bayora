# BAYORA — MASTER PROJECT SPECIFICATION V2

## Zero-Trust AI Red-Teaming, Runtime Containment & Verifiable Security Evidence

**Project:** Bayora
**Version:** 2.0 — Consolidated Planning Specification
**Project stage:** Planning and specification; implementation has not yet been verified
**Primary objective:** Design a compelling, technically credible, offline-first AI security evaluation sandbox suitable for a hackathon demonstration.

---

# 1. PRODUCT VISION

Bayora is a zero-trust AI red-teaming sandbox designed to safely evaluate how an AI target behaves under adversarial inputs, enforce security policies at controlled boundaries, and produce independently verifiable evidence of what happened.

Bayora must connect five capabilities into one coherent system:

1. **Attack simulation:** Generate controlled adversarial test cases.
2. **Policy enforcement:** Inspect requests and responses at defined trust boundaries.
3. **Runtime containment:** Restrict the target's permitted network and filesystem behavior.
4. **Incident visibility:** Show real execution events, policy decisions, and containment outcomes.
5. **Evidence verification:** Produce a hash-chained audit ledger, signed checkpoints, test results, and a machine-readable evaluation report.

### Core value proposition

**Bayora does not merely report that an AI security test passed. It connects the attack attempt, enforcement decision, observed outcome, and verifiable audit evidence into one traceable evaluation.**

The platform must distinguish between a detected threat, a blocked request, a redacted response, a denied network connection, and a cryptographically verified record. These are different claims and must never be treated as interchangeable.

# 2. DESIGN PRINCIPLES

All architecture and implementation decisions must follow these principles.

* **Zero trust:** Treat requests, target outputs, and external destinations as untrusted until explicitly validated and authorized.
* **Offline-first:** The core system must operate without internet access or automatic model downloads.
* **Mock-first:** A deterministic mock target is the default. A real local model is an optional extension.
* **Defense in depth:** Application validation, broker policy, runtime isolation, and audit verification provide separate security layers.
* **Evidence over appearance:** Security claims must be backed by executable tests and observable evidence.
* **Fail closed:** When a required policy check or verification operation cannot be completed, the system must not silently treat it as successful.
* **Reproducibility:** A clean environment must be able to run the same documented demo and produce interpretable results.
* **Minimal complexity:** Every feature must justify its implementation cost and attack surface.
* **Truthful reporting:** Failed, skipped, unsupported, and unexecuted tests must be represented honestly.
* **Demo reliability:** The core demonstration must not depend on an internet connection, external APIs, or unpredictable model output.

# 3. SYSTEM ARCHITECTURE

The system must use clearly separated components with explicit responsibilities.

## 3.1 Red Harness — Adversarial Evaluation Engine

Responsibilities:

* Generate predefined, controlled adversarial scenarios.
* Assign each evaluation a unique `run_id`.
* Include scenario identifiers, expected outcomes, and relevant policy expectations.
* Send test requests only through the approved broker interface.
* Capture observed results without independently declaring containment successful.
* Support repeatable test runs and regression testing.

The initial scenario library should cover:

* Direct prompt injection.
* Attempts to disclose a synthetic canary secret.
* Malformed or oversized requests.
* Unauthorized destination access.
* Filesystem write attempts against protected paths.
* Audit ledger alteration, deletion, truncation, and reordering.
* Policy bypass attempts within the supported threat model.

Scenarios must be designed for an isolated test environment and must not target third-party systems.

## 3.2 FastAPI Policy Broker — Enforcement Boundary

The broker is the central application-level trust boundary between the Red Harness, target, and permitted response destinations.

Responsibilities:

* Validate requests using typed Pydantic models.
* Apply request size, rate, timeout, and concurrency limits.
* Authenticate callers where required by the deployment configuration.
* Apply explicit policy rules to requests and target responses.
* Detect and redact synthetic canary values before releasing responses.
* Record structured policy decisions and outcomes.
* Forward requests only to configured destinations.
* Reject unsupported destinations and malformed requests.
* Apply safe error handling without leaking secrets or internal configuration.

Security requirements:

* Do not implement a generic unrestricted reverse proxy.
* Do not allow user-supplied URLs to become arbitrary outbound destinations.
* Do not treat schema validation as a complete prompt-injection defense.
* Do not rely on a classifier alone to enforce critical security policies.
* Do not log raw secrets unnecessarily.
* Ensure that policy enforcement happens before a response is released.
* Apply timeouts and bounded resource usage to every target call.

Prompt-injection detection, schema validation, destination restrictions, and secret redaction must be represented as separate controls with clearly documented limitations.

## 3.3 Target — Deterministic Mock AI

The initial target must be a deterministic, offline mock service that simulates relevant AI behaviors without requiring a downloaded model.

It must support predefined response behaviors, including:

* Benign response.
* Adversarial instruction-following simulation.
* Synthetic canary disclosure attempt.
* Malformed output.
* Simulated timeout or target failure.

The mock must have a documented scenario mapping so test outcomes are repeatable and explainable.

**Important:** A mock simulation demonstrates that Bayora's controls behave as expected against the defined test scenarios. It does not prove that every real-world AI model will behave identically.

A real local model may be supported later through an explicit adapter. It must only be used when the model is already installed and the user explicitly enables it. Bayora must never download models automatically.

The dashboard and audit evidence must clearly identify whether an evaluation used the mock target or a real model.

## 3.4 Blue Guardrail — Policy and Output Protection

The Blue Guardrail implements deterministic enforcement rules wherever practical.

Initial controls:

* Request validation.
* Configurable adversarial-input rules.
* Canary pattern detection.
* Response redaction.
* Output size limits.
* Timeout and error handling.
* Explicit policy-denial outcomes.

Canary values must be synthetic, unique per run where practical, and generated without using real credentials or sensitive information.

A canary disclosure attempt is considered successfully contained only when the test establishes that the protected value did not escape through the response channel being tested. The test must inspect the actual released response rather than relying solely on a log message.

The system must distinguish:

* `DETECTED`
* `BLOCKED`
* `REDACTED`
* `ALLOWED`
* `ERROR`
* `NOT_EVALUATED`

These states must have consistent meanings throughout the API, dashboard, tests, and exported report.

## 3.5 Audit Ledger and Verifier

The ledger records security-relevant events in an ordered, hash-linked structure.

Each event should contain the minimum necessary fields:

* Schema version.
* Event identifier and sequence number.
* UTC event timestamp.
* Evaluation `run_id`, where applicable.
* Event type and component.
* Policy decision or outcome.
* Relevant scenario identifier.
* Previous event hash.
* Current event hash.

Sensitive payloads and raw canary values must not be written into the ledger by default. Store sanitized metadata and cryptographic digests where appropriate.

The hash calculation must use a documented canonical serialization format. Hash inputs must exclude the current event's own hash field and must include the required immutable event fields and previous hash.

Use SHA-256 for event integrity.

The independent verifier must detect:

* Modified event content.
* Invalid event hashes.
* Broken previous-hash links.
* Unexpected sequence numbers.
* Reordered events.
* Missing events where detectable from trusted checkpoints.
* Truncation relative to a previously trusted checkpoint.

A hash chain alone cannot prove that an attacker did not rewrite the entire ledger. Therefore, Bayora must support signed checkpoints and explain their trust assumptions.

## 3.6 Signed Checkpoints

Use Ed25519 signatures for checkpoint verification.

A checkpoint should bind the signature to a canonical representation of at least:

* Ledger identity.
* Ledger schema version.
* Checkpoint sequence or block height.
* Final event hash.
* Checkpoint creation time.
* Signing key identifier.

The verifier must validate both the ledger structure and the checkpoint signature against a trusted public key.

The private signing key must be protected and must not be embedded in the exported report or committed to source control. For the hackathon prototype, a local development key may be used, provided its limitations are documented.

A signature proves that the checkpoint matches the key used to sign it. It does not independently prove the truth of every event or establish legal non-repudiation.

# 4. CONTAINMENT AND RUNTIME HARDENING

The application-level broker and operating-system/container controls must be treated as different security layers.

## 4.1 Network controls

Where Docker is available, the target should run in a restricted network configuration with only explicitly required communication paths.

Requirements:

* No unrestricted outbound network access from the target.
* No unnecessary published ports.
* No privileged containers.
* No host network mode unless a documented requirement justifies it.
* Explicitly defined broker-to-target communication.
* Demonstrable denial of unauthorized destinations.
* Clear documentation of the environment's networking assumptions.

A connection timeout alone is not sufficient evidence of a firewall denial. Tests should distinguish policy rejection, connection refusal, DNS failure, timeout, and other observed errors.

Use controlled test endpoints or isolated test containers. Never scan unrelated hosts.

## 4.2 Filesystem and privilege controls

Where compatible with the application:

* Enable a read-only root filesystem for the target.
* Use dedicated writable temporary locations only when necessary.
* Drop unnecessary Linux capabilities.
* Run processes as a non-root user.
* Apply CPU, memory, and process limits.
* Avoid mounting sensitive host paths.
* Avoid exposing the Docker socket to the target.
* Document security controls that depend on the host operating system.

A read-only filesystem test should attempt a write to a known protected path and verify the actual result. An `EROFS` error is expected for an applicable read-only filesystem operation, but the test must not assume every failed write has that cause.

## 4.3 Honest containment reporting

The dashboard must not claim that Docker isolation, filesystem restrictions, or network controls are active merely because configuration files contain the relevant settings.

A control is verified only when an appropriate test or inspection establishes the expected behavior in the running environment.

If Docker is unavailable, the core offline mock and application tests may still run, but Docker-specific assertions must be marked `SKIPPED` or `UNAVAILABLE`, never `PASS`.

# 5. LIVE THREAT INTERCEPTION EVENT STREAM

Add a compact terminal-style activity stream at the top of the Streamlit dashboard.

The stream must consume real structured events from the current execution pipeline. It must not fabricate events or show stale success states as if they were live.

Example presentation:

```text
[14:02:11] [INGRESS]        Adversarial request received
                            run_id=8f9b2c

[14:02:12] [TARGET]         Canary disclosure attempt observed
                            canary_id=canary-8f9b2c

[14:02:12] [BROKER-POLICY]  Canary pattern detected
                            action=REDACT

[14:02:13] [AUDIT-LEDGER]   Event committed
                            block=12 hash=4c3e...

[14:02:13] [VERIFIER]       Integrity check completed
                            result=VALID
```

These lines are illustrative display examples, not evidence of completed execution.

Requirements:

* Generate timestamps from actual events and display them in the configured local timezone or UTC with the timezone clearly identified.
* Show the associated `run_id` and event status.
* Use polling or a controlled refresh interval that does not overwhelm the backend.
* Display event age and connection status where relevant.
* Distinguish an idle system from a disconnected event source.
* Do not invent events to make the demo appear active.
* Redact secrets in the UI and logs.
* Provide a clear way to inspect the event details associated with an incident.
* Avoid unbounded event history or memory growth.

The dashboard must clearly distinguish an event being observed from an event being cryptographically verified.

# 6. INTERACTIVE TAMPER SIMULATOR

Create `scripts/tamper_demo.py` and expose a clearly labeled **Corrupt a Disposable Ledger Copy** action.

The demonstration must never corrupt the original evidence ledger.

Expected sequence:

1. Copy a known-good ledger to a temporary or disposable location.
2. Record its original verification result.
3. Alter one byte in a selected event in the copy.
4. Run the independent verifier against the modified copy.
5. Display the expected and computed hash values.
6. Identify the earliest detected integrity failure.
7. Show the verifier's non-zero failure result.
8. Preserve the original ledger and its verification result.

Example output:

```text
BAYORA LEDGER TAMPER DEMONSTRATION

Original ledger:        VALID
Disposable copy:        CREATED
Modified event:         #3

Expected hash:          a94f82c...
Computed hash:          0b12e9a...

[TAMPER REJECTED]
Ledger integrity verification failed at event #3.
The modified ledger does not match the expected hash chain.

Original ledger:        UNMODIFIED
```

The output must be generated from actual verification results. Hash values must not be hardcoded.

The test suite must also cover deleted events, reordered events, truncation, and invalid checkpoint signatures. Explain that truncation detection depends on comparison with a previously trusted checkpoint or other trusted expected ledger state.

# 7. ATTACKER-VERSUS-TARGET EVALUATION MATRIX

Add a compact evaluation matrix to the Streamlit dashboard.

Required columns:

| Field                          | Purpose                                           |
| ------------------------------ | ------------------------------------------------- |
| Attack vector                  | What the scenario attempted                       |
| Scenario ID                    | Reproducible test identifier                      |
| Isolation or enforcement layer | The actual control under test                     |
| Detection mechanism            | The mechanism that observed the condition         |
| Action taken                   | Actual observed response                          |
| Evidence                       | Event IDs, test result, or verification reference |
| Result                         | PASS, FAIL, ERROR, SKIPPED, or NOT EVALUATED      |

Initial scenario catalogue:

| Attack vector                   | Intended control                                 | Evidence required                                                       |
| ------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| Direct prompt injection         | Configured input policy and/or target evaluation | Actual request, policy decision, and observed target behavior           |
| Canary disclosure               | Broker response inspection and redaction         | Canary absent from released response; expected redaction event recorded |
| Unauthorized network connection | Runtime network restrictions                     | Controlled connection attempt and verified denial outcome               |
| Protected filesystem write      | Read-only filesystem or filesystem permissions   | Actual write attempt and observed protected-path behavior               |
| Ledger event modification       | Independent hash-chain verifier                  | Verification fails at the altered event                                 |
| Ledger truncation               | Trusted signed checkpoint                        | Comparison with checkpoint detects missing tail                         |
| Invalid checkpoint signature    | Ed25519 verification                             | Signature validation fails                                              |
| Malformed request               | Typed schema validation                          | Invalid request rejected according to documented policy                 |

A scenario must not be marked `PASS` simply because the expected defensive component exists. The relevant assertion must execute and succeed.

For each row, provide access to the scenario details and supporting evidence.

The dashboard must show the denominator for every summary metric. For example, `7/8 applicable assertions passed` is more meaningful than a standalone percentage.

# 8. MACHINE-READABLE SIGNED ATTESTATION

At the end of `./demo.sh`, generate `audit_report.json`.

The report must be generated from the actual evaluation run and independent verification results.

Recommended structure:

```json
{
  "schema_version": "1.0",
  "platform": "Bayora",
  "platform_version": "1.0.0",
  "run_id": "generated-run-id",
  "verification_timestamp": "generated-UTC-timestamp",
  "target_mode": "deterministic_mock",
  "environment": {
    "offline_mode": true,
    "docker_available": false
  },
  "assertions": {
    "total": 12,
    "passed": 0,
    "failed": 0,
    "errors": 0,
    "skipped": 0
  },
  "ledger": {
    "block_height": 0,
    "chain_valid": false,
    "checkpoint_present": false,
    "checkpoint_signature_valid": false
  },
  "report_signature": {
    "algorithm": "Ed25519",
    "key_id": "local-demo-key",
    "signature": null
  },
  "status": "NOT_VERIFIED"
}
```

This is a schema example. It is not a report of a completed run. The implementation must calculate the values rather than copying these placeholders.

Requirements:

* Use a defined JSON schema and validate the report before export.
* Record real UTC timestamps.
* Include actual assertion counts, scenario results, target mode, and relevant environment limitations.
* Generate the signature over a canonical representation of the report, excluding the signature field itself.
* Publish or retain the corresponding trusted public key separately from the signed report.
* Define precisely which report fields are signed.
* Ensure the exported report does not contain canary secrets or unnecessary sensitive data.
* Include a verifier that can validate the report signature independently.

Use explicit report statuses such as:

* `VERIFIED`
* `VERIFIED_WITH_LIMITATIONS`
* `FAILED`
* `NOT_VERIFIED`

Define the status rules before implementation. For example, a report cannot be fully verified if its ledger signature is invalid, a required assertion failed, or a required verification step did not execute.

Optional controls that are unavailable in the environment must be reported as limitations or skipped assertions, not silently counted as passing.

A signed report establishes integrity and key-based origin for the signed content. It does not prove that every security property of the system has been tested, that the report's underlying assertions are true, or that Bayora is certified against SOC 2.

# 9. STREAMLIT INCIDENT-RESPONSE DASHBOARD

The dashboard should prioritize incident response and evidence, not decorative analytics.

Recommended layout:

## Top section: System state

Show:

* Broker availability.
* Current target mode.
* Current evaluation run.
* Latest ledger verification status.
* Runtime containment test status.
* Last event timestamp.

Statuses must be derived from actual runtime checks, not hardcoded values.

## Second section: Live interception stream

Show the latest structured events with severity, timestamp, component, run ID, and outcome.

## Third section: Active and recent incidents

Show:

* Attack scenario.
* Detection time.
* Policy action.
* Containment evidence.
* Verification status.
* Associated run and event identifiers.

## Fourth section: Evaluation matrix

Show all applicable attack scenarios, their observed outcomes, and links to supporting evidence.

## Fifth section: Ledger integrity

Show:

* Current block height.
* Latest event hash.
* Chain verification result.
* Checkpoint signature status.
* Most recent verification time.
* Tamper demonstration action.

## Sixth section: Reports and history

Allow the user to inspect completed runs and export their evaluation reports.

The dashboard must distinguish current status from historical results. A previously verified ledger must not continue to display `VERIFIED` after the ledger changes unless a fresh verification succeeds.

# 10. TERMINAL EXPERIENCE AND DEMO BANNER

The `demo.sh` entry point should begin with a concise ANSI-colored Bayora banner.

Suggested semantic colors:

* Green: `[CONTAINED]`
* Yellow: `[INTERCEPTED & REDACTED]`
* Cyan: `[VERIFIED]`
* Bold red: `[TAMPER REJECTED]`
* Neutral: `[RUNNING]`, `[SKIPPED]`, `[UNAVAILABLE]`

Requirements:

* Use color to communicate real status, not decorate false success.
* Support terminals without ANSI color support.
* Provide readable output when redirected to a file.
* Return a non-zero exit code when required assertions or verification steps fail.
* Never swallow exceptions that affect security conclusions.
* Print a final concise summary of passed, failed, errored, and skipped assertions.

# 11. API, CONFIGURATION, AND ERROR HANDLING

All security-sensitive configuration must be explicit and validated.

Requirements:

* Use typed request and response models.
* Validate configuration at startup.
* Use explicit allowlists for outbound destinations.
* Apply sensible limits to request size, concurrency, and execution time.
* Avoid secrets in source control, logs, error messages, and exported reports.
* Provide consistent machine-readable error responses.
* Ensure errors cannot accidentally bypass response redaction or policy checks.
* Use structured logging with stable event identifiers.
* Avoid exposing stack traces or sensitive internal details to untrusted clients.
* Document the default ports and network paths.
* Provide a configuration example containing safe, non-secret defaults.

Do not add authentication complexity that cannot be implemented and tested correctly. However, if a component is exposed beyond a trusted local environment, its access-control requirements must be explicitly defined.

# 12. TESTING AND EVIDENCE STRATEGY

Bayora must use automated tests as the primary source of evidence.

## Unit tests

Test:

* Request validation.
* Canary detection and redaction.
* Policy decisions.
* Event canonicalization.
* Hash calculation.
* Hash-chain validation.
* Checkpoint signing and verification.
* Report signing and verification.
* Status calculation.
* Failure and exception handling.

## Integration tests

Test:

* Red Harness to broker request flow.
* Broker to mock target communication.
* Response enforcement before release.
* Structured event creation.
* Ledger persistence and verification.
* Report generation from a real test run.
* Dashboard reading actual event and status data.

## Security regression tests

Test:

* Canary values never escape through the tested response channel after successful redaction.
* Invalid destinations are rejected.
* Oversized and malformed requests are handled safely.
* Tampered ledger content fails verification.
* Invalid signatures fail verification.
* Missing required evidence cannot yield a full verification status.
* Failed or skipped assertions cannot be silently counted as passed.
* Stale dashboard data cannot masquerade as a current verification result.

## Runtime tests

When the environment supports Docker, test the actual network and filesystem restrictions.

Do not infer runtime containment from static configuration alone.

Every test must have a clear assertion, an understandable failure message, and a reproducible execution path.

# 13. THREAT MODEL AND LIMITATIONS

Document the assets, adversaries, trust boundaries, and assumptions.

Assets include:

* Synthetic canary values.
* Evaluation inputs and outputs.
* Audit records.
* Signing keys.
* Policy configuration.
* Runtime integrity.
* Evaluation reports.

Potential threats include:

* Malicious adversarial prompts.
* Attempts to disclose protected canary values.
* Unauthorized outbound connections.
* Malformed inputs and resource exhaustion.
* Tampering with logs or exported reports.
* Attempts to bypass configured policies.
* Misleading or stale security status.
* Compromised local signing keys.
* Misconfiguration of the host or container runtime.

Explicitly document what the initial version does not guarantee:

* Universal prevention of prompt injection.
* Protection against every possible model behavior.
* Security of a compromised host.
* Protection against a signing key that has been stolen.
* Complete proof of historical events without a trusted checkpoint.
* Compliance certification.
* General-purpose penetration testing of arbitrary AI systems.

A credible threat model increases trust. Do not hide limitations to make the project appear stronger.

# 14. REPRODUCIBILITY AND PROJECT STRUCTURE

The project should be organized into understandable, independently testable modules.

Suggested layout:

```text
bayora/
├── app/
│   ├── broker/
│   ├── target/
│   ├── guardrails/
│   ├── harness/
│   ├── ledger/
│   ├── reporting/
│   └── dashboard/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── security/
│   └── runtime/
├── scripts/
│   ├── verify_ledger.py
│   ├── tamper_demo.py
│   └── generate_report.py
├── config/
│   └── config.example.yaml
├── docs/
│   ├── architecture.md
│   ├── threat_model.md
│   ├── security_claims.md
│   └── demo_runbook.md
├── demo.sh
├── pyproject.toml
├── Dockerfile
├── compose.yaml
├── .gitignore
└── README.md
```

This is the proposed layout, not a claim that these files already exist. Adjust it if implementation evidence shows a simpler structure is more reliable.

Requirements:

* Pin and document dependencies.
* Provide a documented clean setup path.
* Avoid runtime downloads.
* Keep generated reports and signing keys out of source control where appropriate.
* Provide safe sample configuration.
* Include clear commands for testing, running, verifying, and cleaning up.
* Make the default demo work offline once dependencies are available.

# 15. DEMONSTRATION STORY

The judge-facing demo should show a complete security lifecycle in a short, repeatable sequence.

## Scene 1: Establish a known-good baseline

Start Bayora offline using the deterministic mock. Run a benign request and show the actual successful execution and audit evidence.

## Scene 2: Trigger an adversarial scenario

Submit a controlled prompt-injection or canary-disclosure scenario. Show the request entering the broker, the target behavior, the policy decision, and the actual response released to the caller.

## Scene 3: Prove containment

Demonstrate that the canary is absent from the released response. Show the associated policy event and test assertion.

## Scene 4: Demonstrate runtime restrictions

Attempt a connection to a controlled, unauthorized destination or a write to a protected filesystem path. Show the actual outcome and identify which runtime control was tested.

If the runtime environment does not support a test, state that clearly rather than presenting a simulation as a real containment result.

## Scene 5: Challenge the audit ledger

Use the tamper simulator on a disposable copy. Show the expected and computed hashes and the independent verifier's failure result. Confirm the original ledger remains intact.

## Scene 6: Verify the report

Generate the signed JSON report and validate its signature and ledger references. Show the final status and any limitations.

The complete demo must be scripted, repeatable, and recoverable after an interrupted run. The presentation should show genuine system behavior, not a prerecorded sequence presented as live execution.

# 16. ACCEPTANCE CRITERIA

Bayora's initial release is considered demo-ready only when the applicable criteria below have been verified.

### Core execution

* [ ] The deterministic mock runs offline.
* [ ] A benign request completes successfully.
* [ ] Each evaluation receives a unique run ID.
* [ ] Structured events link the major steps of a run.
* [ ] Errors and timeouts are handled predictably.

### Policy enforcement

* [ ] Malformed requests are rejected according to documented rules.
* [ ] Canary disclosure attempts are detected in the intended test cases.
* [ ] Redaction is verified against the actual released response.
* [ ] Unauthorized destinations are rejected by the appropriate configured layer.

### Audit integrity

* [ ] A known-good ledger passes independent verification.
* [ ] Event modification is detected.
* [ ] Reordering is detected.
* [ ] Truncation is detected when compared with a trusted checkpoint.
* [ ] Invalid checkpoint signatures are rejected.
* [ ] The tamper simulator never alters the original ledger.

### Runtime containment

* [ ] Supported Docker network restrictions are tested in a running environment.
* [ ] Supported filesystem restrictions are tested with an actual operation.
* [ ] Unsupported runtime checks are explicitly marked unavailable or skipped.

### Dashboard and reporting

* [ ] The live stream displays actual events.
* [ ] The dashboard distinguishes current status from historical results.
* [ ] The evaluation matrix links results to supporting evidence.
* [ ] The report is generated from actual assertions.
* [ ] The report signature verifies independently.
* [ ] Failure, error, and skipped counts are accurate.

### Demonstration

* [ ] `demo.sh` starts from the documented environment.
* [ ] The complete core demo runs without internet access.
* [ ] No successful status is hardcoded.
* [ ] A clean run and a tamper-failure run are both demonstrated.
* [ ] The final report and supporting evidence can be inspected.
* [ ] The demo can be reset and repeated.

Only mark a criterion complete after its corresponding test or inspection has actually succeeded.

# 17. IMPLEMENTATION PRIORITIES

Prioritize reliability and evidence over feature count.

**Priority 1 — Runnable core**

* Deterministic mock target.
* Typed FastAPI broker.
* Minimal policy enforcement.
* Structured event schema.
* Basic hash-chained ledger.

**Priority 2 — Independent verification**

* Ledger verifier.
* Automated unit and integration tests.
* Checkpoint signing and validation.
* Safe tamper demonstration.

**Priority 3 — Containment**

* Canary redaction.
* Explicit destination restrictions.
* Docker hardening.
* Runtime containment tests where supported.

**Priority 4 — Evidence and interface**

* Streamlit incident-response dashboard.
* Live event stream.
* Attacker-versus-target matrix.
* Machine-readable signed report.

**Priority 5 — Demo readiness**

* `demo.sh`.
* ANSI terminal banner.
* Clean reset procedure.
* End-to-end acceptance tests.
* Judge-focused demonstration runbook.

**Priority 6 — Optional extensions**

* Local model adapter.
* Additional attack scenarios.
* Additional policy rules.
* More detailed analytics.

Do not begin optional extensions until the core demonstration passes its acceptance criteria.

# 18. HACKATHON EXECUTION STRATEGY — NON-NEGOTIABLE PRIORITIES

1. **Deterministic mock backend first.** The entire core must work offline. Never automatically download an LLM. Ollama or another local model is optional and may only be used when the model is already available and the user explicitly enables it. Clearly identify mock execution versus real inference.

2. **Keep the FastAPI Policy Broker lean.** Use typed Pydantic validation, explicit configured destinations, appropriate authentication for the deployment, bounded resource use, canary handling, output enforcement, and structured audit events. Do not build a generic reverse proxy.

3. **Make the dashboard incident-response-first.** Prominently show current containment status, incidents, canary protection, ledger integrity, and evaluation history. Never display a fake or stale `VERIFIED` status.

4. **Follow the implementation order.** Runnable core → tests and evidence → containment → dashboard → reproducibility → optional LLM and extra features.

5. **Enforce the demo-readiness gate.** Before declaring the demo ready, demonstrate an offline start, a clean run, canary redaction, a supported network-denial test, a tamper test on a disposable copy, the dashboard, and an exported report whose evidence can be independently verified. Mark unavailable environment-dependent tests explicitly.

6. **Keep results honest.** Never invent test results, hash values, block heights, timestamps, attack success rates, or verification outcomes. Never claim a control is active without appropriate evidence. Never describe Bayora as SOC 2 certified or universally secure.

7. **Optimize for a working end-to-end demonstration.** If a feature threatens the reliability of the core, defer it rather than compromising the evidence pipeline.

# 19. DEFINITION OF SUCCESS

Bayora succeeds as a hackathon prototype when it can demonstrate the following coherent sequence:

**Adversarial test → policy enforcement → observable containment outcome → structured audit event → independent integrity verification → signed evaluation report.**

The final project must make it easy for a judge to answer:

* What attack was attempted?
* Which control was responsible for handling it?
* What actually happened?
* What evidence supports the result?
* Can the evidence be independently checked?
* What limitations remain?

The project must demonstrate technical depth without overclaiming its guarantees.

The objective is not to maximize the number of features. It is to deliver a focused, defensible, reproducible security evaluation system whose claims match the evidence it produces.

**Final engineering principle: If Bayora cannot demonstrate a security claim, it must report that limitation instead of claiming success.**