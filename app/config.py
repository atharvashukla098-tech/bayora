"""Typed, validated-at-startup configuration (blueprint §4.4).

Every security-sensitive setting is explicit; validation fails closed via
``ConfigError`` listing every invalid key. ``load_config`` reads YAML when
present, falls back to ``config/config.example.yaml``, then to defaults.
``target_mode=local_model`` refuses to start unless BAYORA_LOCAL_MODEL_READY=1
(the adapter is a deliberate stub — never a silent model download).
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Literal, Optional

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError

import app


class ConfigError(Exception):
    """Raised when configuration is invalid — startup fails closed."""


class BrokerSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    allow_destinations: list[str] = Field(
        default_factory=lambda: ["http://target:8000"])   # explicit allowlist, never user-supplied
    bind_host: str = "127.0.0.1"   # loopback default; non-loopback fails closed without real auth
    max_request_bytes: int = Field(8_192, ge=256, le=1_048_576)
    max_concurrent: int = Field(4, ge=1, le=64)
    timeout_seconds: float = Field(5.0, gt=0, le=60)
    rate_limit_per_minute: int = Field(120, ge=1, le=10_000)     # v1.3 (D27)
    max_error_events_per_run: int = Field(500, ge=1)             # v1.3 (D27)
    rejection_summary_window_s: float = Field(60.0, gt=0)        # v1.3 (D27)
    block_on_injection: bool = False      # D6: default DETECT+forward; SC-02 requires False


class CanarySettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = True
    prefix: str = "BAYORA-CANARY"
    unique_per_run: bool = True


class InjectionSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = True
    patterns: list[str] = Field(default_factory=lambda: [
        "inj-1:" + r"(?i)ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts?|rules?)",
        "inj-2:" + r"(?i)disregard\s+(the\s+)?(system|safety)\s+(prompt|instructions)",
        "inj-3:" + r"(?i)(?:reveal|disclose|leak|exfiltrate|show|print|give|repeat)[\s\S]{0,40}"
                   r"\b(?:secret|api[\s_-]?key|token|canary|system\s+prompt)\b",
        "inj-4:" + r"(?i)you\s+are\s+now\s+(in\s+)?(developer|debug|dan)\s+mode",
        "inj-5:" + r"(?i)print\s+the\s+(secret|canary)",
    ])


class FsWriteSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = True
    # SIMULATION MARKERS (D18): fs-1 matches the mock's *reported* simulated
    # protected-path write; fs-2 matches protected-style paths in released text.
    # NOT a filesystem monitor — the real FS control is the Docker-gated
    # EROFS test (blueprint §14.5).
    patterns: list[str] = Field(default_factory=lambda: [
        "fs-1:" + r"(?i)write\s+attempted\s+against\s+protected\s+path",
        "fs-2:" + r"(?i)(?:/etc/|/root/|/proc/|/sys/|c:\\windows\\)[\w.\-]*",
    ])


class LedgerSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    runs_dir: Path = Path("runs")
    checkpoint_every: int = Field(10, ge=1)
    sign_checkpoints: bool = True      # SC-05b/SC-07 hard precondition; False => SKIPPED


class ReportSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    signing_enabled: bool = True
    key_dir: Path = Path("keys")


class DockerSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    required_for_runtime_tests: bool = True   # gates tests/runtime


class InfraSettings(BaseModel):
    """Pluggable backend selection (production-hardening pass).

    Shipped defaults are the local, offline-first adapters. Every name is
    validated at startup (fail-closed) — unknown backends refuse to start
    rather than silently degrading. Cloud adapters (Redis limiter, Kafka
    sink, KMS keys, JWT auth) are external opt-ins.
    """
    model_config = ConfigDict(extra="forbid")
    rate_limiter: Literal["in-memory-token-bucket"] = "in-memory-token-bucket"
    ledger_sink: Literal["jsonl-fsync"] = "jsonl-fsync"
    key_provider: Literal["disk-pem"] = "disk-pem"
    auth_policy: Literal["trusted-loopback", "api-key"] = "trusted-loopback"


class BayoraConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_mode: Literal["deterministic_mock", "local_model"] = "deterministic_mock"
    broker: BrokerSettings = Field(default_factory=lambda: BrokerSettings())
    canary: CanarySettings = Field(default_factory=lambda: CanarySettings())
    injection: InjectionSettings = Field(default_factory=lambda: InjectionSettings())
    fs_write: FsWriteSettings = Field(default_factory=lambda: FsWriteSettings())
    ledger: LedgerSettings = Field(default_factory=lambda: LedgerSettings())
    report: ReportSettings = Field(default_factory=lambda: ReportSettings())
    docker: DockerSettings = Field(default_factory=lambda: DockerSettings())
    infra: InfraSettings = Field(default_factory=lambda: InfraSettings())

    def config_digest(self) -> str:
        """sha256 of the canonical JSON dump — recorded in RUN_STARTED detail."""
        payload = self.model_dump(mode="json", exclude_defaults=False)
        import json
        return hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()[:16]


def load_config(path: Optional[Path] = None) -> BayoraConfig:
    """Load YAML config with fail-closed validation (spec §11).

    ``BAYORA_RUNS_DIR`` (test/isolation override) redirects the runs dir away
    from the repo tree — every subprocess-based integration test sets it so
    run artifacts land in pytest's tmp_path, never in the shipped tree.
    """
    candidates: list[Path] = []
    if path is not None:
        candidates.append(Path(path))
    else:
        candidates.append(Path("config/config.yaml"))
        candidates.append(Path("config/config.example.yaml"))

    data: dict = {}
    loaded_from: Optional[Path] = None
    for candidate in candidates:
        if candidate.is_file():
            try:
                with candidate.open("r", encoding="utf-8") as fh:
                    data = yaml.safe_load(fh) or {}
            except yaml.YAMLError as exc:
                raise ConfigError(f"invalid YAML in {candidate}: {exc}") from exc
            loaded_from = candidate
            break

    runs_dir_override = os.environ.get("BAYORA_RUNS_DIR")
    if runs_dir_override:
        data = dict(data)
        ledger = dict(data.get("ledger") or {})
        ledger["runs_dir"] = runs_dir_override
        data["ledger"] = ledger

    try:
        cfg = BayoraConfig.model_validate(data)
    except ValidationError as exc:
        details = "; ".join(
            f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors())
        raise ConfigError(f"invalid configuration in {loaded_from or 'defaults'}: {details}") from exc

    if cfg.target_mode == "local_model":
        if os.environ.get("BAYORA_LOCAL_MODEL_READY") != "1":
            raise ConfigError(
                "target_mode=local_model requires BAYORA_LOCAL_MODEL_READY=1 and an "
                "installed model; the adapter is a deliberate stub (never downloads)")
    cfg._loaded_from = loaded_from  # type: ignore[attr-defined]
    return cfg


def validate_startup(cfg: BayoraConfig) -> str:
    """One-line startup trace used by demo.sh (blueprint §4.4).

    Fails closed on invalid infra selections (unknown backend names,
    trusted-loopback auth on a non-loopback bind) via the build_* factory
    functions — an unvetted deployment shape cannot boot silently.
    """
    from app.infra.wire import (  # fail-closed validation happens here
        build_auth_policy, build_key_provider, build_rate_limiter)
    limiter = build_rate_limiter(cfg)    # unknown backend -> ConfigError
    build_key_provider(cfg)              # missing keys    -> ConfigError
    auth = build_auth_policy(cfg)        # non-loopback w/o real auth -> ConfigError
    src = getattr(cfg, "_loaded_from", None) or "defaults"
    return (f"config loaded: {src}, mode={cfg.target_mode}, "
            f"destinations={len(cfg.broker.allow_destinations)}, "
            f"block_on_injection={cfg.broker.block_on_injection}, "
            f"rate={cfg.broker.rate_limit_per_minute}/min "
            f"[{limiter.backend}; synchronized={limiter.synchronized}], "
            f"auth={auth.backend}")
