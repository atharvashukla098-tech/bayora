"""Local (offline-first) provider implementations of the infra seams.

These are the shipped defaults. Every provider declares exactly what it
does and does not guarantee via its ``backend`` / ``synchronized`` fields
— the rest of the system surfaces those in evidence so no consumer can
mistake a process-local limit for a synchronized one.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from app.broker.ratelimit import TokenBucket
from app.infra.seams import AuthPolicy, KeyProvider, LedgerSink, RateLimiter


class LocalTokenBucket:
    """RateLimiter adapter over the pure TokenBucket — PROCESS-LOCAL.

    Behind a multi-worker uvicorn or a round-robin LB, each worker
    enforces its own bucket: the effective limit is ``rate x workers``.
    That is honest for a single-node evaluation sandbox (limitation L10);
    production multi-worker needs the Redis/atomic-Lua adapter and MUST
    set ``synchronized=True`` there, not here.
    """

    def __init__(self, rate_per_minute: int):
        self._bucket = TokenBucket(rate_per_minute)
        self.backend = "in-memory-token-bucket (per-process)"
        self.synchronized = False

    def try_acquire(self, key: str) -> bool:
        return self._bucket.try_acquire(key)


class JsonlLedgerSink:
    """LedgerSink adapter — single-writer JSONL + flush/fsync (local).

    Single-node evaluations: ideal (portable, zero deps, crash-atomic per
    line). Shared-storage / high-throughput concurrency: the fsync-per-
    append serializes writers — swap in a Kafka/Kinesis/QLDB/immudb
    adapter implementing ``LedgerSink`` for that shape; the verifier's
    contract is the exported JSONL artifact, which every sink must still
    produce for verification and evidence (the sink is a WRITE path
    optimization, never an evidence shortcut).
    """

    def __init__(self, path: Path):
        self.path = path
        self.backend = "jsonl+fsync (single-writer)"

    def append_line(self, line: str) -> None:
        import os
        with self.path.open("a", encoding="utf-8", newline="\n") as fh:
            fh.write(line)
            fh.flush()
            os.fsync(fh.fileno())

    def read_lines(self) -> list[str]:
        if not self.path.exists():
            return []
        with self.path.open("r", encoding="utf-8") as fh:
            return [ln for ln in (l.strip() for l in fh) if ln]


class DiskKeyProvider:
    """KeyProvider adapter — Ed25519 PEM on local disk (demo-grade).

    ``keys/*.pem`` with filesystem permissions is acceptable ONLY for the
    hackathon prototype (threat-model L4: a stolen key breaks origin
    proofs). Production: implement KeyProvider over AWS KMS / GCP KMS /
    Vault Transit and rotate; this adapter then never loads the private
    key material itself.
    """

    def __init__(self, key_id: str, private_path: Path, public_path: Path):
        self.key_id = key_id
        self.backend = "disk-pem (local demo key)"
        key = serialization.load_pem_private_key(
            private_path.read_bytes(), password=None)
        if not isinstance(key, Ed25519PrivateKey):
            raise ValueError("DiskKeyProvider requires an Ed25519 PEM key")
        self._priv: Ed25519PrivateKey = key
        pub: Ed25519PublicKey = self._priv.public_key()
        self._pub_bytes: bytes = pub.public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo)

    def sign(self, message: bytes) -> bytes:
        return self._priv.sign(message)

    def public_bytes(self) -> bytes:
        return self._pub_bytes


class TrustedLoopbackAuth:
    """AuthPolicy adapter — admits all requests (L7: loopback/LAN only).

    Deliberately NOT an authentication mechanism. It exists so the seam
    is exercised end-to-end in the offline demo and so ``config.broker
    bind`` fails closed the moment a deployment leaves loopback without
    installing a real provider (mTLS / API key / Bearer JWT + RBAC).
    """

    backend = "trusted-loopback (L7: NOT an auth mechanism)"

    def authenticate(self, token: Optional[str]) -> Optional[str]:
        return "local-trusted"

    def authorize(self, principal: Optional[str], action: str) -> bool:
        return principal == "local-trusted"
