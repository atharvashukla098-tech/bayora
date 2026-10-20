"""Integration: demo pipeline — sockets blocked, reset/repeat, scene flow.

Every test redirects the runs dir into pytest's tmp_path via
BAYORA_RUNS_DIR (honored by app.config.load_config) — run artifacts NEVER
land in the shipped tree, and no test can destroy shipped demo evidence.

Docker-aware assertions: SC-03r/SC-04r legitimately SKIP without a daemon
and legitimately execute with one, so tests branch on the live probe result
instead of asserting a machine-dependent outcome.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PY = sys.executable


def _docker_available() -> bool:
    from app.harness.docker_probe import DockerProbe
    probe = DockerProbe()
    return bool(probe.check().get("available")) and probe.compose_available()


def _env(tmp_path: Path) -> dict:
    """Isolated env: runs dir under tmp_path (never the repo tree)."""
    return {**os.environ,
            "BAYORA_RUNS_DIR": str(tmp_path / "runs")}


def test_full_pipeline_runs_with_sockets_blocked(tmp_path):
    """Offline proof: with socket construction raising in the pipeline
    process (--block-sockets), the full demo still completes — any code
    path touching the network would crash with BAYORA_SOCKET_BLOCK."""
    rid = "demo-offline01"
    runner = subprocess.run(
        [PY, str(ROOT / "scripts" / "run_demo_pipeline.py"),
         "--scene", "all", "--run-id", rid, "--block-sockets"],
        capture_output=True, text=True, timeout=600, cwd=str(ROOT),
        env=_env(tmp_path))
    assert runner.returncode == 0, runner.stdout + runner.stderr
    # the preflight must report the LIVE socket block, not a static claim
    assert "EXTERNAL network is BLOCKED" in runner.stdout
    assert "BAYORA_SOCKET_BLOCK" not in runner.stdout, \
        "the pipeline attempted network access under --block-sockets"
    # artifacts went to tmp_path, never the repo tree
    assert (tmp_path / "runs" / rid / "ledger.jsonl").is_file()
    assert not (ROOT / "runs" / rid).exists(), \
        "integration runs must never write into the repo tree"


def test_pipeline_appends_exactly_one_run_cycle(tmp_path):
    """A demo cycle must append exactly one run.started; a second
    invocation with a fresh run_id gets its own disjoint ledger (unique
    run_id per run)."""
    rid1, rid2 = "demo-cycle01", "demo-cycle02"
    for rid in (rid1, rid2):
        r = subprocess.run(
            [PY, str(ROOT / "scripts" / "run_demo_pipeline.py"),
             "--scene", "all", "--run-id", rid],
            capture_output=True, text=True, timeout=600, cwd=str(ROOT),
            env=_env(tmp_path))
        assert r.returncode == 0, r.stdout + r.stderr
    ledger1 = (tmp_path / "runs" / rid1 / "ledger.jsonl").read_text(
        encoding="utf-8")
    started = [json.loads(l) for l in ledger1.splitlines()
               if l.strip() and json.loads(l)["event_type"] == "run.started"]
    assert len(started) == 1, \
        f"a demo cycle must append exactly one run.started, got {len(started)}"
    # run 2 has its own ledger, disjoint from run 1
    assert (tmp_path / "runs" / rid2 / "ledger.jsonl").is_file()


def test_demo_scenes_skip_honestly_without_docker(tmp_path):
    rid = "demo-offline02"
    runner = subprocess.run(
        [PY, str(ROOT / "scripts" / "run_demo_pipeline.py"),
         "--scene", "runtime", "--run-id", rid],
        capture_output=True, text=True, timeout=600, cwd=str(ROOT),
        env=_env(tmp_path))
    # exit 0 despite SKIPPED — SKIPPED is never a failure
    assert runner.returncode == 0, runner.stdout + runner.stderr
    if _docker_available():
        # with a live daemon the rows execute honestly (PASS/NOT_EVALUATED)
        assert "SC-03r:" in runner.stdout and "SC-04r:" in runner.stdout
    else:
        assert "SKIPPED" in runner.stdout, \
            "without Docker the runtime rows must report SKIPPED, not PASS"


def test_reset_demo_clears_and_rerun_passes(tmp_path):
    """Reset operates on the ISOLATED runs dir — it can never delete a
    judge's shipped demo evidence."""
    rid = "demo-rerun01"
    runs = tmp_path / "runs"
    r1 = subprocess.run(
        [PY, str(ROOT / "scripts" / "run_demo_pipeline.py"),
         "--scene", "all", "--run-id", rid],
        capture_output=True, text=True, timeout=600, cwd=str(ROOT),
        env=_env(tmp_path))
    assert r1.returncode == 0
    reset = subprocess.run(
        [PY, str(ROOT / "scripts" / "reset_demo.py"), "--confirm",
         "--runs-dir", str(runs)],
        capture_output=True, text=True, timeout=120, cwd=str(ROOT),
        env=_env(tmp_path))
    assert reset.returncode == 0
    assert "removed" in reset.stdout
    assert not runs.exists() or not any(runs.iterdir()), \
        "reset must empty the isolated runs dir"
    r2 = subprocess.run(
        [PY, str(ROOT / "scripts" / "run_demo_pipeline.py"),
         "--scene", "all", "--run-id", rid + "b"],
        capture_output=True, text=True, timeout=600, cwd=str(ROOT),
        env=_env(tmp_path))
    assert r2.returncode == 0, "repeat run after reset must pass"


def test_tamper_scene_leaves_original_valid(tmp_path):
    rid = "demo-tamper01"
    r = subprocess.run(
        [PY, str(ROOT / "scripts" / "run_demo_pipeline.py"),
         "--scene", "all", "--run-id", rid],
        capture_output=True, text=True, timeout=600, cwd=str(ROOT),
        env=_env(tmp_path))
    assert r.returncode == 0
    assert "TAMPER REJECTED" in r.stdout
    assert "UNMODIFIED" in r.stdout
    # and the original ledger on disk still verifies
    from app.ledger.verifier import verify_ledger
    vr = verify_ledger(tmp_path / "runs" / rid / "ledger.jsonl")
    assert vr.valid


def test_summary_counts_consistent(tmp_path):
    rid = "demo-sum01"
    r = subprocess.run(
        [PY, str(ROOT / "scripts" / "run_demo_pipeline.py"),
         "--scene", "all", "--run-id", rid],
        capture_output=True, text=True, timeout=600, cwd=str(ROOT),
        env=_env(tmp_path))
    assert r.returncode == 0
    s = subprocess.run(
        [PY, str(ROOT / "scripts" / "run_demo_pipeline.py"),
         "--summary", "--run-id", rid],
        capture_output=True, text=True, timeout=120, cwd=str(ROOT),
        env=_env(tmp_path))
    summary = json.loads(s.stdout)
    demo = json.loads((tmp_path / "runs" / rid / "demo_result.json")
                      .read_text(encoding="utf-8"))
    # independent recount from the recorded scenes
    status_map = {"PASS": "passed", "FAIL": "failed", "ERROR": "errored",
                  "SKIPPED": "skipped", "NOT_EVALUATED": "not_evaluated"}
    recount = {k: 0 for k in ("passed", "failed", "errored", "skipped",
                              "not_evaluated")}
    total = 0
    for entry in demo.get("scenes", []):
        for chk in entry.get("checks", []) or []:
            st = chk.get("status")
            if st in status_map:
                recount[status_map[st]] += 1
                total += 1
        if not entry.get("checks") and entry.get("status") in status_map:
            recount[status_map[entry["status"]]] += 1
            total += 1
    assert summary["total"] == total
    assert summary["passed"] == recount["passed"]
    assert summary["failed"] == recount["failed"]
    assert summary["skipped"] == recount["skipped"]
    assert summary["report_accepted"] is True


def test_run_lifecycle_events_emitted(tmp_path):
    """Attack regression (r2): the blueprint-mandated lifecycle must exist.
    §9.2 step 6 (RUN_COMPLETED with outcome), D25 (completion checkpoint
    issuance — CHECKPOINT_SIGNED used at cadence AND completion), D8
    (verification persisted as records: verifications.jsonl exists after
    the tamper scene). The old pipeline emitted NONE of these: state.json
    stayed 'in_progress' forever and a verifier could not distinguish a
    completed run from an interrupted one."""
    rid = "demo-lifecycle1"
    r = subprocess.run(
        [PY, str(ROOT / "scripts" / "run_demo_pipeline.py"),
         "--scene", "all", "--run-id", rid],
        capture_output=True, text=True, timeout=600, cwd=str(ROOT),
        env=_env(tmp_path))
    assert r.returncode == 0, r.stdout + r.stderr
    run_dir = tmp_path / "runs" / rid
    ledger = [json.loads(l) for l in
              (run_dir / "ledger.jsonl").read_text(encoding="utf-8").splitlines()
              if l.strip()]
    types = [e["event_type"] for e in ledger]
    # §9.2 step 6: RUN_COMPLETED with outcome detail
    assert "run.completed" in types, \
        f"the run lifecycle must emit run.completed (got {sorted(set(types))})"
    completed = [e for e in ledger if e["event_type"] == "run.completed"]
    assert completed[-1]["detail"]["status"] in ("complete", "failed")
    assert "counts" in completed[-1]["detail"]
    # §9.2 step 4/D8: the tamper scene's verification is a persisted record
    assert "verification.performed" in types, \
        "the tamper scene must persist verification.performed evidence"
    assert (run_dir / "verifications.jsonl").is_file(), \
        "verifications.jsonl must exist after the tamper scene"
    # D25: completion checkpoint issuance — CHECKPOINT_SIGNED at the tail
    # (after the last non-lifecycle event), i.e. the completion announcement
    assert "checkpoint.signed" in types
    last_cp_idx = max(i for i, t in enumerate(types)
                      if t == "checkpoint.signed")
    assert last_cp_idx == len(types) - 1, \
        "the completion CHECKPOINT_SIGNED must be the final ledger event"
    # state.json must no longer be stuck at in_progress
    state = json.loads((run_dir / "state.json").read_text(encoding="utf-8"))
    assert state["status"] in ("complete", "failed"), \
        f"a finished run must not read in_progress (got {state['status']})"


def test_runtime_tests_json_keeps_both_batteries(tmp_path):
    """Attack regression (r2): runtime_tests.json must hold BOTH SC-03r's
    and SC-04r's records. The old save_runtime_tests overwrote the whole
    file per call, so SC-03r's 'external denial signals' probe evidence was
    destroyed the moment SC-04r ran after it."""
    rid = "demo-rt-both"
    r = subprocess.run(
        [PY, str(ROOT / "scripts" / "run_demo_pipeline.py"),
         "--scene", "runtime", "--run-id", rid],
        capture_output=True, text=True, timeout=600, cwd=str(ROOT),
        env=_env(tmp_path))
    assert r.returncode == 0
    rt_path = tmp_path / "runs" / rid / "runtime_tests.json"
    if not rt_path.is_file():
        # Docker absent: both rows SKIPPED honestly, nothing to accumulate —
        # the no-Docker path records the skip reasons in state/demo_result
        demo = json.loads(
            (tmp_path / "runs" / rid / "demo_result.json").read_text(
                encoding="utf-8"))
        rows = [e for e in demo.get("scenes", [])
                if e.get("scene") == "runtime"]
        assert rows and all(e.get("status") == "SKIPPED" for e in rows)
        return
    data = json.loads(rt_path.read_text(encoding="utf-8"))
    batteries = data.get("batteries", {})
    assert "SC-03r" in batteries and "SC-04r" in batteries, \
        f"both battery records must survive: {list(batteries)}"
    # each record carries its own probes (the evidence the manifest claims)
    for sid in ("SC-03r", "SC-04r"):
        rec = batteries[sid]
        assert rec.get("verdict") in ("PASS", "FAIL", "NOT_EVALUATED",
                                      "ERROR", "SKIPPED")
        assert rec.get("scenario_id") == sid


def test_block_sockets_leaves_loopback_getaddrinfo_working(tmp_path):
    """Attack regression (r2): --block-sockets must keep its own contract —
    loopback stays ALLOWED. The old getaddrinfo wrapper fed (host, port)
    into create_connection (which reads them as (address, timeout)) and
    crashed with an unrelated ValueError instead of resolving loopback."""
    probe = (
        "import sys; sys.path.insert(0, r'%s');\n"
        "from scripts.run_demo_pipeline import install_socket_block;\n"
        "import socket;\n"
        "install_socket_block();\n"
        "infos = socket.getaddrinfo('localhost', 8080,"
        " proto=socket.IPPROTO_TCP);\n"
        "assert infos, 'loopback resolution must still work';\n"
        "print('LOOPBACK_OK', len(infos));\n"
        "try:\n"
        "    socket.getaddrinfo('example.com', 443,"
        " proto=socket.IPPROTO_TCP);\n"
        "    print('EXTERNAL_UNBLOCKED - FAIL');\n"
        "except RuntimeError as exc:\n"
        "    print('EXTERNAL_BLOCKED_OK' if 'BAYORA_SOCKET_BLOCK' in str(exc)"
        " else 'WRONG_ERROR - FAIL');\n"
    ) % str(ROOT)
    r = subprocess.run([PY, "-c", probe], capture_output=True, text=True,
                       timeout=120, cwd=str(ROOT))
    assert "LOOPBACK_OK" in r.stdout, \
        f"loopback getaddrinfo broken under the block: {r.stdout}{r.stderr}"
    assert "EXTERNAL_BLOCKED_OK" in r.stdout, \
        f"external resolution must raise the block marker: {r.stdout}{r.stderr}"
    assert "FAIL" not in r.stdout, r.stdout + r.stderr
