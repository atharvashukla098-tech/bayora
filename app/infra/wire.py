"""Infrastructure seam wiring — validated at startup, fail-closed (spec §11).

``build_*`` functions are the ONLY sanctioned way to obtain providers.
Cloud backends (Redis limiter, Kafka sink, KMS keys, JWT auth) are
external adapters: opt in via config, validated HERE at startup — an
unknown backend fails the process instead of silently degrading to a
local default, which would be a security lie.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from app.config import BayoraConfig, ConfigError
from app.infra.local import (
    DiskKeyProvider,
    JsonlLedgerSink,
    LocalTokenBucket,
    TrustedLoopbackAuth,
)
from app.infra.seams import AuthPolicy, KeyProvider, LedgerSink, RateLimiter

_REGISTERED = {
    "rate_limiter": {"in-memory-token-bucket"},
    "ledger_sink": {"jsonl-fsync"},
    "key_provider": {"disk-pem"},
    "auth_policy": {"trusted-loopback"},
}


def _require_known(kind: str, backend: str) -> None:
    if backend not in _REGISTERED[kind]:
        raise ConfigError(
            f"infra.{kind}: unknown backend {backend!r} — refusing to "
            f"start. Available: {sorted(_REGISTERED[kind])}. Ship the "
            "adapter in this build or pick a listed backend.")


def build_rate_limiter(cfg: BayoraConfig) -> RateLimiter:
    name = cfg.infra.rate_limiter
    _require_known("rate_limiter", name)
    return LocalTokenBucket(cfg.broker.rate_limit_per_minute)


def build_ledger_sink(cfg: BayoraConfig, path: Path) -> LedgerSink:
    name = cfg.infra.ledger_sink
    _require_known("ledger_sink", name)
    return JsonlLedgerSink(path)


def build_key_provider(cfg: BayoraConfig) -> KeyProvider:
    name = cfg.infra.key_provider
    _require_known("key_provider", name)
    priv = cfg.report.key_dir / "demo_signing_key.pem"
    pub = cfg.report.key_dir / "demo_public_key.pem"
    if not priv.is_file() or not pub.is_file():
        raise ConfigError(
            f"key_provider=disk-pem: missing {priv} / {pub} — run "
            "scripts/gen_keys.py first")
    return DiskKeyProvider("local-demo-key", priv, pub)


def build_auth_policy(cfg: BayoraConfig) -> AuthPolicy:
    name = cfg.infra.auth_policy
    _require_known("auth_policy", name)
    # Fail closed the moment a deployment leaves loopback without real auth
    # (threat-model L7): trusted-loopback is only valid for loopback binds.
    bind = cfg.broker.bind_host
    if name == "trusted-loopback" and bind not in ("127.0.0.1", "::1", "localhost"):
        raise ConfigError(
            f"auth_policy=trusted-loopback refuses bind_host={bind!r}: "
            "install an mTLS/API-key/JWT provider before exposing the "
            "broker beyond loopback (threat-model L7).")
    return TrustedLoopbackAuth()
