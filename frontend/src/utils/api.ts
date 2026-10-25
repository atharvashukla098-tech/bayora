/**
 * Bayora Backend API Client & Hybrid Execution Engine
 * Connects directly to the live Python FastAPI backend at http://127.0.0.1:8000
 * with automatic, zero-dependency fallback to the deterministic offline sandbox.
 */

export interface BackendHealth {
  online: boolean;
  service: string;
  targetMode: string;
  currentRun: string;
  blockHeight: number;
  dockerAvailable: boolean;
  runtimeContainment: string;
  latencyMs: number;
}

export interface EvaluateResult {
  runId: string;
  scenarioId: string;
  outcome: 'DETECTED' | 'BLOCKED' | 'REDACTED' | 'ALLOWED' | 'ERROR' | 'NOT_EVALUATED';
  httpStatus: number;
  policyReason: string;
  releasedText: string;
  rawTargetOutput: string;
  redactionApplied: boolean;
  events: string[];
  timing: string;
}

export interface DestinationCheckResult {
  allowed: boolean;
  httpStatus: number;
  url: string;
  policyReason: string;
  detail: string;
}

export interface TamperSimResult {
  success: boolean;
  mode: string;
  targetEventIndex: number;
  originalValid: boolean;
  tamperedValid: boolean;
  tamperRejected: boolean;
  earliestFailureSeq: number;
  findings: string[];
  expectedHash: string;
  computedHash: string;
  originalUnmodified: boolean;
  originalBlocks: any[];
  tamperedBlocks: any[];
}

const BACKEND_URL = 'http://127.0.0.1:8000';

export async function checkBackendHealth(): Promise<BackendHealth> {
  const start = performance.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1800);
    const resp = await fetch(`${BACKEND_URL}/healthz`, { signal: controller.signal });
    clearTimeout(timeout);

    if (resp.ok) {
      const data = await resp.json();
      return {
        online: true,
        service: data.service || 'bayora-secops-api',
        targetMode: data.target_mode || 'deterministic_mock',
        currentRun: data.current_run || 'demo-offline',
        blockHeight: data.block_height ?? 0,
        dockerAvailable: !!data.docker_available,
        runtimeContainment: data.runtime_containment || 'ACTIVE',
        latencyMs: Math.round(performance.now() - start),
      };
    }
  } catch {
    // Backend offline / unreachable
  }

  return {
    online: false,
    service: 'in-browser-sandbox',
    targetMode: 'deterministic_mock',
    currentRun: 'offline-fallback',
    blockHeight: 20,
    dockerAvailable: false,
    runtimeContainment: 'SKIPPED (Docker unavailable)',
    latencyMs: 0,
  };
}

export async function evaluatePrompt(
  prompt: string,
  scenarioId: string = 'SC-01',
  blockMode: boolean = false
): Promise<EvaluateResult> {
  try {
    const resp = await fetch(`${BACKEND_URL}/v1/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt, scenario_id: scenarioId, block_mode: blockMode }),
    });

    const data = await resp.json();
    return {
      runId: data.run_id || 'demo-run',
      scenarioId: data.scenario_id || scenarioId,
      outcome: data.outcome || (resp.status === 403 ? 'BLOCKED' : 'DETECTED'),
      httpStatus: resp.status,
      policyReason: data.policy_decision?.reason_code || (resp.status === 403 ? 'INJECTION_BLOCKED' : 'POLICY_EVALUATED'),
      releasedText: data.released_text || JSON.stringify(data),
      rawTargetOutput: data.raw_target_output || `Model Raw Output for [${scenarioId}]`,
      redactionApplied: !!data.redaction_applied,
      events: data.events || [],
      timing: 'PRE-EGRESS WIRE INTERCEPTION',
    };
  } catch {
    // Offline deterministic evaluation fallback (LABELED : the UI badges
    // this as SIM so it can never impersonate a live broker verdict)
    const res = runDeterministicEvaluation(prompt, scenarioId, blockMode);
    return { ...res, timing: 'SIMULATION : LIVE BROKER UNREACHABLE' };
  }
}

export async function checkDestination(url: string): Promise<DestinationCheckResult> {
  try {
    const resp = await fetch(`${BACKEND_URL}/v1/check-destination`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (resp.ok) {
      return {
        allowed: true,
        httpStatus: 200,
        url,
        policyReason: 'DESTINATION_ALLOWED',
        detail: 'URL matched approved allowlist [http://target:8000]',
      };
    } else {
      const err = await resp.json();
      return {
        allowed: false,
        httpStatus: resp.status,
        url,
        policyReason: err.error || 'DESTINATION_REJECTED',
        detail: err.detail || 'Destination URL not permitted by zero-trust policy allowlist.',
      };
    }
  } catch {
    // Offline deterministic check
    const isAllowed = url.trim().startsWith('http://target:8000');
    return {
      allowed: isAllowed,
      httpStatus: isAllowed ? 200 : 403,
      url,
      policyReason: isAllowed ? 'DESTINATION_ALLOWED' : 'DESTINATION_REJECTED',
      detail: isAllowed
        ? 'URL matched approved allowlist [http://target:8000]'
        : 'Destination rejected prior to socket build. Zero network socket penetration.',
    };
  }
}

export async function runTamperSimulation(
  mode: 'byte' | 'delete' | 'reorder' | 'truncate' | 'forge' = 'byte',
  eventIndex: number = 3
): Promise<TamperSimResult> {
  try {
    const resp = await fetch(`${BACKEND_URL}/v1/tamper`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, event_index: eventIndex }),
    });
    if (resp.ok) {
      const data = await resp.json();
      return {
        success: true,
        mode: data.mode,
        targetEventIndex: data.target_event_index,
        originalValid: data.original_valid,
        tamperedValid: data.tampered_valid,
        tamperRejected: data.tamper_rejected,
        earliestFailureSeq: data.earliest_failure_seq,
        findings: data.findings || ['BAD_HASH'],
        expectedHash: data.expected_hash,
        computedHash: data.computed_hash,
        originalUnmodified: data.original_unmodified,
        originalBlocks: data.original_blocks || [],
        tamperedBlocks: data.tampered_blocks || [],
      };
    }
  } catch {
    // Offline fallback simulation
  }

  // Deterministic in-browser fallback
  return {
    success: true,
    mode,
    targetEventIndex: eventIndex,
    originalValid: true,
    tamperedValid: false,
    tamperRejected: true,
    earliestFailureSeq: eventIndex,
    findings: [
      mode === 'byte'
        ? 'BAD_HASH'
        : mode === 'delete'
        ? 'BAD_SEQ'
        : mode === 'reorder'
        ? 'BAD_LINK'
        : mode === 'truncate'
        ? 'CHECKPOINT_PREFIX_MISMATCH'
        : 'CHECKPOINT_SIG_INVALID',
    ],
    expectedHash: '8f4d92a17cb6e3401fa95c02b3112009a12f9e408c6b901a55dbca183991ad81',
    computedHash: '7ce71b993e10fa48b812009ad1829f01828ac910e5a3e9841eee412c99ad59b1',
    originalUnmodified: true,
    originalBlocks: [],
    tamperedBlocks: [],
  };
}

export interface GateTestResult {
  gate: string;
  status: number;
  code: string;
  detail: string;
  simulated?: boolean;
  attempts?: number;
  accepted?: number;
  rejected_429?: number;
  sequence?: number[];
  payload_bytes?: number;
  limit_bytes?: number;
  wrong_type_status?: number;
  unknown_field_status?: number;
  evil_status?: number;
  allowed_status?: number;
  [key: string]: unknown;
}

export async function runGateTest(gate: 'rate' | 'size' | 'schema' | 'concurrency' | 'destination'): Promise<GateTestResult> {
  try {
    const resp = await fetch(`${BACKEND_URL}/v1/gate-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gate }),
    });
    if (resp.ok) return await resp.json();
  } catch {
    // fall through to labeled simulation
  }
  // SIMULATION (labeled): mirrors the real gate codes when the backend is down
  const codes: Record<string, GateTestResult> = {
    rate: { gate: 'rate', status: 429, code: 'RATE_LIMITED', simulated: true, detail: 'SIMULATION : backend offline. Real gate returns 429 once the token bucket (burst cap) is exhausted.' },
    size: { gate: 'size', status: 413, code: 'REQUEST_TOO_LARGE', simulated: true, detail: 'SIMULATION : backend offline. Real gate returns 413 before JSON parsing when Content-Length exceeds the cap.' },
    schema: { gate: 'schema', status: 422, code: 'SCHEMA_INVALID', simulated: true, detail: 'SIMULATION : backend offline. Real Pydantic extra=forbid gate returns 422 on wrong types or smuggled fields.' },
    concurrency: { gate: 'concurrency', status: 429, code: 'TOO_BUSY', simulated: true, detail: 'SIMULATION : backend offline. Real gate returns 429 TOO_BUSY when the semaphore is saturated.' },
    destination: { gate: 'destination', status: 403, code: 'DESTINATION_REJECTED', simulated: true, detail: 'SIMULATION : backend offline. Real policy-only route returns 403 for non-allowlisted URLs; no socket is built.' },
  };
  return codes[gate];
}

export interface LedgerEvent {
  seq: number;
  event_type: string;
  component: string;
  outcome: string | null;
  scenario_id: string | null;
  hash: string;
  prev_hash: string;
  ts: string;
  detail: Record<string, string> | null;
  [key: string]: unknown;
}

export async function fetchLedger(limit: number = 50): Promise<{ events: LedgerEvent[]; simulated: boolean }> {
  try {
    const resp = await fetch(`${BACKEND_URL}/v1/ledger`);
    if (resp.ok) {
      const events: LedgerEvent[] = await resp.json();
      return { events: events.slice(-limit), simulated: false };
    }
  } catch {
    // fall through
  }
  return { events: [], simulated: true };
}

export interface VerifyResult {
  valid: boolean;
  checked_height?: number;
  findings?: string[];
  earliest_failure_seq?: number | null;
  simulated?: boolean;
  detail?: string;
  [key: string]: unknown;
}

export async function verifyLedger(): Promise<VerifyResult> {
  try {
    const resp = await fetch(`${BACKEND_URL}/v1/verify`);
    if (resp.ok) return await resp.json();
  } catch {
    // fall through
  }
  return { valid: false, simulated: true, detail: 'SIMULATION : backend offline; the real verifier could not run.' };
}

export interface RunSceneResult {
  scene: string;
  returncode: number;
  stdout: string;
  stderr: string;
  run_id: string;
  status: 'PASS' | 'FAIL';
  simulated?: boolean;
  detail?: string;
}

export async function runScene(scene: string): Promise<RunSceneResult> {
  try {
    const resp = await fetch(`${BACKEND_URL}/v1/run-scene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene }),
    });
    if (resp.ok) return await resp.json();
  } catch {
    // fall through
  }
  return {
    scene,
    returncode: -1,
    stdout: '',
    stderr: '',
    run_id: '',
    status: 'FAIL',
    simulated: true,
    detail: 'SIMULATION : live pipeline unreachable; connect the backend to run the real scene.',
  };
}

export interface SignedReportData {
  available: boolean;
  run_id?: string;
  report_status?: string;
  assertions?: { total?: number; passed?: number; failed?: number; errors?: number; skipped?: number; not_evaluated?: number };
  signature?: { algorithm?: string; key_id?: string; signature?: string } | null;
  chain_valid?: boolean | null;
  checked_height?: number | null;
  report_path?: string;
  simulated?: boolean;
}

export async function fetchSignedReport(): Promise<SignedReportData> {
  try {
    const resp = await fetch(`${BACKEND_URL}/v1/report`);
    if (resp.ok) return await resp.json();
  } catch {
    // fall through
  }
  return { available: false, simulated: true };
}

function runDeterministicEvaluation(
  prompt: string,
  scenarioId: string,
  blockMode: boolean
): EvaluateResult {
  const lower = prompt.toLowerCase();
  const hasCanary = lower.includes('canary') || lower.includes('secret') || lower.includes('bayora-canary');
  const hasInjection =
    lower.includes('ignore') ||
    lower.includes('disregard') ||
    lower.includes('system prompt') ||
    lower.includes('developer mode') ||
    lower.includes('dan mode');
  const hasFsWrite = lower.includes('/etc/') || lower.includes('/root/') || lower.includes('write attempted');

  if (blockMode && hasInjection) {
    return {
      runId: 'demo-sandbox',
      scenarioId,
      outcome: 'BLOCKED',
      httpStatus: 403,
      policyReason: 'INJECTION_BLOCKED',
      releasedText: '{"error": "INJECTION_BLOCKED", "outcome": "BLOCKED", "detail": "Pre-target hard block enforced."}',
      rawTargetOutput: '[TARGET CALL SUPPRESSED: Never Invoked]',
      redactionApplied: false,
      events: ['ev_pre_target_block_01'],
      timing: 'PRE-TARGET ENFORCEMENT',
    };
  }

  if (hasCanary) {
    return {
      runId: 'demo-sandbox',
      scenarioId,
      outcome: 'REDACTED',
      httpStatus: 200,
      policyReason: 'CANARY_REDACTED',
      releasedText: prompt.replace(/bayora-canary-[a-f0-9-]+/gi, '[REDACTED-BAYORA]') || 'Response: Secret token is [REDACTED-BAYORA].',
      rawTargetOutput: 'Model Output: Secret token is BAYORA-CANARY-481d7f-bd60e0.',
      redactionApplied: true,
      events: ['ev_ingress_01', 'ev_target_resp_02', 'ev_redacted_03'],
      timing: 'PRE-RELEASE WIRE SCRUB',
    };
  }

  if (hasInjection) {
    return {
      runId: 'demo-sandbox',
      scenarioId,
      outcome: 'DETECTED',
      httpStatus: 200,
      policyReason: 'INJECTION_DETECTED',
      releasedText: 'QUARANTINED: Prompt injection heuristics inj-2 matched. Execution monitored and quarantined.',
      rawTargetOutput: 'Model Output: Instructions acknowledged under surveillance.',
      redactionApplied: false,
      events: ['ev_ingress_01', 'ev_policy_dec_02', 'ev_released_03'],
      timing: 'INGRESS HEURISTIC ENFORCEMENT',
    };
  }

  if (hasFsWrite) {
    return {
      runId: 'demo-sandbox',
      scenarioId,
      outcome: 'DETECTED',
      httpStatus: 200,
      policyReason: 'FS_WRITE_DETECTED',
      releasedText: 'QUARANTINED: Protected filesystem write marker matched. Operation trapped.',
      rawTargetOutput: 'OS Output: open(/etc/passwd) -> trapped',
      redactionApplied: false,
      events: ['ev_ingress_01', 'ev_policy_dec_02'],
      timing: 'GUARDRAIL CONTAINMENT',
    };
  }

  return {
    runId: 'demo-sandbox',
    scenarioId,
    outcome: 'ALLOWED',
    httpStatus: 200,
    policyReason: 'BENIGN_PASS',
    releasedText: `Model Response: Safely evaluated benign request: "${prompt.slice(0, 80)}"`,
    rawTargetOutput: `Model Output: Safely evaluated benign request: "${prompt.slice(0, 80)}"`,
    redactionApplied: false,
    events: ['ev_ingress_01', 'ev_released_02'],
    timing: 'STANDARD INGRESS PIPELINE',
  };
}
