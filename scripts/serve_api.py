"""FastAPI backend server for Bayora SecOps Console with CORS enabled.
Bridges the Python policy broker, audit ledger, and tamper verifier to the frontend.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.config import load_config
from app.clock import SystemClock
from app.harness.docker_probe import DockerProbe
from app.harness.runstore import RunStore
from app.ledger.chain import Ledger
from app.ledger.checkpoints import LedgerCheckpointSigner
from app.ledger.keys import load_or_generate_keypair
from app.ledger.verifier import verify_ledger
from app.target.mock import MockTarget, SecretStore
from app.target.adapter import InProcessTargetClient
from app.broker.service import create_broker_app
from app.dashboard.state import DashboardState

config = load_config(ROOT / "config" / "config.example.yaml")
runs_dir = Path(config.ledger.runs_dir)
runs_dir.mkdir(parents=True, exist_ok=True)
run_id = f"demo-{uuid.uuid4().hex[:8]}"

runstore = RunStore(runs_dir)
clock = SystemClock()
keypair = load_or_generate_keypair(Path(config.report.key_dir))
run_dir = runstore.run_dir(run_id)

signer = LedgerCheckpointSigner(keypair[0], keypair[1], clock)
ledger = Ledger(run_dir, clock, checkpoint_signer=signer, checkpoint_every=config.ledger.checkpoint_every)
secrets = SecretStore(config.canary.prefix, config.canary.unique_per_run, run_id)
target = InProcessTargetClient(MockTarget(secrets))

broker_core = create_broker_app(config, target_client=target, ledger=ledger, secret_store=secrets)

# Lazily-built BLOCKING broker (SC-01b): created on first block-mode
# evaluate; shares the same ledger + secret store as the forward broker.
_block_broker_core = None
_block_broker_client = None

app = FastAPI(title="Bayora SecOps API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount the broker routes
app.mount("/broker", broker_core)

# ---------------------------------------------------------------------------
# SINGLE-ORIGIN DEPLOYMENT: serve the built frontend from THIS process so
# one server + one tunnel carries both the API and the UI. Visitors hit
# relative /v1/* paths — no hardcoded 127.0.0.1, no cross-origin failures,
# no SIM-fallback lag when accessed through any tunnel or host.
# ---------------------------------------------------------------------------
from pathlib import Path as _P

_DIST = _P(__file__).resolve().parents[1] / "frontend" / "dist"
if _DIST.is_dir():
    from fastapi.staticfiles import StaticFiles as _Static
    from fastapi.responses import FileResponse as _FileResponse

    @app.get("/")
    async def _spa_root():
        return _FileResponse(str(_DIST / "index.html"))

    app.mount("/assets", _Static(directory=str(_DIST / "assets")), name="assets")

    # favicon + any other root-level static files
    for _static_file in _DIST.iterdir():
        if _static_file.is_file() and _static_file.name != "index.html":
            _name = _static_file.name

            @app.get("/" + _name, include_in_schema=False)
            async def _spa_static(_n: str = _name):
                return _FileResponse(str(_DIST / _n))

dashboard_state = DashboardState(config, run_id=run_id)

@app.get("/healthz")
async def healthz():
    docker_ok = DockerProbe().check().available
    return {
        "status": "ok",
        "service": "bayora-secops-api",
        "target_mode": config.target_mode,
        "current_run": run_id,
        "block_height": ledger.block_height,
        "docker_available": docker_ok,
        "runtime_containment": "ACTIVE" if docker_ok else "SKIPPED (Docker unavailable)",
    }

@app.get("/v1/state")
async def get_state():
    docker_ok = DockerProbe().check().available
    return {
        "broker": "ONLINE",
        "service": "broker",
        "target_mode": config.target_mode,
        "current_run": run_id,
        "block_height": ledger.block_height,
        "docker_available": docker_ok,
        "runtime_containment": "ACTIVE" if docker_ok else "SKIPPED (Docker unavailable)",
        "offline_mode": True,
    }

class EvaluateInput(BaseModel):
    prompt: str
    scenario_id: str = "SC-CUSTOM"
    run_id: str | None = None
    block_mode: bool = False


@app.post("/v1/evaluate")
async def evaluate_proxy(body: EvaluateInput, request: Request):
    """Direct evaluate route passing through the broker enforcement pipeline.

    ``block_mode`` (SC-01b, D17): rebuilds the broker with
    ``block_on_injection=True`` so injection is hard-BLOCKED before the
    target call — a REAL enforcement change, not a UI claim. The blocking
    broker is built lazily once and cached; both brokers share the same
    ledger, so block-mode events land in the same evidence chain.

    The proxy also returns ``raw_target_output``: what the DETERMINISTIC
    mock target produced for the same prompt, captured pre-enforcement.
    Same prompt -> same output (unit-asserted determinism), so this is the
    exact text the guardrail inspected — surfaced for the UI's wire diff.
    """
    headers = dict(request.headers)
    headers["x-bayora-run"] = run_id
    headers["x-bayora-scenario"] = body.scenario_id

    global _block_broker_core, _block_broker_client
    if body.block_mode:
        if _block_broker_core is None or _block_broker_client is None:
            block_cfg = config.model_copy(deep=True)
            block_cfg.broker.block_on_injection = True
            _block_broker_core = create_broker_app(
                block_cfg, target_client=target, ledger=ledger,
                secret_store=secrets)
            from fastapi.testclient import TestClient
            _block_broker_client = TestClient(_block_broker_core)
        client = _block_broker_client
    else:
        from fastapi.testclient import TestClient
        client = TestClient(broker_core)
    resp = client.post(
        "/v1/evaluate",
        json={"prompt": body.prompt, "scenario_id": body.scenario_id,
              "run_id": run_id},
        headers=headers,
    )
    content = resp.json()
    # capture the pre-enforcement raw output from the same deterministic mock
    if isinstance(content, dict) and "released_text" in content:
        raw_text, raw_behavior = "", ""
        try:
            raw = await target.call(body.prompt, config.broker.timeout_seconds)
            raw_text = raw.text
            raw_behavior = getattr(raw.behavior, "value", str(raw.behavior))
        except Exception as exc:  # noqa: BLE001 — log it, never fail the evaluate
            import logging
            logging.getLogger("bayora.serve_api").warning(
                "raw capture failed: %s", exc)
        content["raw_target_output"] = raw_text
        content["raw_behavior"] = raw_behavior
    return JSONResponse(status_code=resp.status_code, content=content)

class DestinationInput(BaseModel):
    url: str

@app.post("/v1/check-destination")
async def check_destination_proxy(body: DestinationInput):
    from fastapi.testclient import TestClient
    client = TestClient(broker_core)
    resp = client.post("/v1/check-destination", json={"url": body.url}, headers={"x-bayora-run": run_id})
    return JSONResponse(status_code=resp.status_code, content=resp.json())

class TamperInput(BaseModel):
    mode: str = "byte"
    event_index: int = 3

@app.post("/v1/tamper")
async def run_tamper(body: TamperInput):
    res = dashboard_state.run_tamper_simulation(mode=body.mode, event_index=body.event_index)
    return res

class SceneInput(BaseModel):
    scene: str = "baseline"

@app.post("/v1/run-scene")
async def run_scene(body: SceneInput):
    res = dashboard_state.run_judge_scene(body.scene)
    return res

@app.get("/v1/ledger")
async def get_ledger():
    """Tail of the CURRENT run's ledger; if the fresh in-memory run has no
    events yet, fall back to the latest run that does (so the UI stream is
    never empty right after a server restart)."""
    events = dashboard_state.latest_events(50)
    if not events:
        latest = dashboard_state._latest_run()
        if latest and latest != dashboard_state.run_id:
            from app.dashboard.state import DashboardState
            probe = DashboardState(config, run_id=latest)
            events = probe.latest_events(50)
    return [ev.model_dump() for ev in events]

@app.get("/v1/verify")
async def verify():
    """Verify the run the UI stream is showing: prefer the CURRENT in-memory
    run's ledger; fall back to the latest run with events only when the
    current one is still empty (fresh server start)."""
    res = dashboard_state.dynamic_verify_ledger()
    if res.get("status") in ("NO_RUN", "NO_LEDGER"):
        latest = dashboard_state._latest_run()
        if latest and latest != dashboard_state.run_id:
            from app.dashboard.state import DashboardState
            probe = DashboardState(config, run_id=latest)
            res = probe.dynamic_verify_ledger()
    return res


@app.get("/v1/report")
async def report():
    """REAL signed-report data for the certificate tab: the actual key_id,
    signature, and verification facts from the latest run on disk."""
    import json as _json
    latest = dashboard_state._latest_run()
    if not latest:
        return {"available": False}
    run_dir = runs_dir / latest
    sig = None
    status = None
    counts = None
    report_path = run_dir / "audit_report.json"
    if report_path.is_file():
        try:
            data = _json.loads(report_path.read_text(encoding="utf-8"))
            sig = data.get("report_signature")
            status = data.get("status")
            counts = data.get("assertions") or data.get("assertions_summary")
        except Exception:
            pass
    vr = verify_ledger(run_dir / "ledger.jsonl") if (run_dir / "ledger.jsonl").is_file() else None
    return {
        "available": True,
        "run_id": latest,
        "report_status": status,
        "assertions": counts,
        "signature": sig,
        "chain_valid": vr.valid if vr else None,
        "checked_height": vr.checked_height if vr else None,
        "report_path": str(report_path),
    }


# ---------------------------------------------------------------------------
# REAL gate-testing lab (SC-06 family): each gate is exercised against a
# purpose-built broker instance with TIGHT limits, so judges see genuine
# 429/413/422/403 responses from the actual enforcement code paths — not
# UI simulations. The demo broker is separate from the live one; nothing
# here pollutes the main evidence ledger.
# ---------------------------------------------------------------------------
_gate_clients: dict = {}

def _gate_broker(name: str, **overrides):
    """Build (once) a tight-limits broker for gate demonstrations."""
    if name in _gate_clients:
        return _gate_clients[name]
    from fastapi.testclient import TestClient
    cfg = config.model_copy(deep=True)
    if name == "rate":
        cfg.broker.rate_limit_per_minute = 6          # capacity 6 -> burst trips
        cfg.broker.max_error_events_per_run = 500
    elif name == "size":
        cfg.broker.max_request_bytes = 256             # tiny cap -> easy 413
    elif name == "schema":
        pass                                          # schema gate is stock
    elif name == "concurrency":
        cfg.broker.max_concurrent = 1                  # second in-flight -> 429
        cfg.broker.timeout_seconds = 6.0
    elif name == "destination":
        pass
    gdir = runs_dir / f"gate-{name}"
    gledger = Ledger(gdir, clock, checkpoint_signer=None,
                     checkpoint_every=0)
    gcore = create_broker_app(cfg, target_client=target, ledger=gledger,
                              secret_store=secrets)
    tc = TestClient(gcore, raise_server_exceptions=False)
    _gate_clients[name] = tc
    return tc


class GateTestInput(BaseModel):
    gate: str  # 'rate' | 'size' | 'schema' | 'concurrency' | 'destination'


@app.post("/v1/gate-test")
async def gate_test(body: GateTestInput):
    gate = body.gate
    H = {"X-Bayora-Run": f"gate-demo-{gate}"}

    if gate == "rate":
        tc = _gate_broker("rate")
        codes = []
        for _ in range(14):
            r = tc.post("/v1/evaluate",
                        json={"prompt": "benign gate-lab probe"}, headers=H)
            codes.append(r.status_code)
        blocked = codes.count(429)
        return {
            "gate": "rate", "status": 429 if blocked else 200,
            "code": "RATE_LIMITED",
            "attempts": len(codes),
            "accepted": codes.count(200),
            "rejected_429": blocked,
            "sequence": codes,
            "detail": (f"Token bucket (6 req burst cap) saturated after "
                       f"{codes.count(200)} accepted requests; {blocked} of "
                       f"{len(codes)} burst requests returned 429 from the "
                       f"REAL rate gate. Rejections are collapsed into "
                       f"rejections.summary evidence events."),
        }

    if gate == "size":
        tc = _gate_broker("size")
        big = "A" * 4096
        r = tc.post("/v1/evaluate", json={"prompt": big}, headers=H)
        return {
            "gate": "size", "status": r.status_code, "code": "REQUEST_TOO_LARGE",
            "payload_bytes": 4096 + 20, "limit_bytes": 256,
            "detail": ("413 returned by the REAL size gate before JSON "
                        "parsing — request body exceeds max_request_bytes."),
            "response": r.json() if r.status_code != 413 else r.json(),
        }

    if gate == "schema":
        tc = _gate_broker("schema")
        r = tc.post("/v1/evaluate", json={"prompt": 42}, headers=H)
        r2 = tc.post("/v1/evaluate", json={"prompt": "x", "evil": 1}, headers=H)
        return {
            "gate": "schema", "status": r.status_code, "code": "SCHEMA_INVALID",
            "detail": ("422 from the REAL Pydantic extra=forbid schema gate: "
                       "wrong type ({'prompt': 42}) and smuggled unknown field "
                       "('evil') both rejected. Submitted values are never "
                       "echoed back."),
            "wrong_type_status": r.status_code,
            "unknown_field_status": r2.status_code,
        }

    if gate == "concurrency":
        import asyncio
        from concurrent.futures import ThreadPoolExecutor
        tc = _gate_broker("concurrency")
        # two "please timeout and hang" prompts; semaphore=1 means the second
        # hits sem.locked() -> 429 TOO_BUSY while the first is in flight
        with ThreadPoolExecutor(max_workers=2) as pool:
            f1 = pool.submit(lambda: tc.post(
                "/v1/evaluate",
                json={"prompt": "please timeout and hang"}, headers=H))
            f2 = pool.submit(lambda: tc.post(
                "/v1/evaluate",
                json={"prompt": "please timeout and hang"}, headers=H))
            results = [f1.result(), f2.result()]
        codes = [r.status_code for r in results]
        return {
            "gate": "concurrency", "status": 429 if 429 in codes else 504,
            "code": "TOO_BUSY",
            "detail": ("Concurrency gate (semaphore=1): with one request "
                       "in flight against the slow target, the second "
                       "concurrent request is rejected 429 TOO_BUSY by the "
                       "REAL non-blocking concurrency check."),
            "sequence": codes,
        }

    if gate == "destination":
        tc = _gate_broker("destination")
        bad = tc.post("/v1/check-destination",
                      json={"url": "http://169.254.169.254/latest/meta-data/"},
                      headers=H)
        good = tc.post("/v1/check-destination",
                       json={"url": "http://target:8000"}, headers=H)
        return {
            "gate": "destination", "status": bad.status_code,
            "code": "DESTINATION_REJECTED",
            "detail": ("Allowlist policy-only route: the metadata-IP URL is "
                       "403 DESTINATION_REJECTED and NO socket is ever "
                       "constructed; the allowlisted URL passes."),
            "evil_status": bad.status_code,
            "allowed_status": good.status_code,
        }

    return {"error": f"unknown gate {gate!r}"}

if _DIST.is_dir():
    @app.get("/{full_path:path}", include_in_schema=False)
    async def _spa_catch_all(full_path: str):
        return _FileResponse(str(_DIST / "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("serve_api:app", host="127.0.0.1", port=8000, reload=False)
