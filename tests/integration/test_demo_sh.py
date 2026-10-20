"""Integration: demo.sh smoke — banner, scene lines, exit code, summary.

demo.sh now allocates a FRESH run id per invocation (unique run_id per
run), so repeated smoke runs can never append cycles into an old ledger.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _git_bash() -> str | None:
    """Locate a REAL POSIX bash (git-bash), avoiding the WSL shim that
    Windows puts on PATH ahead of it when running under pytest."""
    candidates = [
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files\Git\usr\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
    ]
    for c in candidates:
        if Path(c).is_file():
            return c
    found = shutil.which("bash")
    if found and "WindowsApps" not in found and "system32" not in found.lower():
        return found
    return None


def _bash_available() -> bool:
    return _git_bash() is not None


def _run_demo(runs_dir: Path) -> subprocess.CompletedProcess:
    bash = _git_bash()
    assert bash is not None, "called _run_demo without a bash"
    # Use the venv python inside the script for full env fidelity; isolate
    # runs/ under the caller's dir so the repo tree stays pristine.
    venv_py = ROOT / "venv" / "Scripts" / "python.exe"
    py = str(venv_py) if venv_py.is_file() else os.environ.get("PYTHON", "python")
    env = {**os.environ, "PYTHON": py,
           "BAYORA_RUNS_DIR": str(runs_dir)}
    return subprocess.run([bash, str(ROOT / "demo.sh")],
                          capture_output=True, text=True, timeout=900,
                          cwd=str(ROOT), env=env)


def _docker_available() -> bool:
    from app.harness.docker_probe import DockerProbe
    probe = DockerProbe()
    return bool(probe.check().get("available")) and probe.compose_available()


def test_demo_sh_runs_offline_and_exits_zero(tmp_path):
    if not _bash_available():
        import pytest
        pytest.skip("POSIX bash unavailable — demo.sh smoke skipped")
    proc = _run_demo(tmp_path / "runs")
    out = proc.stdout
    assert proc.returncode == 0, out[-3000:] + proc.stderr[-2000:]
    for needle in ("SCENE 1: BASELINE", "SCENE 2: ADVERSARIAL",
                   "SCENE 3: CONTAINMENT", "SCENE 4: RUNTIME",
                   "SCENE 5: TAMPER", "SCENE 6: SIGNED REPORT",
                   "SUMMARY"):
        assert needle in out, f"missing scene header: {needle}"
    assert "[CONTAINED]" in out
    assert "[INTERCEPTED & REDACTED]" in out
    assert "[TAMPER REJECTED]" in out
    assert "[VERIFIED]" in out
    # the smoke run must never pollute the repo's runs/ tree
    assert not (ROOT / "runs" / "demo-sh").exists()


def test_demo_runs_clean_and_tamper_paths(tmp_path):
    if not _bash_available():
        import pytest
        pytest.skip("POSIX bash unavailable — demo.sh smoke skipped")
    proc = _run_demo(tmp_path / "runs")
    out = proc.stdout
    # the clean path: baseline chain VALID; the tamper-failure path: REJECTED
    assert "chain VALID" in out
    assert "TAMPER REJECTED" in out
    assert "Original ledger" in out and "UNMODIFIED" in out
    if not _docker_available():
        # honest SKIPPED lines when the daemon is unreachable
        assert "SKIPPED" in out
    else:
        # with Docker the runtime rows must show a real verdict, never SKIPPED
        assert "SC-03r:" in out and "SC-04r:" in out
    # summary line with all six counts
    assert "SUMMARY — assertions:" in out
    assert "report_accepted=True" in out


def test_demo_sh_allocates_fresh_run_id_per_invocation(tmp_path):
    """Attack regression: two invocations must use two DIFFERENT run ids —
    the second can never append into the first run's ledger."""
    if not _bash_available():
        import pytest
        pytest.skip("POSIX bash unavailable — demo.sh smoke skipped")
    runs = tmp_path / "runs"
    p1 = _run_demo(runs)
    p2 = _run_demo(runs)
    id1 = next(l for l in p1.stdout.splitlines() if l.startswith("run_id: "))
    id2 = next(l for l in p2.stdout.splitlines() if l.startswith("run_id: "))
    assert id1 != id2, "demo.sh must allocate a fresh run_id per invocation"
