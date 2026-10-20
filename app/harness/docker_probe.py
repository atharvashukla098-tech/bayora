"""Live Docker/compose probe (blueprint §14.1).

Every runtime gate calls these live — never a config flag (spec §4.3: config
files existing does not mean a control is active).
"""

from __future__ import annotations

import shutil
import subprocess
from typing import Optional


class DockerStatus(dict):
    """Dict-shaped status: available, reason, version, compose."""

    @property
    def available(self) -> bool:
        return bool(self.get("available"))


class DockerProbe:
    """Probes docker + compose availability live, with timeouts."""

    def check(self) -> DockerStatus:
        if shutil.which("docker") is None:
            return DockerStatus({"available": False,
                                 "reason": "docker CLI not found",
                                 "version": None})
        try:
            proc = subprocess.run(["docker", "info"], capture_output=True,
                                   timeout=10, text=True)
        except (subprocess.TimeoutExpired, OSError) as exc:
            return DockerStatus({"available": False,
                                 "reason": f"daemon unreachable ({type(exc).__name__})",
                                 "version": None})
        if proc.returncode != 0:
            return DockerStatus({"available": False,
                                 "reason": "daemon unreachable",
                                 "version": None})
        return DockerStatus({"available": True, "reason": None,
                            "version": self._version()})

    def compose_available(self) -> bool:
        """v1.3 (D26): `docker compose version` exit 0 (Compose v2 subcommand)."""
        if shutil.which("docker") is None:
            return False
        try:
            proc = subprocess.run(["docker", "compose", "version"],
                                  capture_output=True, timeout=10, text=True)
        except (subprocess.TimeoutExpired, OSError):
            return False
        return proc.returncode == 0

    def _version(self) -> Optional[str]:
        try:
            proc = subprocess.run(["docker", "--version"], capture_output=True,
                                  timeout=10, text=True)
            return proc.stdout.strip() or None
        except (subprocess.TimeoutExpired, OSError):
            return None
