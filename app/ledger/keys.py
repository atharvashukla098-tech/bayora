"""Ed25519 key handling isolated in one file (blueprint D3 — swappable)."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

KEY_ID = "local-demo-key"


def load_or_generate_keypair(key_dir: Path) -> tuple[Ed25519PrivateKey, str, Ed25519PublicKey]:
    """Load or generate the dev keypair under ``key_dir`` (default keys/).

    Returns (private_key, key_id, public_key). The private PEM is chmod-600
    best-effort and .gitignore'd; the public PEM is the trusted key. A
    regenerated key invalidates old signatures — surfaced as
    CHECKPOINT_SIG_INVALID and documented as limitation L4.
    """
    key_dir = Path(key_dir)
    key_dir.mkdir(parents=True, exist_ok=True)
    priv_path = key_dir / "demo_signing_key.pem"
    pub_path = key_dir / "demo_public_key.pem"

    if priv_path.is_file():
        private_key = serialization.load_pem_private_key(priv_path.read_bytes(), password=None)
        if not isinstance(private_key, Ed25519PrivateKey):
            raise TypeError(f"{priv_path} is not an Ed25519 private key")
    else:
        private_key = Ed25519PrivateKey.generate()
        priv_path.write_bytes(private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ))
        try:
            os.chmod(priv_path, 0o600)
        except OSError:
            pass  # best-effort on Windows

    pub_bytes = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    # Write only when missing or different: the Docker broker mounts keys/
    # read-only, and an unconditional rewrite crashes startup there.
    if not pub_path.is_file() or pub_path.read_bytes() != pub_bytes:
        pub_path.write_bytes(pub_bytes)
    return private_key, KEY_ID, private_key.public_key()


def load_public_key(path: Path) -> Ed25519PublicKey:
    """Load the trusted public key from a PEM file."""
    key = serialization.load_pem_public_key(Path(path).read_bytes())
    if not isinstance(key, Ed25519PublicKey):
        raise TypeError(f"{path} is not an Ed25519 public key")
    return key


def fingerprint(public_key: Ed25519PublicKey) -> str:
    """SHA-256 of the raw public bytes, first 16 hex — displayed as key evidence."""
    raw = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return hashlib.sha256(raw).hexdigest()[:16]
