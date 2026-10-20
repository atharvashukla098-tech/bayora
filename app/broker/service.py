"""FastAPI policy broker — the enforcement pipeline (blueprint §7.4).

Pipeline order (D17/D27: enforcement BEFORE release; blocking BEFORE target):

  0. rate gate (middleware, returns 429 — never raises; D27)
  1. size gate (middleware Content-Length check, returns 413 — never raises; D21)
  2. schema gate (manual EvaluateRequest.model_validate -> 422 no-echo handler;
     parse happens AFTER the in-handler size gate so a chunked oversized body
     is 413, never misreported as a schema fault)
  3. ingress event (prompt_digest only, D13)
  4. concurrency gate (non-blocking check + acquire; 429 TOO_BUSY)
  5. request policy (injection: BLOCK in block mode, else ALLOW+DETECTED) —
     strictly BEFORE the target call (D17)
  6. target call — asyncio.wait_for over a genuine awaitable (D22)
  7. response policy (canary REDACT + re-scan of the ACTUAL released text,
     spec §3.4; fs-write DETECT, D18; size BLOCK)
  8. RESPONSE_RELEASED event + the single authoritative outcome (§7.4.1, D11)
  9. INCIDENT_RAISED when outcome in {DETECTED, BLOCKED, REDACTED, ERROR}

Middleware scope rule (D21): Starlette's ExceptionMiddleware wraps only the
router, so the rate/size gates RETURN their BrokerErrorBody themselves; the
OversizeError handler exists solely for the in-handler double gate, whose
raise happens in router scope.

Error contract (D13): every non-2xx body is exactly
{"error": <code>, "outcome": <outcome>, "detail": <static>, "run_id": <str|null>}
— no stack traces, no echo of submitted values, no canary. Untrusted input
reaches the ledger only as sha256[:16] digests.

Note: the response-side size-block path (guardrail MAX_RELEASED_TEXT_CHARS)
is unreachable with the deterministic mock (its outputs are tiny); it exists
for real-model extension and returns 403 with outcome BLOCKED.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.broker.errors import BrokerErrorCode, STATIC_MESSAGES, as_broker_error
from app.broker.models import (
    BrokerErrorBody,
    CheckDestinationRequest,
    EvaluateRequest,
    EvaluateResponse,
    PolicyDecision,
)
from app.broker.ratelimit import RejectionBuffer, TokenBucket
from app.config import BayoraConfig
from app.clock import monotonic_seconds
from app.guardrails.policy import PolicyRules, resolve_outcome
from app.infra.seams import AuthPolicy
from app.ledger.chain import Ledger
from app.schema import Component, EventType, Outcome, prompt_digest
from app.target.adapter import (
    DestinationRejected,
    TargetClient,
    TargetError,
    TargetTimeout,
    destination_allowed,
)
from app.target.mock import SecretStore
from app.guardrails.redaction import verify_redaction

logger = logging.getLogger("bayora.broker")


class OversizeError(Exception):
    """Raised ONLY by the in-handler double gate (router scope, D21)."""


class BusyError(Exception):
    """Concurrency limit exceeded (429 TOO_BUSY)."""


def _error_body(code: BrokerErrorCode, outcome: Outcome,
                run_id: Optional[str]) -> dict:
    return BrokerErrorBody(
        error=code.value, outcome=outcome,
        detail=STATIC_MESSAGES[code], run_id=run_id,
    ).model_dump()


def create_broker_app(config: BayoraConfig, *, target_client: TargetClient,
                      ledger: Ledger, secret_store: SecretStore,
                      semaphore: Optional[asyncio.Semaphore] = None,
                      auth_policy: Optional["AuthPolicy"] = None) -> FastAPI:
    """Build the broker app: full middleware stack, routes, error handlers.

    ``auth_policy``: optional AuthPolicy seam instance. When provided,
    every evidence-writing POST requires a principal authorized for
    ``evaluate`` (401 without a token, 403 with a wrong role/key) and
    /healthz stays public. Default (None) = the loopback demo mode where
    the deployment contract is the trusted-loopback L7 scope.
    """
    app = FastAPI(title="Bayora Policy Broker", version="1.0.0")
    rules = PolicyRules(config)
    token_bucket = TokenBucket(config.broker.rate_limit_per_minute,
                               now_fn=monotonic_seconds)
    rejection_buffer = RejectionBuffer(
        max_error_events=config.broker.max_error_events_per_run,
        window_seconds=config.broker.rejection_summary_window_s,
        now_fn=monotonic_seconds)
    sem: asyncio.Semaphore = semaphore or asyncio.Semaphore(config.broker.max_concurrent)
    current_run: dict = {"run_id": None}
    auth = auth_policy
    from app.broker.security_headers import SecurityHeadersMiddleware
    app.add_middleware(SecurityHeadersMiddleware)

    # ------------------------------------------------------------ middleware

    @app.middleware("http")
    async def rate_and_size_gates(request: Request, call_next):
        run_id = request.headers.get("X-Bayora-Run")
        client_key = request.client.host if request.client else "unknown"

        # AuthN/AuthZ gate (review: "protect admin routes / add proper
        # authentication"). When an AuthPolicy is installed, every
        # evidence-writing POST must carry a token whose principal is
        # authorized for 'evaluate'. 401 (no/unknown token) / 403
        # (authenticated, wrong role) — BEFORE any target work. /healthz
        # stays public for orchestration probes.
        if (auth is not None and request.method == "POST"
                and request.url.path in ("/v1/evaluate", "/v1/check-destination")):
            token = request.headers.get("Authorization", "")
            if token.startswith("Bearer "):
                token = token[len("Bearer "):]
            principal = auth.authenticate(token or None)
            if principal is None:
                return JSONResponse(status_code=401, content=_error_body(
                    BrokerErrorCode.AUTH_REQUIRED, Outcome.NOT_EVALUATED, run_id))
            if not auth.authorize(principal, "evaluate"):
                return JSONResponse(status_code=403, content=_error_body(
                    BrokerErrorCode.AUTH_FORBIDDEN, Outcome.NOT_EVALUATED, run_id))

        # Rate gate (D27) — returns, never raises (spec §3.2's 4th limit).
        # Applies to EVERY route that can write evidence (evaluate AND
        # check-destination): an uncapped flood on any route must never mean
        # one fsynced ledger event per call.
        if request.method == "POST" and request.url.path in (
                "/v1/evaluate", "/v1/check-destination"):
            if not token_bucket.try_acquire(client_key):
                rejection_buffer.record("rate", ledger=ledger, run_id=run_id)
                return JSONResponse(status_code=429, content=_error_body(
                    BrokerErrorCode.RATE_LIMITED, Outcome.NOT_EVALUATED, run_id))

        # Size gate (D21) — Content-Length check; returns, never raises.
        content_length = request.headers.get("content-length")
        if content_length and content_length.isdigit() \
                and int(content_length) > config.broker.max_request_bytes:
            rejection_buffer.record("size", ledger=ledger, run_id=run_id)
            return JSONResponse(status_code=413, content=_error_body(
                BrokerErrorCode.REQUEST_TOO_LARGE, Outcome.NOT_EVALUATED, run_id))

        response = await call_next(request)

        # Per-window REJECTIONS_SUMMARY opportunistically (D27); no-op unless
        # a window has elapsed and rejections are pending.
        rejection_buffer.commit(ledger, run_id)
        return response

    # ------------------------------------------------------------ handlers

    @app.exception_handler(RequestValidationError)
    async def _schema_invalid(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Static message ONLY (D13): exc.errors() carries the submitted 'input'
        # — logged server-side (count only), never returned to the caller.
        run_id = request.headers.get("X-Bayora-Run")
        scenario_id = request.headers.get("X-Bayora-Scenario")
        logger.warning("schema_invalid run=%s field_errors=%d "
                       "(submitted values are never echoed)", run_id, len(exc.errors()))
        rejection_buffer.record("schema", ledger=ledger, run_id=run_id,
                                scenario_id=scenario_id)
        return JSONResponse(status_code=422, content=_error_body(
            BrokerErrorCode.SCHEMA_INVALID, Outcome.NOT_EVALUATED, run_id))

    @app.exception_handler(OversizeError)
    async def _oversize(request: Request, exc: OversizeError) -> JSONResponse:
        run_id = request.headers.get("X-Bayora-Run")
        scenario_id = request.headers.get("X-Bayora-Scenario")
        rejection_buffer.record("size", ledger=ledger, run_id=run_id,
                                scenario_id=scenario_id)
        return JSONResponse(status_code=413, content=_error_body(
            BrokerErrorCode.REQUEST_TOO_LARGE, Outcome.NOT_EVALUATED, run_id))

    @app.exception_handler(BusyError)
    async def _busy(request: Request, exc: BusyError) -> JSONResponse:
        run_id = request.headers.get("X-Bayora-Run")
        scenario_id = request.headers.get("X-Bayora-Scenario")
        rejection_buffer.record("busy", ledger=ledger, run_id=run_id,
                                scenario_id=scenario_id)
        return JSONResponse(status_code=429, content=_error_body(
            BrokerErrorCode.TOO_BUSY, Outcome.NOT_EVALUATED, run_id))

    @app.exception_handler(TargetTimeout)
    async def _timeout(request: Request, exc: TargetTimeout) -> JSONResponse:
        run_id = request.headers.get("X-Bayora-Run")
        return JSONResponse(status_code=504, content=_error_body(
            BrokerErrorCode.TARGET_TIMEOUT, Outcome.ERROR, run_id))

    @app.exception_handler(TargetError)
    async def _target_error(request: Request, exc: TargetError) -> JSONResponse:
        run_id = request.headers.get("X-Bayora-Run")
        return JSONResponse(status_code=502, content=_error_body(
            BrokerErrorCode.TARGET_ERROR, Outcome.ERROR, run_id))

    @app.exception_handler(Exception)
    async def _internal(request: Request, exc: Exception) -> JSONResponse:
        code, detail = as_broker_error(exc)
        run_id = request.headers.get("X-Bayora-Run")
        logger.exception("internal_error run=%s", run_id)  # trace server-side only
        return JSONResponse(status_code=500, content=BrokerErrorBody(
            error=code.value, outcome=Outcome.ERROR, detail=detail,
            run_id=run_id).model_dump())

    # ------------------------------------------------------------ routes

    @app.get("/healthz")
    async def healthz():
        return {"status": "ok", "service": "broker",
                "target_mode": config.target_mode,
                "current_run": current_run["run_id"],
                "block_height": ledger.block_height}

    @app.post("/v1/check-destination")
    async def check_destination(req: CheckDestinationRequest, request: Request):
        """Policy-only route (D20): allowlist check; a socket is never built.

        Rejections go through the RejectionBuffer (D27): individually recorded
        only while under the evidence cap, then collapsed into per-window
        REJECTIONS_SUMMARY events — the same bounded-evidence contract as
        every other rejection path.
        """
        run_id = request.headers.get("X-Bayora-Run")
        scenario_id = request.headers.get("X-Bayora-Scenario")
        url = str(req.url)
        if destination_allowed(url, config.broker.allow_destinations):
            return JSONResponse(status_code=200, content={"allowed": True, "url": url})
        rejection_buffer.record("destination", ledger=ledger, run_id=run_id,
                                scenario_id=scenario_id,
                                prompt=url)
        return JSONResponse(status_code=403, content=_error_body(
            BrokerErrorCode.DESTINATION_REJECTED, Outcome.BLOCKED, run_id))

    @app.post("/v1/evaluate")
    async def evaluate(request: Request):
        # The body is parsed manually so the in-handler size double-gate runs
        # BEFORE schema validation (a chunked oversized body must be 413, D21).
        body_bytes = await request.body()
        if len(body_bytes) > config.broker.max_request_bytes:
            raise OversizeError("chunked body exceeds the configured size cap")
        try:
            req = EvaluateRequest.model_validate_json(body_bytes)
        except ValidationError as exc:
            raise RequestValidationError(exc.errors(), body=body_bytes) from exc

        run_id = req.run_id or request.headers.get("X-Bayora-Run")
        scenario_id = req.scenario_id or request.headers.get("X-Bayora-Scenario")
        current_run["run_id"] = run_id
        prompt_dig = prompt_digest(req.prompt)
        events: list[str] = []

        # -- ingress event (digest only, D13) ------------------------------
        ev = ledger.append(EventType.REQUEST_INGRESS, Component.BROKER,
                           run_id=run_id, scenario_id=scenario_id,
                           detail={"prompt_digest": prompt_dig})
        events.append(ev.event_id)

        # -- concurrency gate (non-blocking; 429 TOO_BUSY) ------------------
        # No await sits between this check and the acquire inside the target
        # call below; asyncio is cooperative, so check-then-acquire is atomic
        # with respect to other coroutines on the loop.
        if sem.locked():
            raise BusyError("concurrency limit reached")

        # -- request policy — strictly BEFORE the target call (D17) ---------
        decision = rules.decide_request(req.prompt)
        if decision.action == "BLOCK":
            ev = ledger.append(EventType.POLICY_DECISION, Component.BROKER,
                               run_id=run_id, outcome=Outcome.BLOCKED,
                               scenario_id=scenario_id,
                               detail={"rule": decision.rule,
                                       "reason": decision.reason_code,
                                       "matched": ",".join(decision.matched_ids),
                                       "prompt_digest": prompt_dig,
                                       "status_code": "403"})
            events.append(ev.event_id)
            # Response side was never inspected — recorded, never guessed at.
            ev = ledger.append(EventType.POLICY_DECISION, Component.BROKER,
                               run_id=run_id, outcome=Outcome.NOT_EVALUATED,
                               scenario_id=scenario_id,
                               detail={"rule": decision.rule,
                                       "reason": "response_not_inspected",
                                       "matched": "", "prompt_digest": prompt_dig,
                                       "status_code": "403"})
            events.append(ev.event_id)
            return JSONResponse(status_code=403, content=_error_body(
                BrokerErrorCode.INJECTION_DETECTED, Outcome.BLOCKED, run_id))

        # -- the target call (single call, gated by wait_for, D22) -----------
        async with sem:
            try:
                mock_resp = await asyncio.wait_for(
                    target_client.call(req.prompt, config.broker.timeout_seconds),
                    timeout=config.broker.timeout_seconds)
            except (asyncio.TimeoutError, TargetTimeout):
                ledger.append(EventType.POLICY_DECISION, Component.BROKER,
                              run_id=run_id, outcome=Outcome.ERROR,
                              scenario_id=scenario_id,
                              detail={"rule": "timeout", "reason": "TARGET_TIMEOUT",
                                      "matched": "", "prompt_digest": prompt_dig,
                                      "status_code": "504"})
                ledger.append(EventType.INCIDENT_RAISED, Component.BROKER,
                               run_id=run_id, outcome=Outcome.ERROR,
                               scenario_id=scenario_id,
                               detail={"outcome": "ERROR", "reason": "TARGET_TIMEOUT",
                                       "response_digest": ""})
                return JSONResponse(status_code=504, content=_error_body(
                    BrokerErrorCode.TARGET_TIMEOUT, Outcome.ERROR, run_id))
            except (TargetError, DestinationRejected):
                ledger.append(EventType.POLICY_DECISION, Component.BROKER,
                              run_id=run_id, outcome=Outcome.ERROR,
                              scenario_id=scenario_id,
                              detail={"rule": "target", "reason": "TARGET_ERROR",
                                      "matched": "", "prompt_digest": prompt_dig,
                                      "status_code": "502"})
                ledger.append(EventType.INCIDENT_RAISED, Component.BROKER,
                               run_id=run_id, outcome=Outcome.ERROR,
                               scenario_id=scenario_id,
                               detail={"outcome": "ERROR", "reason": "TARGET_ERROR",
                                       "response_digest": ""})
                return JSONResponse(status_code=502, content=_error_body(
                    BrokerErrorCode.TARGET_ERROR, Outcome.ERROR, run_id))
            except Exception as exc:
                # Any other target fault is ALSO a target error (fail closed,
                # spec §2) — the broker never leaks the exception to callers.
                logger.exception("target_fault run=%s", run_id)
                ledger.append(EventType.POLICY_DECISION, Component.BROKER,
                              run_id=run_id, outcome=Outcome.ERROR,
                              scenario_id=scenario_id,
                              detail={"rule": "target", "reason": "TARGET_ERROR",
                                      "matched": "", "prompt_digest": prompt_dig,
                                      "status_code": "502"})
                ledger.append(EventType.INCIDENT_RAISED, Component.BROKER,
                               run_id=run_id, outcome=Outcome.ERROR,
                               scenario_id=scenario_id,
                               detail={"outcome": "ERROR", "reason": "TARGET_ERROR",
                                       "response_digest": ""})
                return JSONResponse(status_code=502, content=_error_body(
                    BrokerErrorCode.TARGET_ERROR, Outcome.ERROR, run_id))
            ev = ledger.append(EventType.TARGET_RESPONSE, Component.TARGET,
                               run_id=run_id, scenario_id=scenario_id,
                               detail={"response_digest": prompt_digest(mock_resp.text),
                                       "behavior": mock_resp.behavior.value})
            events.append(ev.event_id)
            raw_target_text = mock_resp.text

        # -- response policy (guardrail inspects BEFORE release, spec §3.2) --
        rdec = rules.decide_response(raw_target_text,
                                     canary_value=secret_store.canary_value,
                                     canary_id=secret_store.canary_id)
        released = raw_target_text
        redaction_applied = False
        redaction_ids: list[str] = []
        match_count = 0
        fs_write_detected = False
        response_action = "RELEASE"

        if rdec.action == "REDACT":
            released = rdec.redacted_text or released
            redaction_applied = True
            redaction_ids = list(rdec.redaction_ids)
            match_count = rdec.match_count
            response_action = "REDACT"
            # Re-scan the ACTUAL released text (spec §3.4): verification runs
            # against what the caller really receives, never a log line.
            if not verify_redaction(released, secret_store.canary_value,
                                    secret_store.canary_id):
                ledger.append(EventType.INCIDENT_RAISED, Component.GUARDRAIL,
                               run_id=run_id, outcome=Outcome.ERROR,
                               scenario_id=scenario_id,
                               detail={"outcome": "ERROR",
                                       "reason": "REDACTION_VERIFY_FAILED",
                                       "response_digest": prompt_digest(released)})
                return JSONResponse(status_code=500, content=_error_body(
                    BrokerErrorCode.INTERNAL, Outcome.ERROR, run_id))
        elif rdec.action == "DETECT":
            fs_write_detected = True
            response_action = "DETECT"
        elif rdec.action == "BLOCK":
            ledger.append(EventType.POLICY_DECISION, Component.BROKER,
                          run_id=run_id, outcome=Outcome.BLOCKED,
                          scenario_id=scenario_id,
                          detail={"rule": "size", "reason": "RESPONSE_TOO_LARGE",
                                  "matched": "", "prompt_digest": prompt_dig,
                                  "status_code": "403"})
            return JSONResponse(status_code=403, content=_error_body(
                BrokerErrorCode.INTERNAL, Outcome.BLOCKED, run_id))

        # -- the single authoritative outcome (precedence §7.4.1, D11) -------
        outcome = resolve_outcome(
            target_faulted=False,
            request_blocked=False,
            redaction_applied=redaction_applied,
            fs_write_detected=fs_write_detected,
            injection_detected=bool(decision.matched_ids),
            response_inspected=True)

        ev = ledger.append(EventType.RESPONSE_RELEASED, Component.BROKER,
                           run_id=run_id, scenario_id=scenario_id, outcome=outcome,
                           detail={"released_digest": prompt_digest(released),
                                   "redaction_ids": ",".join(redaction_ids),
                                   "match_count": str(match_count)})
        events.append(ev.event_id)

        # Response-side policy decision event (canary / fs_write evidence).
        if rdec.reason_code != "ALLOWED":
            ev = ledger.append(EventType.POLICY_DECISION, Component.BROKER,
                               run_id=run_id, scenario_id=scenario_id, outcome=outcome,
                               detail={"rule": rdec.rule, "reason": rdec.reason_code,
                                       "matched": ",".join(rdec.matched_ids),
                                       "response_digest": prompt_digest(released),
                                       "status_code": "200"})
            events.append(ev.event_id)

        # Request-side observation event (injection DETECTED in forward mode).
        if decision.matched_ids and decision.action == "ALLOW":
            ev = ledger.append(EventType.POLICY_DECISION, Component.BROKER,
                               run_id=run_id, scenario_id=scenario_id,
                               outcome=Outcome.DETECTED,
                               detail={"rule": "injection",
                                       "reason": decision.reason_code,
                                       "matched": ",".join(decision.matched_ids),
                                       "prompt_digest": prompt_dig,
                                       "status_code": "200"})
            events.append(ev.event_id)

        # -- INCIDENT_RAISED for every non-clean outcome (dashboard feed) ----
        if outcome in (Outcome.DETECTED, Outcome.BLOCKED, Outcome.REDACTED,
                       Outcome.ERROR):
            ev = ledger.append(EventType.INCIDENT_RAISED, Component.BROKER,
                               run_id=run_id, outcome=outcome, scenario_id=scenario_id,
                               detail={"outcome": outcome.value,
                                       "reason": (rdec.reason_code
                                                  if rdec.reason_code != "ALLOWED"
                                                  else decision.reason_code),
                                       "response_digest": prompt_digest(released)})
            events.append(ev.event_id)

        pd = PolicyDecision(
            request_rule=decision.rule,
            request_action=decision.action,
            response_action=response_action,
            matched_patterns=[*decision.matched_ids, *rdec.matched_ids],
            reason_code=(rdec.reason_code if rdec.reason_code != "ALLOWED"
                         else decision.reason_code),
        )
        return JSONResponse(status_code=200, content=EvaluateResponse(
            run_id=run_id or "", scenario_id=scenario_id,
            released_text=released, outcome=outcome,
            policy_decision=pd, events=events,
            redaction_applied=redaction_applied,
        ).model_dump())

    # Test/demo wiring surface (read-only introspection).
    app.state.token_bucket = token_bucket
    app.state.rejection_buffer = rejection_buffer
    app.state.semaphore = sem
    app.state.secret_store = secret_store
    app.state.ledger = ledger
    app.state.config = config
    return app


def create_app(config_path: Optional[Path] = None) -> FastAPI:
    """Module-level factory for Docker mode.

    Compose launches the broker with ``uvicorn app.broker.service:create_app
    --factory``; this wires the HTTP target client from config. The offline
    demo path builds apps via create_broker_app directly with the in-process
    client (D1/D23).
    """
    from app.config import load_config
    from app.clock import SystemClock
    from app.target.mock import SecretStore

    cfg = load_config(config_path)
    ledger = Ledger(Path(cfg.ledger.runs_dir) / "platform", SystemClock())
    secret_store = SecretStore(cfg.canary.prefix, cfg.canary.unique_per_run,
                                "platform")
    if cfg.target_mode == "local_model":
        from app.target.adapter import LocalModelAdapter
        target_client: TargetClient = LocalModelAdapter()  # deliberate stub
    else:
        from app.target.adapter import HttpTargetClient
        target_client = HttpTargetClient(cfg.broker.allow_destinations[0],
                                         cfg.broker.allow_destinations)
    return create_broker_app(cfg, target_client=target_client, ledger=ledger,
                             secret_store=secret_store)


app = None  # compose uses create_app --factory (import-time init would write files)
