"""Static API-key AuthPolicy provider (opt-in; review: "add proper auth").

For single-team deployments that need REAL authentication but have no
identity provider: an operator sets ``BAYORA_API_KEYS`` to a comma-list
of ``key=role`` pairs (e.g. ``abc123=evaluator,def456=auditor``) and
selects ``auth_policy=api-key``. Keys live in the environment only —
never in config files, never in git, never logged (authenticate() logs
the ROLE, never the key).

RBAC actions:
  evaluate        — POST /v1/evaluate, /v1/check-destination
  read_evidence   — GET health/evidence endpoints
  verify          — run ledger/report verification

evaluate requires the evaluator role; verify accepts auditor OR evaluator
(an evaluator may re-verify its own run's evidence). No key -> None ->
the broker's authorize gate rejects (fail closed).
"""

from __future__ import annotations

import hmac
import os
from typing import Optional

from app.infra.seams import AuthPolicy

_ROLE_ACTIONS: dict[str, frozenset[str]] = {
    "evaluator": frozenset({"evaluate", "read_evidence", "verify"}),
    "auditor": frozenset({"read_evidence", "verify"}),
}


class ApiKeyAuth:
    """Constant-time key lookup over BAYORA_API_KEYS (key=role,...)."""

    backend = "api-key (RBAC: evaluator/auditor)"

    def __init__(self, spec: Optional[str] = None):
        pairs = spec if spec is not None else os.environ.get("BAYORA_API_KEYS", "")
        self._keys: dict[str, str] = {}
        for part in pairs.split(","):
            part = part.strip()
            if not part or "=" not in part:
                continue
            key, role = part.split("=", 1)
            key, role = key.strip(), role.strip().lower()
            if key and role in _ROLE_ACTIONS:
                self._keys[key] = role
        if not self._keys:
            # Fail closed: an operator who selected api-key auth without
            # provisioning keys gets a provider that rejects EVERYTHING,
            # never a silent fallback to allow-all.
            self._keys = {}

    def authenticate(self, token: Optional[str]) -> Optional[str]:
        if not token:
            return None
        for key, role in self._keys.items():
            if hmac.compare_digest(key, token):
                return role
        return None

    def authorize(self, principal: Optional[str], action: str) -> bool:
        if principal is None:
            return False
        return action in _ROLE_ACTIONS.get(principal, frozenset())
