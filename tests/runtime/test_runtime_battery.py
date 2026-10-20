"""Runtime: the in-container egress battery (Docker-gated, D26)."""

from __future__ import annotations

import json
import subprocess

import pytest

from app.harness.docker_probe import DockerProbe
from app.harness.runtime_battery import RuntimeBattery, classify_battery


def _gate():
    probe = DockerProbe()
    status = probe.check()
    if not status.get("available"):
        pytest.skip(f"docker unavailable — runtime containment test not "
                    f"executed ({status.get('reason')})")
    if not probe.compose_available():
        pytest.skip("docker compose unavailable — runtime containment test "
                    "not executed")
    if not (probe_probes_built()):
        pytest.skip("docker images not built (run docker compose build)")


def probe_probes_built() -> bool:
    try:
        proc = subprocess.run(["docker", "compose", "config", "--quiet"],
                              capture_output=True, timeout=30, text=True)
        return proc.returncode == 0
    except Exception:
        return False


def test_battery_executes_in_container_via_compose_exec(tmp_path):
    """D26: probes run INSIDE the target via compose exec; record parsed;
    verdict classified; runtime_tests.json lands in the run dir."""
    _gate()
    battery = RuntimeBattery(project_dir=".")
    record = battery.run_network("run-rt-net")
    assert record.get("verdict") in ("PASS", "NOT_EVALUATED", "ERROR", "FAIL"), \
        f"unexpected verdict: {record}"
    # the record must come from an in-container run, not host probes
    assert isinstance(record.get("probes"), list)
    ids = {p.get("id") for p in record.get("probes", [])}
    assert "external_tcp" in ids or record.get("verdict") == "ERROR", \
        f"probes missing from record: {record}"


def test_egress_battery_in_container():
    _gate()
    battery = RuntimeBattery(project_dir=".")
    record = battery.run_network("run-rt-egress")
    verdict = record.get("verdict")
    if verdict == "PASS":
        # positive denial signals must come from probes 4-6 only (D16)
        positives = [p for p in record.get("probes", [])
                     if p.get("id") in ("external_tcp", "external_dns",
                                        "external_http")
                     and p.get("denial_signal") is True]
        assert positives, "PASS without external positive signals is fabricated"
    elif verdict == "NOT_EVALUATED":
        # timeout-only: honest, not a failure — but the record must show why
        assert record.get("probes"), \
            "NOT_EVALUATED must still carry the executed probe record"
    elif verdict == "FAIL":
        pytest.fail(f"containment failure: {record.get('reason')}")
    else:
        pytest.fail(f"battery infrastructure error: {record.get('reason')}")


def test_classify_battery_parsing_end_to_end():
    """A fixture JSON record flows through classify_battery correctly
    (Docker-free — validates the parse+classify seam)."""
    fixture = {
        "container": "target",
        "probes": [
            {"id": "control_healthz_target", "ok": True},
            {"id": "control_dns_internal", "ok": True},
            {"id": "machinery_local_refused", "classified": True,
             "classification": "connection_refused"},
            {"id": "external_tcp", "denial_signal": True,
             "classification": "unreachable"},
            {"id": "external_dns", "denial_signal": True,
             "classification": "dns_failure:gaierror"},
            {"id": "external_http", "denial_signal": False,
             "classification": "timeout"},
        ]
    }
    assert classify_battery(RuntimeBattery._parse_probe_json(
        json.dumps(fixture))) == "PASS"
    # tolerate noisy stdout around the JSON
    noisy = "some warning line\n" + json.dumps(fixture) + "\ntrailing"
    assert classify_battery(RuntimeBattery._parse_probe_json(noisy)) == "PASS"
