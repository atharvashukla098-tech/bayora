/* Bayora site — data layer.
 *
 * Fetches the read-only evidence bundle (live endpoint first, static
 * snapshot as fallback) and binds values into the page. Nothing here
 * invents a value: a missing artifact stays visibly missing.
 */

const ENDPOINTS = [
  "/api/site/run.json",
  "./data/run-snapshot.json",
];

export const state = {
  bundle: null,
  source: null,
};

async function fetchFirst(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const json = await res.json();
      if (json && json.run) return { json, url };
    } catch (_) {
      /* try the next source */
    }
  }
  return null;
}

export async function loadBundle() {
  const found = await fetchFirst(ENDPOINTS);
  if (!found) return null;
  state.bundle = found.json;
  state.source = found.url;
  return found.json;
}

export function setText(path, value) {
  const nodes = document.querySelectorAll(`[data-bind="${path}"]`);
  nodes.forEach((n) => {
    n.textContent = value === null || value === undefined || value === ""
      ? "—"
      : String(value);
  });
}

const OUTCOME_CLASS = {
  ALLOWED: "mint",
  PASS: "mint",
  DETECTED: "amber",
  REDACTED: "amber",
  BLOCKED: "alarm",
  FAIL: "alarm",
  ERROR: "violet",
  SKIPPED: "ash",
  NOT_EVALUATED: "ash",
};

export function outcomeClass(outcome) {
  return OUTCOME_CLASS[String(outcome || "").toUpperCase()] || "ash";
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 19);
  return d.toISOString().slice(0, 19).replace("T", " ") + "Z";
}

export function applyBundle(bundle) {
  if (!bundle) return;
  const run = bundle.run || {};
  const summary = bundle.summary || {};
  const integrity = bundle.integrity || {};
  const report = bundle.report || {};
  const checkpoint = bundle.checkpoint || {};
  const events = bundle.events || [];

  setText("run.id", run.run_id);
  setText("run.started", fmtTime(run.started_at));
  setText("run.target", run.target_mode);
  setText("run.docker", run.docker_available === true ? "available" :
    run.docker_available === false ? "absent" : "unknown");
  setText("run.runtime", run.runtime_status);
  setText("run.height", `height ${integrity.block_height ?? "—"}`);

  setText("summary.passed", summary.passed ?? 0);
  setText("summary.total", summary.total ?? 0);
  setText("summary.skipped", summary.skipped ?? 0);
  setText("summary.status", summary.report_status || "NOT_VERIFIED");

  const ingress = events.filter((e) => e.event_type === "request.ingress");
  const scenarios = new Set(events.map((e) => e.scenario_id).filter(Boolean));
  setText("attack.ingress", ingress.length);
  setText("attack.scenarios", scenarios.size);
  setText("attack.first_ts", events.length ? fmtTime(events[0].ts).slice(11, 19) : "—");

  const counts = { ALLOWED: 0, DETECTED: 0, BLOCKED: 0, REDACTED: 0, ERROR: 0 };
  events.forEach((e) => {
    const o = String(e.outcome || "").toUpperCase();
    if (o in counts) counts[o] += 1;
  });
  setText("decision.allowed", `allowed ${counts.ALLOWED}`);
  setText("decision.detected", `detected ${counts.DETECTED}`);
  setText("decision.blocked", `blocked ${counts.BLOCKED}`);
  setText("decision.redacted", `redacted ${counts.REDACTED}`);
  setText("decision.error", `error ${counts.ERROR}`);

  setText("report.status", report.status || summary.report_status || "NOT_VERIFIED");
  setText("integrity.verification", String(integrity.verification || "NOT RUN")
    .split(" (")[0]);
  setText("checkpoint.seq", checkpoint.checkpoint_seq ?? "—");
  setText("checkpoint.key", checkpoint.key_id || "—");
  setText("checkpoint.sig", checkpoint.signature_valid === true
    ? "checkpoint signature valid" :
    checkpoint.signature_valid === false ? "checkpoint signature INVALID" :
    "checkpoint signature not evaluated");
  const limits = report.limitations || [];
  setText("report.limitations", limits.length
    ? `${limits.length} limitation${limits.length > 1 ? "s" : ""}` : "no limitations");

  renderEventTable(events);
  renderMatrix(bundle.matrix || []);
}

function renderEventTable(events) {
  const host = document.querySelector('[data-bind="events.table"]');
  if (!host) return;
  const rows = events.slice(-8);
  if (!rows.length) {
    host.innerHTML = '<div class="row"><span class="seq">#—</span>' +
      '<span class="comp">no ledger events</span><span class="hash"></span>' +
      '<span class="state ash">—</span></div>';
    return;
  }
  host.innerHTML = rows.map((e) => `
    <div class="row">
      <span class="seq">#${e.seq}</span>
      <span class="comp">${String(e.component || "").toUpperCase()}</span>
      <span class="hash">${(e.hash || "").slice(0, 24)}…</span>
      <span class="state ${outcomeClass(e.outcome)}">${
        String(e.outcome || "RECORDED").toUpperCase()}</span>
    </div>`).join("");
}

function renderMatrix(rows) {
  const host = document.querySelector('[data-bind="matrix.table"]');
  if (!host) return;
  const shown = rows.filter((r) => r.result && r.result !== "NOT_EVALUATED");
  host.innerHTML =
    '<div class="mrow head"><span>Attack vector</span><span>Scenario</span>' +
    '<span>Result</span><span></span></div>' +
    shown.map((r) => `
      <div class="mrow">
        <span>${r.attack_vector || ""}</span>
        <span class="sid">${r.scenario_id || ""}</span>
        <span class="res ${r.result}">${r.result}</span>
        <span></span>
      </div>`).join("");
}
