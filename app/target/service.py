"""Target service (Docker mode): POST /v1/respond + GET /healthz (D19).

Runs only inside the container; no auth because the Docker network is
``internal: true`` — a deliberate, documented trust boundary.
"""

from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field

from app.target.mock import MockTarget, SecretStore


class RespondRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: str = Field(min_length=1, max_length=8000)


def create_target_app(secret_store: SecretStore) -> FastAPI:
    app = FastAPI(title="Bayora Mock Target", version="1.0.0")
    mock = MockTarget(secret_store)

    @app.get("/healthz")
    async def healthz():
        return {"status": "ok", "service": "target", "mode": "deterministic_mock"}

    @app.post("/v1/respond")
    async def respond(req: RespondRequest) -> dict:
        resp = mock.respond(req.prompt)
        return {"text": resp.text, "behavior": resp.behavior.value,
                "latency_ms": resp.latency_ms}

    return app


def create_app() -> FastAPI:
    """Zero-arg ASGI factory for Docker mode (compose runs
    ``uvicorn app.target.service:create_app --factory``).

    The mock canary store is deterministic per container; the canary VALUE is
    only ever handed to the broker over the internal network, and the broker
    re-scans released text against its OWN store, so cross-container exact
    values are only exercised in-process (documented limitation).
    """
    return create_target_app(SecretStore("BAYORA-CANARY", True, "target-container"))
