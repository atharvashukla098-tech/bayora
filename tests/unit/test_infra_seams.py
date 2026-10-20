"""Production-hardening seams: pluggable infra backends (review pass).

Covers the four review findings:
1. Rate limiting is process-local by default — surfaced honestly, and the
   seam accepts a synchronized (Redis/Lua) adapter without broker changes.
2. Ledger writes go through a LedgerSink — JSONL+fsync default, cloud
   append-only adapters pluggable; verifier contract unchanged.
3. Keys load via a KeyProvider — disk PEM default, KMS/HSM pluggable.
4. trusted-loopback auth REFUSES non-loopback binds (fail closed, L7).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.config import BayoraConfig, BrokerSettings, ConfigError, load_config
from app.infra.local import (
    DiskKeyProvider,
    JsonlLedgerSink,
    LocalTokenBucket,
    TrustedLoopbackAuth,
)
from app.infra.seams import AuthPolicy, KeyProvider, LedgerSink, RateLimiter
from app.infra.wire import (
    build_auth_policy,
    build_key_provider,
    build_ledger_sink,
    build_rate_limiter,
)


# -- 1) rate limiter seam -------------------------------------------------

def test_local_token_bucket_reports_itself_as_process_local():
    lim = LocalTokenBucket(rate_per_minute=10)
    assert isinstance(lim, RateLimiter)
    assert lim.synchronized is False
    assert "per-process" in lim.backend


def test_token_bucket_admits_and_exhausts(tmp_path):
    lim = LocalTokenBucket(rate_per_minute=1)
    assert lim.try_acquire("client-a")
    # 1/min => next token not yet available
    assert not lim.try_acquire("client-a")


def test_wire_rejects_unknown_rate_backend(tmp_path):
    import yaml
    cfg_path = tmp_cfg(tmp_path, {"infra": {"rate_limiter": "redis-lua"}})
    # Fail-closed happens at BOTH layers: pydantic schema rejects the
    # unknown name at validation (fail closed), and wire.build_* would
    # refuse it too. The process never boots with an unvetted backend.
    with pytest.raises(ConfigError) as ei:
        load_config(cfg_path)
    assert "infra.rate_limiter" in str(ei.value)


def test_wire_registry_refuses_unregistered_backend():
    from app.infra import wire
    with pytest.raises(ConfigError):
        wire._require_known("rate_limiter", "redis-lua")


# -- 2) ledger sink seam --------------------------------------------------

def test_jsonl_sink_is_a_ledger_sink_and_roundtrips(tmp_path):
    sink = JsonlLedgerSink(tmp_path / "l.jsonl")
    assert isinstance(sink, LedgerSink)
    sink.append_line('{"a": 1}\n')
    sink.append_line('{"a": 2}\n')
    lines = sink.read_lines()
    assert lines == ['{"a": 1}', '{"a": 2}']


def test_ledger_uses_sink_and_reports_backend(tmp_path):
    from app.clock import SystemClock
    from app.ledger.chain import Ledger
    led = Ledger(tmp_path, SystemClock())
    assert "jsonl+fsync" in led.sink_backend
    led.append(__import__("app.schema", fromlist=["EventType"]).EventType.RUN_STARTED,
               __import__("app.schema", fromlist=["Component"]).Component.HARNESS)
    assert len(led.read_all()) == 1


def test_wire_builds_ledger_sink(tmp_path):
    cfg = load_config()
    sink = build_ledger_sink(cfg, tmp_path / "x.jsonl")
    assert isinstance(sink, LedgerSink)
    assert sink.backend.startswith("jsonl")


# -- 3) key provider seam -------------------------------------------------

def test_disk_key_provider_signs_and_exports_public(tmp_path, demo_keys):
    key_dir = demo_keys(tmp_path)
    prov = DiskKeyProvider("local-demo-key",
                           key_dir / "demo_signing_key.pem",
                           key_dir / "demo_public_key.pem")
    assert isinstance(prov, KeyProvider)
    sig = prov.sign(b"canonical bytes")
    assert sig and len(sig) == 64          # Ed25519 raw signature size
    assert b"BEGIN PUBLIC KEY" in prov.public_bytes()


def test_wire_fails_closed_when_keys_missing(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    cfg = load_config()
    with pytest.raises(ConfigError):
        build_key_provider(cfg)


# -- 4) auth seam: fail closed beyond loopback -----------------------------

def test_trusted_loopback_admits_local_principal():
    auth = TrustedLoopbackAuth()
    assert isinstance(auth, AuthPolicy)
    assert auth.authenticate(None) == "local-trusted"
    assert auth.authorize("local-trusted", "evaluate")


def test_wire_refuses_trusted_loopback_on_non_loopback_bind(tmp_path):
    cfg = load_config(tmp_cfg(tmp_path, {"broker": {"bind_host": "0.0.0.0"}}))
    with pytest.raises(ConfigError) as ei:
        build_auth_policy(cfg)
    assert "L7" in str(ei.value) or "loopback" in str(ei.value)


def test_wire_allows_trusted_loopback_on_loopback_bind(tmp_path):
    cfg = load_config(tmp_cfg(tmp_path, {"broker": {"bind_host": "127.0.0.1"}}))
    auth = build_auth_policy(cfg)
    assert auth.backend.startswith("trusted-loopback")


# -- helpers ----------------------------------------------------------------

def tmp_cfg(tmp_path: Path, over: dict) -> Path:
    import yaml
    p = tmp_path / "config.yaml"
    p.write_text(yaml.safe_dump(over), encoding="utf-8")
    return p


@pytest.fixture
def demo_keys(tmp_path):
    """Generate a throwaway Ed25519 pair in tmp_path — never touch repo keys."""
    def _make(key_dir: Path | None = None):
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives import serialization
        kd = key_dir or (tmp_path / "keys")
        kd.mkdir(parents=True, exist_ok=True)
        sk = Ed25519PrivateKey.generate()
        (kd / "demo_signing_key.pem").write_bytes(sk.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption()))
        (kd / "demo_public_key.pem").write_bytes(
            sk.public_key().public_bytes(
                serialization.Encoding.PEM,
                serialization.PublicFormat.SubjectPublicKeyInfo))
        return kd
    return _make
