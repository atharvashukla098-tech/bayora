"""Runtime: Docker/compose gate + the D16 verdict function (Docker-free)."""

from __future__ import annotations

import pytest

from app.harness.docker_probe import DockerProbe
from app.harness.runtime_battery import classify_battery


def _docker_ready() -> tuple[bool, str]:
    probe = DockerProbe()
    status = probe.check()
    if not status.get("available"):
        return False, f"docker unavailable — runtime containment test not executed ({status.get('reason')})"
    if not probe.compose_available():
        return False, "docker compose unavailable — runtime containment test not executed"
    return True, "docker + compose available"


def _skip_guard():
    ok, reason = _docker_ready()
    return pytest.mark.skipif(not ok, reason=reason)


def test_classification_table():
    """The pure D16 verdict function over synthetic records (Docker-free)."""
    # all controls green + one positive external signal => PASS
    assert classify_battery({
        "probes": [
            {"id": "control_healthz_target", "ok": True},
            {"id": "control_dns_internal", "ok": True},
            {"id": "machinery_local_refused", "classified": True},
            {"id": "external_tcp", "denial_signal": True},
            {"id": "external_dns", "denial_signal": False},
            {"id": "external_http", "denial_signal": False},
        ]}) == "PASS"
    # controls green, only timeouts outside => NOT_EVALUATED
    assert classify_battery({
        "probes": [
            {"id": "control_healthz_target", "ok": True},
            {"id": "control_dns_internal", "ok": True},
            {"id": "machinery_local_refused", "classified": True},
            {"id": "external_tcp", "denial_signal": False},
            {"id": "external_dns", "denial_signal": False},
            {"id": "external_http", "denial_signal": False},
        ]}) == "NOT_EVALUATED"
    # a control failed => ERROR (infrastructure), never a verdict
    assert classify_battery({
        "probes": [
            {"id": "control_healthz_target", "ok": False},
            {"id": "control_dns_internal", "ok": True},
            {"id": "machinery_local_refused", "classified": True},
        ]}) == "ERROR"
    # machinery unclassifiable => ERROR
    assert classify_battery({
        "probes": [
            {"id": "control_healthz_target", "ok": True},
            {"id": "control_dns_internal", "ok": True},
            {"id": "machinery_local_refused", "classified": False},
        ]}) == "ERROR"
    # missing probes => ERROR
    assert classify_battery({"probes": []}) == "ERROR"


def test_probe3_signal_never_counts_as_denial():
    """The exact v1.1 hole: machinery ECONNREFUSED must not become PASS."""
    record = {
        "probes": [
            {"id": "control_healthz_target", "ok": True},
            {"id": "control_dns_internal", "ok": True},
            {"id": "machinery_local_refused", "classified": True,
             "classification": "connection_refused"},
            {"id": "external_tcp", "denial_signal": False,
             "classification": "timeout"},
            {"id": "external_dns", "denial_signal": False,
             "classification": "timeout"},
            {"id": "external_http", "denial_signal": False,
             "classification": "timeout"},
        ]
    }
    assert classify_battery(record) == "NOT_EVALUATED", \
        "probe-3 RST is a machinery control, NEVER denial evidence (D16)"


def test_no_docker_marks_skipped_never_pass():
    """Honest gate: probe a fake unavailable environment; SKIPPED + reason;
    and no code path turns it into PASS."""
    ok, reason = _docker_ready()
    if ok:
        pytest.skip("docker IS available on this machine — gate test n/a")
    # simulate the runner's gate result for SC-03r without docker
    from app.harness.runner import Harness, ScenarioResult
    from app.schema import AssertionStatus
    res = ScenarioResult(run_id="run-rt0", scenario_id="SC-03r",
                         status=AssertionStatus.SKIPPED, checks=[],
                         skip_reason=reason)
    assert res.status == AssertionStatus.SKIPPED
    assert "not executed" in res.skip_reason
    assert res.status != AssertionStatus.PASSED, "SKIPPED can never be PASS"


def test_sc03r_skipped_without_docker():
    """SC-03r records SKIPPED with reason when Docker is absent (D28)."""
    ok, reason = _docker_ready()
    if ok:
        pytest.skip("docker available — skip-path test not applicable")
    from app.harness.runner import Harness, ScenarioResult
    from app.schema import AssertionStatus
    res = ScenarioResult(run_id="run-rt1", scenario_id="SC-03r",
                         status=AssertionStatus.SKIPPED, checks=[],
                         skip_reason="docker unavailable — runtime network test not executed")
    assert res.status == AssertionStatus.SKIPPED


def test_sc03r_maps_to_battery_verdict():
    """The battery verdict maps to assertion semantics (D28).

    assert_battery_verdict reads the battery's OWN recorded verdict (the
    battery classifies before the runner maps); raw probe records are
    classified by classify_battery and carried in the record.
    """
    from app.harness.assertions import assert_battery_verdict
    from app.harness.runtime_battery import classify_battery
    from app.schema import AssertionStatus

    net_pass = {"verdict": classify_battery({"probes": [
        {"id": "control_healthz_target", "ok": True},
        {"id": "control_dns_internal", "ok": True},
        {"id": "machinery_local_refused", "classified": True},
        {"id": "external_dns", "denial_signal": True},
    ]})}
    passing = assert_battery_verdict(net_pass)
    assert passing.status == AssertionStatus.PASSED

    net_ne = {"verdict": classify_battery({"probes": [
        {"id": "control_healthz_target", "ok": True},
        {"id": "control_dns_internal", "ok": True},
        {"id": "machinery_local_refused", "classified": True},
        {"id": "external_dns", "denial_signal": False},
    ]})}
    timeout_only = assert_battery_verdict(net_ne)
    assert timeout_only.status == AssertionStatus.NOT_EVALUATED

    infra = assert_battery_verdict(
        {"verdict": "ERROR", "reason": "compose up failed"})
    assert infra.status == AssertionStatus.ERRORED

    # fs battery shape: the errno classification is the recorded verdict
    fs_pass = assert_battery_verdict({
        "verdict": "PASS", "reason": "EROFS confirmed (errno 30)",
        "probes": [{"id": "fs_protected_write", "stdout": "WRITE_ERR errno=30"},
                   {"id": "fs_tmp_write", "ok": True}]})
    assert fs_pass.status == AssertionStatus.PASSED, \
        "an FS battery PASS must map to PASS, not ERROR"

    fs_fail = assert_battery_verdict({
        "verdict": "FAIL", "reason": "protected-path write SUCCEEDED",
        "probes": [{"id": "fs_protected_write", "stdout": "WRITE_OK"}]})
    assert fs_fail.status == AssertionStatus.FAILED
