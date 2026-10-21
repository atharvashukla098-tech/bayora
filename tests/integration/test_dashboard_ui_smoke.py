"""End-to-end dashboard smoke against REAL run artifacts.

Produces a genuine pipeline run in an isolated runs dir (BAYORA_RUNS_DIR
override — never the repo tree), then executes the dossier Streamlit app
headlessly via AppTest. Asserts every section renders without exceptions
and that the tamper simulator reports a real rejection from the executed
verifier — no stub, no fabricated values.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def real_run(tmp_path_factory: pytest.TempPathFactory) -> str:
    runs_dir = tmp_path_factory.mktemp("bayora-runs")
    run_id = "smoke-real-artifacts"
    env = dict(os.environ)
    env["BAYORA_RUNS_DIR"] = str(runs_dir)
    env["PYTHONPATH"] = str(ROOT) + os.pathsep + env.get("PYTHONPATH", "")
    proc = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "run_demo_pipeline.py"),
         "--scene", "attack", "--run-id", run_id],
        cwd=str(ROOT), env=env, capture_output=True, text=True, timeout=300,
    )
    assert proc.returncode == 0, (
        f"pipeline scene failed rc={proc.returncode}\n"
        f"stdout:\n{proc.stdout[-2000:]}\nstderr:\n{proc.stderr[-2000:]}")
    assert (runs_dir / run_id / "ledger.jsonl").is_file()
    os.environ["BAYORA_RUNS_DIR"] = str(runs_dir)
    return run_id


def _apptest():
    from streamlit.testing.v1 import AppTest
    return AppTest.from_file(str(ROOT / "app" / "dashboard" / "app.py"),
                             default_timeout=120)


def test_dashboard_renders_with_real_artifacts(real_run: str):
    at = _apptest()
    at.run()
    assert not at.exception, f"app crashed: {at.exception}"

    subs = [s.value for s in at.subheader]
    assert any("Live Threat Interception" in s for s in subs), subs
    assert any("Evaluation Matrix" in s for s in subs), subs
    assert any("Tamper Simulator" in s for s in subs), subs
    assert any("Signed Attestation" in s for s in subs), subs
    assert any("incidents" in s.lower() for s in subs), subs

    # Terminal pane rendered and matrix summary carries a denominator.
    assert len(at.code) > 0
    md = " ".join(str(m.value) for m in at.markdown)
    assert "applicable assertions passed" in md


def test_tamper_simulator_reports_real_rejection(real_run: str):
    at = _apptest()
    at.run()
    assert not at.exception
    buttons = [b for b in at.button
               if "Corrupt a Disposable Ledger Copy" in b.label]
    assert buttons, [b.label for b in at.button]
    buttons[0].click().run()
    assert not at.exception, f"tamper run crashed: {at.exception}"
    texts = [str(e.value) for e in at.error] + [str(c.value) for c in at.code]
    assert any("TAMPER REJECTED" in t for t in texts), texts[:8]


def test_run_selector_and_pipeline_dispatch(real_run: str):
    at = _apptest()
    at.run()
    assert not at.exception
    run_buttons = [b for b in at.button
                   if "Run scene through pipeline" in b.label]
    assert run_buttons
    run_buttons[0].click().run()
    assert not at.exception, f"scene dispatch crashed: {at.exception}"
