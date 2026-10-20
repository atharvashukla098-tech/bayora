"""Pluggable infrastructure seams (production-hardening pass).

Four Protocols decoupling the core from its local, offline-first defaults,
per the production-readiness review:

1. ``RateLimiter``  — TokenBucket (local) today; a Redis/atomic-Lua backend
   can be dropped in without touching broker code. Multi-worker honesty:
   ``backend`` is recorded in RUN_STARTED detail so the dashboard never
   claims a synchronized limit when the limiter is process-local.
2. ``LedgerSink``   — JSONL + fsync (local) today; append-only cloud stores
   (Kafka/Kinesis/QLDB/immudb) can implement the same interface while the
   verifier keeps reading the exported JSONL artifact.
3. ``KeyProvider`` — disk PEM (local demo) today; KMS/HSM/Vault Transit
   can implement ``sign``/``public_bytes``. The local provider refuses to
   run outside a trusted host (threat-model L4/L7 alignment).
4. ``AuthPolicy``  — trusted-loopback (local) today, matching L7; a real
   deployment MUST install an mTLS/API-key/JWT middleware provider. The
   broker fails closed when a non-local bind is requested without one.

Design rule (spec §2 offline-first): the shipped defaults stay fully
offline; cloud adapters are external, opt-in, and validated at startup.
"""

from __future__ import annotations

from typing import Optional, Protocol, runtime_checkable

from app.ledger.events import EventRecord


@runtime_checkable
class RateLimiter(Protocol):
    """Admission gate per client key — pure decision, no I/O in the hot path.

    Implementations MUST be safe for the deployment shape they declare:
    ``synchronized=True`` means cross-worker safe (e.g. Redis Lua);
    ``synchronized=False`` (the in-memory default) means per-process only.
    """

    synchronized: bool
    backend: str

    def try_acquire(self, key: str) -> bool: ...


@runtime_checkable
class LedgerSink(Protocol):
    """Durable append of one canonical event line (byte-exact JSON + \\n)."""

    backend: str

    def append_line(self, line: str) -> None: ...
    def read_lines(self) -> list[str]: ...


@runtime_checkable
class KeyProvider(Protocol):
    """Ed25519 signing via a pluggable key source (disk PEM or KMS/HSM)."""

    key_id: str
    backend: str

    def sign(self, message: bytes) -> bytes: ...
    def public_bytes(self) -> bytes: ...


@runtime_checkable
class AuthPolicy(Protocol):
    """AuthN/AuthZ decision for a request's client identity.

    The local default (``TrustedLoopback``) admits everything and exists
    ONLY for the loopback/LAN deployment documented in limitation L7.
    Production beyond loopback MUST install an enforcing provider
    (mTLS, API key, or Bearer JWT + RBAC: evaluator vs auditor).
    """

    backend: str

    def authenticate(self, token: Optional[str]) -> Optional[str]:
        """Return the verified principal (e.g. tenant/user id) or None."""
        ...

    def authorize(self, principal: Optional[str], action: str) -> bool: ...
