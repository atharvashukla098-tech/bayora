#!/usr/bin/env python
"""BAYORA live range server — the judge-interactive experience.

A tiny loopback FastAPI app that wraps the REAL broker (same in-process
wiring as the demo pipeline: TestClient-free, direct ASGI) and exposes
read-only verification + disposable-copy tamper demos to the 3D frontend.

Endpoints (loopback only, run offline at the venue):
  GET  /range/status        run id, ledger height, checkpoint coverage
  POST /range/fire          {prompt} -> REAL /v1/evaluate through the full
                            broker middleware stack (rate gate, size gate,
                            injection policy, canary redaction, ledger)
  POST /range/verify        run the independent verifier over the live
                            ledger from genesis
  POST /range/tamper        disposable copy of the ledger + byte-flip +
                            verify the copy (original never touched)
  GET  /range/events        last N ledger events (live ticker feed)

Nothing here trusts the frontend: the broker's own gates rate-limit and
size-limit every /range/fire, the ledger digests the prompt (never stores
it), and the tamper demo works only on a disposable copy. The original
evidence ledger is byte-identical before and after (asserted in tests).
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(ROOT))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.config import load_config
from app.clock import SystemClock
from app.harness.adversary import disposable_copy, flip_one_byte
from app.ledger.chain import Ledger
from app.ledger.checkpoints import LedgerCheckpointSigner
from app.ledger.keys import load_or_generate_keypair
from app.ledger.verifier import verify_ledger
from app.schema import prompt_digest
from app.target.adapter import InProcessTargetClient
from app.target.mock import MockTarget, SecretStore
from app.broker.service import create_broker_app


RUN_ID = "live-" + SystemClock().now_utc().strftime("%Y%m%d-%H%M%S")


def build_stack():
    config = load_config(ROOT / "config" / "config.example.yaml")
    clock = SystemClock()
    keypair = load_or_generate_keypair(Path(config.report.key_dir))
    run_dir = Path(config.ledger.runs_dir) / RUN_ID
    ledger = Ledger(
        run_dir, clock,
        checkpoint_signer=LedgerCheckpointSigner(keypair[0], keypair[1], clock),
        checkpoint_every=config.ledger.checkpoint_every,
    )
    secrets = SecretStore(config.canary.prefix, config.canary.unique_per_run, RUN_ID)
    target = InProcessTargetClient(MockTarget(secrets))
    broker_app = create_broker_app(config, target_client=target,
                                   ledger=ledger, secret_store=secrets)
    return config, ledger, keypair, broker_app


CFG, LEDGER, KEYS, BROKER = build_stack()

# The judge's prompt crosses the REAL broker ASGI app — full middleware
# stack (rate gate, size gate, schema gate, policy, guardrail) — not a copy.
from fastapi.testclient import TestClient
_broker_tc = TestClient(BROKER, raise_server_exceptions=False)


class FireRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)


class TamperRequest(BaseModel):
    event_index: int = Field(default=3, ge=1)


range_app = FastAPI(title="BAYORA Live Range", version="1.0.0")
# The range UI (http://127.0.0.1:8477) and this server (8478) are different
# origins; loopback CORS for exactly these two routes.
range_app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:8477", "http://localhost:8477"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@range_app.get("/range/status")
async def range_status():
    head = LEDGER.head()
    return {
        "run_id": RUN_ID,
        "height": LEDGER.block_height,
        "head_hash": head.hash if head else None,
        "checkpoint_every": CFG.ledger.checkpoint_every,
        "canary_id": BROKER.state.secret_store.canary_id,
    }


@range_app.post("/range/fire")
async def range_fire(req: FireRequest):
    """Judge's prompt -> REAL broker evaluate. Response mirrors the broker's
    exact contract (status code, outcome, policy decision, events)."""
    r = _broker_tc.post("/v1/evaluate", json={"prompt": req.prompt},
                        headers={"X-Bayora-Run": RUN_ID})
    try:
        body = r.json()
    except Exception:
        body = {"detail": r.text}
    return {
        "status_code": r.status_code,
        "prompt_digest": prompt_digest(req.prompt),
        **body,
    }


@range_app.post("/range/verify")
async def range_verify():
    """Independent verifier over the LIVE ledger, from genesis."""
    vr = verify_ledger(LEDGER.path)
    return {
        "valid": vr.valid,
        "checked_height": vr.checked_height,
        "findings": [f.value for f in vr.findings],
        "earliest_failure_seq": vr.earliest_failure_seq,
        "run_id": RUN_ID,
    }


@range_app.post("/range/tamper")
async def range_tamper(req: TamperRequest):
    """Disposable-copy byte-flip: the chain collapse, live-computed."""
    original = LEDGER.path
    pre = verify_ledger(original)
    if not pre.valid:
        return {"error": "refusing to demo: live ledger is not valid"}
    tmp = Path(tempfile.mkdtemp(prefix="bayora-range-tamper-"))
    copy = disposable_copy(original, tmp)
    info = flip_one_byte(copy, req.event_index)
    post = verify_ledger(copy)
    return {
        "mode": "byte",
        "event_index": info.event_index,
        "expected_hash": info.expected_hash,
        "computed_hash": info.computed_hash,
        "tampered_valid": post.valid,
        "findings": [f.value for f in post.findings],
        "earliest_failure_seq": post.earliest_failure_seq,
        "original_valid": verify_ledger(original).valid,
    }


@range_app.get("/range/events")
async def range_events(limit: int = 12):
    """Last N events, oldest-first, for the live ticker."""
    events = LEDGER.read_all()
    tail = events[-limit:]
    return [
        {
            "seq": e.seq,
            "event_type": e.event_type.value,
            "component": e.component.value,
            "outcome": e.outcome.value if e.outcome else None,
            "hash": e.hash[:16],
            "detail_keys": sorted((e.detail or {}).keys()),
        }
        for e in tail
    ]
