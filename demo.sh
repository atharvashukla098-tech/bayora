#!/usr/bin/env bash
# Bayora judge demo — 6-scene sequence, offline (blueprint §13, spec §15).
#
# Every status printed traces to an executed assertion or verification:
# colors only ever wrap computed statuses. The shell does NO counting — the
# pipeline itself recomputes the summary from recorded artifacts.
#
# Exit contract: 0 all required gates passed; 1 a required assertion/step
# failed; 2 demo aborted at a step. SKIPPED (Docker absent) never fails.

set -euo pipefail

PY="${PYTHON:-python}"
cd "$(dirname "$0")"

color() { # $1=semantic $2=text — honors NO_COLOR and non-TTY
  if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then case "$1" in
    CONTAINED)  printf '\033[32m%s\033[0m\n' "$2";;
    REDACTED)   printf '\033[33m%s\033[0m\n' "$2";;
    VERIFIED)   printf '\033[36m%s\033[0m\n' "$2";;
    TAMPER)     printf '\033[1;31m%s\033[0m\n' "$2";;
    *)          printf '%s\n' "$2";;
  esac; else printf '%s\n' "$2"; fi
}

step=0
fail() { printf '[FAILED] demo aborted at step %s: %s\n' "$step" "$1" >&2; exit 2; }

banner() {
  cat <<'EOF'
  ____    __    __  __  ____
 | __ )  / \   |  \/  |/ ___|
 |  _ \ / _ \  | |\/| |\___ \
 | |_) / ___ \ | |  | | ___) |
 |____/_/   \_\|_|  |_||____/
EOF
  echo " zero-trust AI red-teaming sandbox — demo"
  echo
}

banner

# ONE run id per demo invocation, shared by every scene process; each new
# invocation allocates a FRESH id (task: "unique run_id per run") — a rerun
# never appends a second cycle into a previous run's ledger.
# BAYORA_RUNS_DIR (tests / isolation) redirects artifacts out of the repo.
RUNS_DIR="${BAYORA_RUNS_DIR:-runs}"
RUN_FILE="$RUNS_DIR/current_demo_run"
mkdir -p "$RUNS_DIR"
RUN_ID="demo-$(date +%Y%m%d-%H%M%S)-$("$PY" -c 'import uuid;print(uuid.uuid4().hex[:6])')"
printf '%s' "$RUN_ID" > "$RUN_FILE"
echo "run_id: $RUN_ID"
echo

step=1; echo "== PREFLIGHT =="
"$PY" scripts/run_demo_pipeline.py --scene preflight || fail "preflight"

step=2; echo "== SCENE 1: BASELINE =="
if "$PY" scripts/run_demo_pipeline.py --scene baseline --run-id "$RUN_ID"; then
  color CONTAINED "[CONTAINED] Baseline run completed — see ledger output above"
else
  fail "baseline scene"
fi

step=3; echo; echo "== SCENE 2: ADVERSARIAL =="
if "$PY" scripts/run_demo_pipeline.py --scene attack --run-id "$RUN_ID"; then
  color REDACTED "[INTERCEPTED & REDACTED] Canary disclosure intercepted — redaction verified on released response"
else
  fail "attack scene"
fi

step=4; echo; echo "== SCENE 3: CONTAINMENT PROOF =="
if "$PY" scripts/run_demo_pipeline.py --scene containment --run-id "$RUN_ID"; then
  color CONTAINED "[CONTAINED] Canary absent from released response — assertion PASS"
else
  fail "containment scene"
fi

step=5; echo; echo "== SCENE 4: RUNTIME RESTRICTIONS =="
if "$PY" scripts/run_demo_pipeline.py --scene runtime --run-id "$RUN_ID"; then
  # SKIPPED (Docker absent) exits 0 — the pipeline prints the honest line
  color CONTAINED "[CONTAINED] Runtime scene processed (SKIPPED reported honestly when Docker absent)"
else
  fail "runtime scene"
fi

step=6; echo; echo "== SCENE 5: TAMPER CHALLENGE =="
if "$PY" scripts/run_demo_pipeline.py --scene tamper --run-id "$RUN_ID"; then
  color TAMPER "[TAMPER REJECTED] Ledger integrity verification failed at the flipped event — original ledger UNMODIFIED"
else
  fail "tamper scene"
fi

step=7; echo; echo "== SCENE 6: SIGNED REPORT =="
if "$PY" scripts/run_demo_pipeline.py --scene report --run-id "$RUN_ID"; then
  color VERIFIED "[VERIFIED] Report signed and independently verified — see ACCEPT line above"
else
  fail "report scene"
fi

step=8; echo; echo "== SUMMARY =="
"$PY" scripts/run_demo_pipeline.py --summary --run-id "$RUN_ID" --json summary.json || fail "summary"

"$PY" - summary.json <<'PY'
import json, sys
s = json.load(open(sys.argv[1], encoding="utf-8"))
print(f"SUMMARY — assertions: total={s['total']} passed={s['passed']} "
      f"failed={s['failed']} errored={s['errored']} skipped={s['skipped']} "
      f"not_evaluated={s['not_evaluated']} · report_status={s['report_status']} "
      f"· report_accepted={s['report_accepted']} · ledger={s['ledger']}")
PY

exit "$("$PY" scripts/run_demo_pipeline.py --summary-exit-code summary.json)"
