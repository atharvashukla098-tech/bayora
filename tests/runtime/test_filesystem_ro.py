"""Runtime: filesystem read-only test — actual write attempt (Docker-gated)."""

from __future__ import annotations

import pytest

from app.harness.docker_probe import DockerProbe
from app.harness.runtime_battery import RuntimeBattery


def _gate():
    probe = DockerProbe()
    status = probe.check()
    if not status.get("available"):
        pytest.skip(f"docker unavailable — runtime containment test not "
                    f"executed ({status.get('reason')})")
    if not probe.compose_available():
        pytest.skip("docker compose unavailable — runtime containment test "
                    "not executed")


def test_write_to_root_fails_EROFS():
    """An ACTUAL write to /etc/bayora_probe inside the target; EROFS expected;
    a bare failure is NOT assumed to be the read-only control (spec §4.2)."""
    _gate()
    battery = RuntimeBattery(project_dir=".")
    record = battery.run_fs("run-rt-fs")
    verdict = record.get("verdict")
    if verdict == "PASS":
        assert "EROFS" in (record.get("reason") or ""), \
            "PASS must be justified by a positive EROFS errno"
        # /tmp write must have succeeded (dedicated writable temp allowed)
        tmp_probe = next((p for p in record.get("probes", [])
                          if p.get("id") == "fs_tmp_write"), None)
        assert tmp_probe and tmp_probe.get("ok") is True
    elif verdict == "FAIL":
        pytest.fail(f"containment failure: {record.get('reason')}")
    else:
        pytest.skip(f"fs battery could not classify: {record.get('reason')}")
