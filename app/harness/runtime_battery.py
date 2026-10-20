"""Runtime battery: in-container probe orchestration (blueprint §9.6, D26).

Host-side orchestrator. Every method probes Docker/Compose LIVE first and
returns a BatteryRecord (pure data); skip/verdict decisions never guess.

``classify_battery`` is the PURE D16 verdict function — unit-tested
Docker-free:
  controls A+B fail           -> ERROR   (infrastructure)
  machinery probe unclassif.  -> ERROR   (infrastructure)
  >=1 positive denial signal from external probes 4-6 only -> PASS
  controls OK, zero positive external signals -> NOT_EVALUATED (timeout_only)
The on-link machinery probe is a control, never evidence: its ECONNREFUSED
occurs in every environment, contained or not.
"""

from __future__ import annotations

import json
import subprocess
from typing import Literal, Optional

from app.harness.docker_probe import DockerProbe

Verdict = Literal["PASS", "FAIL", "NOT_EVALUATED", "ERROR", "SKIPPED"]

# probe ids -> role
EXTERNAL_EVIDENCE_PROBES = {"external_tcp", "external_dns", "external_http"}


def classify_battery(record: dict) -> Verdict:
    """Pure verdict function (D16). Never touches Docker. Unit-tested."""
    probes = {p.get("id"): p for p in record.get("probes", []) if isinstance(p, dict)}

    control_a = probes.get("control_healthz_target")
    control_b = probes.get("control_dns_internal")
    machinery = probes.get("machinery_local_refused")

    if control_a is None or control_b is None or machinery is None:
        return "ERROR"
    if control_a.get("ok") is not True or control_b.get("ok") is not True:
        return "ERROR"
    if machinery.get("classified") is not True:
        return "ERROR"

    positive_signals = [
        p for pid, p in probes.items()
        if pid in EXTERNAL_EVIDENCE_PROBES
        and p.get("denial_signal") is True
    ]
    if positive_signals:
        return "PASS"
    return "NOT_EVALUATED"


def _run(cmd: list[str], timeout: int = 60,
         cwd: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                          cwd=cwd)


def _compose_up(services: list[str], project_dir: str,
                attempts: int = 2) -> subprocess.CompletedProcess:
    """compose up --build --wait, retrying once on a transient failure.

    On Docker Desktop (Windows) a teardown from a PREVIOUS battery can
    still be releasing the network when the next up runs; one retry after
    a short drain resolves that race without ever masking a real failure.
    """
    import time
    result = _run(["docker", "compose", "up", "-d", "--build", "--wait",
                   *services], timeout=300, cwd=project_dir)
    while result.returncode != 0 and attempts > 1:
        attempts -= 1
        time.sleep(5)
        result = _run(["docker", "compose", "up", "-d", "--build", "--wait",
                       *services], timeout=300, cwd=project_dir)
    return result


class RuntimeBattery:
    """Orchestrates the compose stack and in-container probes (D26)."""

    def __init__(self, project_dir: Optional[str] = None):
        self.project_dir = project_dir or "."
        self.probe = DockerProbe()

    def probe_status(self) -> dict:
        status = self.probe.check()
        status["compose"] = self.probe.compose_available()
        return status

    # ------------------------------------------------------------ network

    def run_network(self, run_id: str) -> dict:
        """Full network battery: compose up, in-container probes, teardown."""
        status = self.probe_status()
        if status.get("available") is not True:
            return {"verdict": "SKIPPED",
                    "reason": status.get("reason", "docker unavailable"),
                    "run_id": run_id, "probes": []}
        if status.get("compose") is not True:
            return {"verdict": "SKIPPED",
                    "reason": "docker compose unavailable",
                    "run_id": run_id, "probes": []}
        try:
            up = _compose_up(["target", "broker"], self.project_dir)
            if up.returncode != 0:
                return {"verdict": "ERROR", "run_id": run_id, "probes": [],
                        "reason": f"compose up --wait failed: "
                                  f"{(up.stdout + up.stderr).strip()[-300:]}"}
            # Control A: broker -> target healthz over the internal network.
            # The probe script itself classifies ok (compact-JSON tolerant);
            # parse its JSON record rather than substring-matching stdout.
            a = _run(["docker", "compose", "exec", "-T", "broker",
                      "python", "scripts/runtime_probe.py",
                      "--probe", "healthz_target"], timeout=60,
                     cwd=self.project_dir)
            a_rec = self._parse_probe_json(a.stdout)
            a_ok = bool(a_rec.get("ok")) if a_rec.get("id") == \
                "control_healthz_target" else (a.returncode == 0)
            control_a = {"id": "control_healthz_target",
                         "ok": a_ok, "stdout": a.stdout[-200:]}
            # All target-side probes in one JSON record (controls + evidence).
            b = _run(["docker", "compose", "exec", "-T", "target",
                      "python", "scripts/runtime_probe.py", "--json"], timeout=120, cwd=self.project_dir)
            record = self._parse_probe_json(b.stdout)
            probes = record.get("probes", [])
            control_a_rec = next((p for p in probes
                                  if p.get("id") == "control_healthz_target"), None)
            control_b_rec = next((p for p in probes
                                  if p.get("id") == "control_dns_internal"), None)
            machinery = next((p for p in probes
                              if p.get("id") == "machinery_local_refused"), None)
            combined = ([control_a] if control_a_rec is None else []) + probes
            # ensure control A present even if target-side record omits it
            if control_a_rec is not None:
                combined = probes
            verdict = classify_battery({"probes": combined})
            return {"verdict": verdict, "run_id": run_id,
                    "probes": combined, "compose_up": True}
        except subprocess.TimeoutExpired:
            return {"verdict": "ERROR", "reason": "compose exec timed out",
                    "run_id": run_id, "probes": []}
        except OSError as exc:
            return {"verdict": "ERROR", "reason": f"docker exec failed: {exc}",
                    "run_id": run_id, "probes": []}
        finally:
            # Full teardown; a failed down is retried once (Desktop teardown
            # races) and never raises into the battery's verdict path.
            try:
                d = _run(["docker", "compose", "down", "-v", "--remove-orphans"],
                         timeout=120, cwd=self.project_dir)
                if d.returncode != 0:
                    import time
                    time.sleep(3)
                    _run(["docker", "compose", "down", "-v", "--remove-orphans"],
                         timeout=120, cwd=self.project_dir)
            except Exception:
                pass

    # ------------------------------------------------------------ fs

    def run_fs(self, run_id: str) -> dict:
        """EROFS battery: protected-path write must fail; /tmp write must work."""
        status = self.probe_status()
        if status.get("available") is not True:
            return {"verdict": "SKIPPED",
                    "reason": status.get("reason", "docker unavailable"),
                    "run_id": run_id, "probes": []}
        if status.get("compose") is not True:
            return {"verdict": "SKIPPED", "reason": "docker compose unavailable",
                    "run_id": run_id, "probes": []}
        try:
            up = _compose_up(["target"], self.project_dir)
            if up.returncode != 0:
                return {"verdict": "ERROR", "run_id": run_id, "probes": [],
                        "reason": f"compose up --wait failed: "
                                  f"{(up.stdout + up.stderr).strip()[-300:]}"}
            # Protected-path write attempt (must FAIL with EROFS ideally).
            prot = _run(["docker", "compose", "exec", "-T", "target", "python", "-c",
                         "import sys, errno\n"
                         "try:\n"
                         "    open('/etc/bayora_probe','w').write('x')\n"
                         "    print('WRITE_OK')\n"
                         "except OSError as e:\n"
                         "    print('WRITE_ERR errno=%d' % e.errno)\n"
                         ], timeout=60, cwd=self.project_dir)
            tmp = _run(["docker", "compose", "exec", "-T", "target", "python", "-c",
                        "open('/tmp/bayora_probe','w').write('x')\n"
                        "print('TMP_WRITE_OK')\n"
                        ], timeout=60, cwd=self.project_dir)
            prot_out = prot.stdout.strip()
            tmp_ok = "TMP_WRITE_OK" in tmp.stdout
            if "WRITE_OK" in prot_out:
                verdict = "FAIL"
                reason = "protected-path write SUCCEEDED — read-only rootfs not enforced"
            elif "WRITE_ERR errno=30" in prot_out:
                verdict = "PASS"
                reason = "EROFS confirmed (errno 30) on protected-path write"
            elif "WRITE_ERR" in prot_out:
                verdict = "FAIL"
                reason = f"protected-path write failed with non-EROFS errno: {prot_out}"
            else:
                verdict = "ERROR"
                reason = f"unclassifiable probe output: {prot_out}"
            if not tmp_ok and verdict == "PASS":
                verdict = "FAIL"
                reason = "/tmp write failed — dedicated writable temp missing"
            return {"verdict": verdict, "reason": reason, "run_id": run_id,
                    "probes": [{"id": "fs_protected_write", "stdout": prot_out},
                               {"id": "fs_tmp_write", "ok": tmp_ok}]}
        except subprocess.TimeoutExpired:
            return {"verdict": "ERROR", "reason": "compose exec timed out",
                    "run_id": run_id, "probes": []}
        except OSError as exc:
            return {"verdict": "ERROR", "reason": f"docker exec failed: {exc}",
                    "run_id": run_id, "probes": []}
        finally:
            # Full teardown; a failed down is retried once (Desktop teardown
            # races) and never raises into the battery's verdict path.
            try:
                d = _run(["docker", "compose", "down", "-v", "--remove-orphans"],
                         timeout=120, cwd=self.project_dir)
                if d.returncode != 0:
                    import time
                    time.sleep(3)
                    _run(["docker", "compose", "down", "-v", "--remove-orphans"],
                         timeout=120, cwd=self.project_dir)
            except Exception:
                pass

    # ------------------------------------------------------------ parsing

    @staticmethod
    def _parse_probe_json(stdout: str) -> dict:
        """Parse the in-container probe record from stdout; tolerate noise."""
        import json as _json
        try:
            return _json.loads(stdout)
        except _json.JSONDecodeError:
            pass
        # find the largest parseable JSON object embedded in the output
        best: dict = {"probes": []}
        for i, ch in enumerate(stdout):
            if ch != "{":
                continue
            for j in range(len(stdout), i, -1):
                if stdout[j - 1] != "}":
                    continue
                try:
                    obj = _json.loads(stdout[i:j])
                    if isinstance(obj, dict):
                        return obj
                except _json.JSONDecodeError:
                    continue
        return best
