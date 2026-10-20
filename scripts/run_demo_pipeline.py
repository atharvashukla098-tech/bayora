#!/usr/bin/env python
"""Demo pipeline: drives scenes 1-6 of the judge demo (blueprint §13).

Every scene runs the REAL pipeline in-process (D1/D23) and writes its results
into runs/<id>/demo_result.json. The shell (demo.sh) never counts anything;
--summary recomputes counts by re-reading the recorded artifacts.

Scenes:
  preflight   offline-readiness self-check (no network use)
  baseline    benign request + ledger VALID + checkpoint at head
  attack      SC-01 (injection) + SC-02 (canary) through the broker
  containment recompute the canary-absence assertion on the recorded observation
  runtime     Docker/compose probe -> SC-03r/SC-04r (SKIPPED when absent)
  tamper      checkpoint refresh + tamper_demo byte-flip on a disposable copy
  report      generate + sign audit_report.json + independent --verify accept

Exit contract (--summary-exit-code / --scene exits): 1 if any required
assertion failed/errored, a required verification step did not execute
(recorded status NOT_VERIFIED), the final status is FAILED/NOT_VERIFIED, or
the D15 ACCEPT rule fails. SKIPPED (Docker/config gates) never causes exit 1.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

_SOCKETS_BLOCKED = False   # set by --block-sockets (read by scene_preflight)

from app.config import load_config, validate_startup
from app.clock import SystemClock
from app.harness.docker_probe import DockerProbe
from app.harness.runtime_battery import RuntimeBattery
from app.harness.runner import Harness
from app.harness.runstore import RunStore
from app.harness.client import InProcessBrokerClient
from app.harness.scenarios import build_catalogue
from app.ledger.chain import Ledger
from app.ledger.checkpoints import LedgerCheckpointSigner, checkpoint_at_head
from app.ledger.keys import load_or_generate_keypair
from app.ledger.verifier import verify_ledger
from app.schema import AssertionStatus, Component, EventType


class Stack:
    """One wiring of the in-process stack for a single run_id."""

    def __init__(self, config, run_id: str, config_path=None):
        self.config = config
        self.config_path = config_path   # forwarded to subprocesses
        self.run_id = run_id
        self.runstore = RunStore(Path(config.ledger.runs_dir))
        self.clock = SystemClock()
        self.keypair = load_or_generate_keypair(Path(config.report.key_dir))
        run_dir = self.runstore.run_dir(run_id)
        self.ledger = Ledger(
            run_dir, self.clock,
            checkpoint_signer=LedgerCheckpointSigner(self.keypair[0],
                                                    self.keypair[1], self.clock),
            checkpoint_every=config.ledger.checkpoint_every)
        from app.target.mock import MockTarget, SecretStore
        self.secrets = SecretStore(config.canary.prefix,
                                   config.canary.unique_per_run, run_id)
        from app.target.adapter import InProcessTargetClient
        target = InProcessTargetClient(MockTarget(self.secrets))
        from app.broker.service import create_broker_app
        self.broker_app = create_broker_app(config, target_client=target,
                                            ledger=self.ledger,
                                            secret_store=self.secrets)
        self.client = InProcessBrokerClient(self.broker_app)
        self.battery = RuntimeBattery(project_dir=str(ROOT))
        self.harness = Harness(config, broker_client=self.client,
                                runstore=self.runstore, keypair=self.keypair,
                                clock=self.clock, runtime_battery=self.battery,
                                secret_store=self.secrets, ledger=self.ledger)


def _emit(stack: Stack, scene: str, entry: dict) -> None:
    entry["scene"] = scene
    stack.runstore.append_demo_result(stack.run_id, entry)


# ------------------------------------------------------------------ scenes

def install_socket_block() -> None:
    """Test hook: block EXTERNAL network from this process — the offline proof.

    The broker uses Starlette's TestClient (in-memory, no sockets) and the
    target is the in-process mock, so with this installed the pipeline can
    only complete if NO code path dials out. Any external attempt raises
    RuntimeError with a distinct marker so a failure names the offender.

    Loopback (127.0.0.1/::1/localhost) stays ALLOWED: Windows event loops
    build their wakeup pipes via socketpair(), which legitimately connects
    on loopback; the offline guarantee being proven is "no EXTERNAL
    network". (Blocking the socket class outright would break loop startup
    rather than prove anything.) getaddrinfo keeps its REAL signature and
    merely inspects the host — the previous wrapper fed getaddrinfo's
    positional args into create_connection, which crashed loopback
    resolution with an unrelated ValueError instead of allowing it.
    """
    import socket as _socket

    _LOOPBACK = {"127.0.0.1", "::1", "localhost", "0.0.0.0", ""}

    def _host_of(target) -> object:
        host = target[0] if isinstance(target, tuple) and target else target
        return host if isinstance(host, str) else None

    _orig_connect = _socket.socket.connect
    _orig_create_connection = _socket.create_connection
    _orig_getaddrinfo = _socket.getaddrinfo

    def _guarded_connect(self, address, *args, **kwargs):
        host = _host_of(address)
        if isinstance(host, str) and host.lower() in _LOOPBACK:
            return _orig_connect(self, address, *args, **kwargs)
        raise RuntimeError(
            "BAYORA_SOCKET_BLOCK: external network attempted under "
            "--block-sockets (offline proof): "
            f"{host!r}")

    def _blocked_create_connection(address, *args, **kwargs):
        host = _host_of(address)
        if isinstance(host, str) and host.lower() in _LOOPBACK:
            return _orig_create_connection(address, *args, **kwargs)
        raise RuntimeError(
            "BAYORA_SOCKET_BLOCK: external connection attempted under "
            "--block-sockets (offline proof)")

    def _blocked_getaddrinfo(host, *args, **kwargs):
        if isinstance(host, str) and host.lower() in _LOOPBACK:
            return _orig_getaddrinfo(host, *args, **kwargs)
        raise RuntimeError(
            "BAYORA_SOCKET_BLOCK: external resolution attempted under "
            "--block-sockets (offline proof): "
            f"{host!r}")

    _socket.socket.connect = _guarded_connect  # type: ignore[method-assign,assignment]
    _socket.socket.connect_ex = _guarded_connect  # type: ignore[method-assign,assignment]
    _socket.create_connection = _blocked_create_connection  # type: ignore[misc,assignment]
    _socket.getaddrinfo = _blocked_getaddrinfo  # type: ignore[misc,assignment]


def scene_preflight(config) -> int:
    print("[RUNNING] preflight: offline readiness check")
    print(f"  {validate_startup(config)}")
    wheels = ROOT / "wheels"
    has_wheels = wheels.is_dir() and any(wheels.iterdir())
    if has_wheels:
        print("  wheels/: present (offline install available)")
    else:
        print("  wheels/: ABSENT (deps installed via pip; offline wheel "
              "vendoring not populated on this machine)")
    if globals().get("_SOCKETS_BLOCKED", False):
        print("  offline_mode: True — EXTERNAL network is BLOCKED in this "
              "process (--block-sockets; loopback allowed for event-loop "
              "internals); the pipeline ran without external network")
    else:
        print("  offline_mode: True (no network calls in the pipeline; "
              "provable via --block-sockets / the sockets-blocked test)")
    return 0


def scene_baseline(stack: Stack) -> int:
    print("[RUNNING] scene 1: baseline — benign request end-to-end")
    ledger = stack.ledger
    ledger.append(EventType.RUN_STARTED, Component.HARNESS, run_id=stack.run_id,
                  outcome=None, scenario_id=None,
                  detail={"mode": stack.config.target_mode,
                          "config_digest": stack.config.config_digest()})
    resp = stack.client.post_evaluate(
        "Hello, please acknowledge this benign status request.",
        run_id=stack.run_id, scenario_id="baseline-benign")
    body = resp.json()
    ok = resp.status_code == 200 and body.get("outcome") == "ALLOWED"
    stack.runstore.append_observation(stack.run_id, {
        "scenario_id": "baseline-benign", "outcome": body.get("outcome"),
        "status_code": resp.status_code,
        "released_text": body.get("released_text"),
        "event_ids": body.get("events", []),
    })
    vr = verify_ledger(ledger.path)
    cp = None
    if stack.config.ledger.sign_checkpoints:
        cp = checkpoint_at_head(ledger, stack.keypair[0], stack.keypair[1],
                                SystemClock())
    status = "PASS" if (vr.valid and ok) else "FAIL"
    print(f"  benign roundtrip: {'ok' if ok else 'FAILED'}; "
          f"ledger height {vr.checked_height}, chain "
          f"{'VALID' if vr.valid else 'INVALID'}"
          + (f"; checkpoint seq {cp.checkpoint_seq} SIGNED" if cp else ""))
    _emit(stack, "baseline", {
        "status": status, "scenario_id": "baseline-benign",
        "outcome": body.get("outcome"),
        "ledger_height": vr.checked_height, "chain_valid": vr.valid,
        "checkpoint_seq": cp.checkpoint_seq if cp else None,
    })
    stack.runstore.set_latest_demo_run(stack.run_id)
    return 0 if status == "PASS" else 1


def scene_attack(stack: Stack) -> int:
    print("[RUNNING] scene 2: adversarial — SC-01 injection + SC-02 canary")
    specs = {s.scenario_id: s for s in build_catalogue()}
    rc = 0
    for sid in ("SC-01", "SC-02"):
        result = stack.harness.run(specs[sid], run_id=stack.run_id)
        _emit(stack, "attack", {
            "scenario_id": sid, "status": result.status.value,
            "checks": [c.model_dump() for c in result.checks],
            "event_ids": result.evidence_event_ids,
        })
        print(f"  {sid}: {result.status.value}"
              + (f" ({result.skip_reason})" if result.skip_reason else ""))
        if result.status not in (AssertionStatus.PASSED, AssertionStatus.SKIPPED):
            rc = 1
    return rc


def scene_containment(stack: Stack) -> int:
    print("[RUNNING] scene 3: containment proof — recompute on recorded observation")
    observations = stack.runstore.load_observations(stack.run_id)
    sc02 = next((o for o in observations if o.get("scenario_id") == "SC-02"), None)
    if sc02 is None:
        print("  [FAIL] SC-02 observation missing — run the attack scene first")
        _emit(stack, "containment", {"status": "FAIL",
                                     "reason": "SC-02 observation not found"})
        return 1
    released = sc02.get("released_text") or ""
    canary = stack.secrets.canary_value
    absent = (canary not in released) and ("BAYORA-CANARY" not in released)
    print(f"  released text: {released[:80]!r}")
    print(f"  canary absent from released response: "
          f"{'PASS' if absent else 'FAIL'} (assertion recomputed on the "
          f"actual released response, spec §3.4)")
    _emit(stack, "containment", {
        "status": "PASS" if absent else "FAIL",
        "scenario_id": "SC-02-recompute",
        "released_excerpt": released[:120],
        "canary_absent": absent,
    })
    return 0 if absent else 1


def scene_runtime(stack: Stack) -> int:
    print("[RUNNING] scene 4: runtime restrictions — Docker/compose probe")
    status = stack.battery.probe_status()
    specs = {s.scenario_id: s for s in build_catalogue()}
    if status.get("available") is not True:
        reason = status.get("reason", "docker unavailable")
        print(f"  [SKIPPED] Docker unavailable ({reason}) — runtime containment "
              "tests not executed (reported as SKIPPED, not PASS)")
        for sid in ("SC-03r", "SC-04r"):
            result = stack.harness.run(specs[sid], run_id=stack.run_id)
            _emit(stack, "runtime", {
                "scenario_id": sid, "status": result.status.value,
                "skip_reason": result.skip_reason,
                "checks": [c.model_dump() for c in result.checks]})
            print(f"  {sid}: {result.status.value} ({result.skip_reason})")
        return 0
    rc = 0
    for sid in ("SC-03r", "SC-04r"):
        result = stack.harness.run(specs[sid], run_id=stack.run_id)
        _emit(stack, "runtime", {
            "scenario_id": sid, "status": result.status.value,
            "checks": [c.model_dump() for c in result.checks]})
        print(f"  {sid}: {result.status.value}"
              + (f" ({result.skip_reason})" if result.skip_reason else ""))
        if result.status == AssertionStatus.FAILED:
            rc = 1
    return rc


def scene_tamper(stack: Stack) -> int:
    print("[RUNNING] scene 5: tamper challenge on a disposable copy")
    cp = checkpoint_at_head(stack.ledger, stack.keypair[0], stack.keypair[1],
                           SystemClock())
    print(f"  checkpoint at head: SIGNED (seq={cp.checkpoint_seq}, "
          f"key={cp.key_id}) — refresh appends nothing (D25)")
    proc = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "tamper_demo.py"),
         "--ledger", str(stack.ledger.path), "--mode", "byte", "--event", "3"],
        capture_output=True, text=True, timeout=120, cwd=str(ROOT))
    print(proc.stdout.rstrip())
    if proc.stderr.strip():
        print(proc.stderr.strip(), file=sys.stderr)
    ok = proc.returncode == 1 and "TAMPER REJECTED" in proc.stdout \
        and "UNMODIFIED" in proc.stdout
    # D8/§9.2 step 4: the tamper scene's verification is a PERSISTED record
    # (verifications.jsonl + verification.performed ledger event), not just
    # subprocess stdout. The original's fresh verify result is what lands.
    vr = verify_ledger(stack.ledger.path, checkpoint=cp,
                       trusted_public_key=stack.keypair[2])
    stack.runstore.append_verification(stack.run_id, vr)
    from app.schema import Component, EventType
    stack.ledger.append(
        EventType.VERIFICATION_PERFORMED, Component.VERIFIER,
        run_id=stack.run_id, outcome=None, scenario_id="SC-05-demo",
        detail={"valid": "true" if vr.valid else "false",
                "findings": ",".join(f.value for f in vr.findings) or "none",
                "checked_height": str(vr.checked_height),
                "coverage": vr.checkpoint_coverage})
    _emit(stack, "tamper", {
        "status": "PASS" if ok else "FAIL",
        "scenario_id": "SC-05-demo",
        "tamper_exit_code": proc.returncode,
        "verification_persisted": True,
    })
    return 0 if ok else 1


def scene_report(stack: Stack, *, failed: bool = False) -> int:
    print("[RUNNING] scene 6: signed report + independent verification")
    # Run-completion lifecycle FIRST (blueprint §9.2 step 6 / D25): the
    # report must attest the FINAL chain — RUN_COMPLETED, the drained
    # rejection summary and the completion CHECKPOINT_SIGNED are all part
    # of the evidence it signs. Finalizing after generation would leave the
    # signed block_height stale and the independent verify would REJECT.
    finalize_run(stack, failed=failed)
    gen_args = [sys.executable, str(ROOT / "scripts" / "generate_report.py"),
                "--run", stack.run_id]
    if stack.config_path is not None:
        gen_args += ["--config", str(stack.config_path)]
    gen = subprocess.run(gen_args, capture_output=True, text=True,
                         timeout=180, cwd=str(ROOT))
    print(gen.stdout.rstrip())
    if gen.returncode != 0:
        print(gen.stderr.rstrip(), file=sys.stderr)
        _emit(stack, "report", {"status": "FAIL",
                                "reason": "generate_report failed"})
        return 1
    report_path = Path(stack.config.ledger.runs_dir) / stack.run_id / "audit_report.json"
    verify_args = [sys.executable, str(ROOT / "scripts" / "generate_report.py"),
                   "--verify", str(report_path)]
    if stack.config_path is not None:
        verify_args += ["--config", str(stack.config_path)]
    verify = subprocess.run(verify_args, capture_output=True, text=True,
                             timeout=180, cwd=str(ROOT))
    print(verify.stdout.rstrip())
    accepted = verify.returncode == 0 and "ACCEPT:             True" in verify.stdout
    _emit(stack, "report", {
        "status": "PASS" if accepted else "FAIL",
        "scenario_id": "report-verify",
        "accepted": accepted,
    })
    return 0 if accepted else 1


# ------------------------------------------------------------------ summary

def drain_rejections(stack: Stack) -> int:
    """§7.4 step 10: flush any rejections still buffered when a scene
    process ends. demo.sh runs each scene as its own process — without
    this, a hostile burst that ends inside a summary window would die with
    the process instead of being recorded as a REJECTIONS_SUMMARY event.
    Never closes the run (RUN_COMPLETED is finalize_run's job)."""
    buffer = getattr(stack.broker_app.state, "rejection_buffer", None)
    if buffer is None:
        return 0
    try:
        return buffer.flush(stack.ledger, stack.run_id)
    except Exception:
        return 0


def finalize_run(stack: Stack, *, failed: bool) -> None:
    """Run-completion lifecycle (blueprint §9.2 step 6, §7.4 step 10, D25).

    Idempotent-safe: skips when the run is already completed. Steps:
      1. drain the broker's RejectionBuffer — buffered rejections become a
         REJECTIONS_SUMMARY event instead of dying with the process;
      2. emit RUN_COMPLETED (detail: outcome status + the six-part counts
         recomputed from state);
      3. completion checkpoint: sign the head FIRST (sidecar), then append
         the CHECKPOINT_SIGNED announcement (D25's two-uses rule);
      4. state.json -> 'complete' — a finished run is distinguishable from
         an interrupted one.
    """
    state = stack.runstore.load_state(stack.run_id)
    if state is not None and state.status in ("complete", "failed"):
        drain_rejections(stack)
        return
    # 1. drain buffered rejections (the buffer lives on the broker app)
    drain_rejections(stack)
    # 2. RUN_COMPLETED with the outcome + counts
    counts = dict(state.assertions) if state is not None else {
        "total": 0, "passed": 0, "failed": 0, "errors": 0,
        "skipped": 0, "not_evaluated": 0}
    outcome = "failed" if failed else "complete"
    from app.schema import Component, EventType
    try:
        stack.ledger.append(
            EventType.RUN_COMPLETED, Component.HARNESS,
            run_id=stack.run_id, outcome=None, scenario_id=None,
            detail={"status": outcome, "counts": json.dumps(
                {k: str(v) for k, v in counts.items()}, sort_keys=True)})
    except Exception:
        pass
    # 3. completion checkpoint issuance: sign first, announce after (D25)
    if stack.config.ledger.sign_checkpoints and stack.ledger.block_height > 0:
        try:
            stack.ledger.sign_and_announce(run_id=stack.run_id)
        except Exception:
            pass
    # 4. persist the final state
    stack.runstore.complete_run(stack.run_id, status=outcome, counts=counts)


def do_summary(run_id: str, config, json_out: Path | None) -> dict:
    """Recompute all counts from recorded artifacts — never in-memory state."""
    runstore = RunStore(Path(config.ledger.runs_dir))
    demo_path = runstore.run_dir(run_id) / "demo_result.json"
    demo = json.loads(demo_path.read_text(encoding="utf-8"))
    counts = {"total": 0, "passed": 0, "failed": 0, "errors": 0,
              "skipped": 0, "not_evaluated": 0}
    status_map = {"PASS": "passed", "FAIL": "failed", "ERROR": "errors",
                  "SKIPPED": "skipped", "NOT_EVALUATED": "not_evaluated"}

    for scene_entry in demo.get("scenes", []):
        for check in scene_entry.get("checks", []) or []:
            st = check.get("status")
            if st in status_map:
                counts["total"] += 1
                counts[status_map[st]] += 1
        if scene_entry.get("checks"):
            continue
        st = scene_entry.get("status")
        if st in status_map:
            counts["total"] += 1
            counts[status_map[st]] += 1

    report_path = Path(config.ledger.runs_dir) / run_id / "audit_report.json"
    report_status = None
    report_accepted = False
    if report_path.is_file():
        report = json.loads(report_path.read_text(encoding="utf-8"))
        report_status = report.get("status")
        v = subprocess.run([sys.executable,
                            str(ROOT / "scripts" / "generate_report.py"),
                            "--verify", str(report_path)],
                           capture_output=True, text=True, timeout=120,
                           cwd=str(ROOT))
        report_accepted = v.returncode == 0
    summary = {
        "run_id": run_id,
        "total": counts["total"], "passed": counts["passed"],
        "failed": counts["failed"], "errored": counts["errors"],
        "skipped": counts["skipped"], "not_evaluated": counts["not_evaluated"],
        "report_status": report_status, "report_accepted": report_accepted,
        "ledger": str(Path(config.ledger.runs_dir) / run_id / "ledger.jsonl"),
    }
    if json_out:
        Path(json_out).write_text(json.dumps(summary, indent=2) + "\n",
                                  encoding="utf-8")
    return summary


def summary_exit_code(summary: dict) -> int:
    """Exit contract: 0 pass; 1 required failure / step missing / not accepted."""
    if summary["failed"] > 0 or summary["errored"] > 0:
        return 1
    if summary["report_status"] in (None, "FAILED", "NOT_VERIFIED"):
        return 1
    if not summary["report_accepted"]:
        return 1
    return 0


# ------------------------------------------------------------------ main

def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Bayora demo pipeline")
    parser.add_argument("--scene", default="all",
                        choices=["all", "preflight", "baseline", "attack",
                                 "containment", "runtime", "tamper", "report"])
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--config", default=None)
    parser.add_argument("--json", dest="json_out", default=None)
    parser.add_argument("--summary", action="store_true",
                        help="recompute and print the six counts + report status")
    parser.add_argument("--summary-exit-code", default=None,
                        help="print the exit-contract code for a summary file")
    parser.add_argument("--block-sockets", action="store_true",
                        help="install the offline proof: socket construction "
                             "raises; the pipeline must still complete")
    args = parser.parse_args(argv)

    config = load_config(Path(args.config) if args.config else None)

    if args.block_sockets and not args.summary_exit_code:
        install_socket_block()
        global _SOCKETS_BLOCKED
        _SOCKETS_BLOCKED = True

    if args.summary_exit_code:
        summary = json.loads(Path(args.summary_exit_code)
                             .read_text(encoding="utf-8"))
        code = summary_exit_code(summary)
        print(code)
        return code

    if args.summary:
        run_id = args.run_id or RunStore(
            Path(config.ledger.runs_dir)).latest_demo_run()
        if not run_id:
            print("ERROR: no run id (use --run-id or run the demo first)")
            return 2
        summary = do_summary(run_id, config,
                             Path(args.json_out) if args.json_out else None)
        print(json.dumps(summary, indent=2))
        return 0

    run_id = args.run_id or (
        "demo-" + SystemClock().now_utc().strftime("%Y%m%d-%H%M%S")
        + "-" + uuid.uuid4().hex[:4])
    scenes = (["preflight", "baseline", "attack", "containment",
               "runtime", "tamper", "report"]
              if args.scene == "all" else [args.scene])

    stack = Stack(config, run_id,
                  config_path=(Path(args.config) if args.config else None))
    rc = 0
    for scene in scenes:
        if scene == "preflight":
            rc |= scene_preflight(config)
        elif scene == "baseline":
            rc |= scene_baseline(stack)
        elif scene == "attack":
            rc |= scene_attack(stack)
        elif scene == "containment":
            rc |= scene_containment(stack)
        elif scene == "runtime":
            rc |= scene_runtime(stack)
        elif scene == "tamper":
            rc |= scene_tamper(stack)
        elif scene == "report":
            rc |= scene_report(stack, failed=(rc != 0))
    # §7.4 step 10, per-process: any scene invocation that did NOT close the
    # run still drains its broker's RejectionBuffer before exiting, so
    # buffered rejections are always summarized, never dropped.
    if "report" not in scenes:
        drain_rejections(stack)
    return rc


if __name__ == "__main__":
    sys.exit(main())
