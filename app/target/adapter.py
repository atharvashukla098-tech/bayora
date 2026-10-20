"""Async target client contract (blueprint §6.3, D22).

``TargetClient.call`` is a coroutine — this is forced, not chosen:
``asyncio.wait_for`` over a sync return value raises TypeError, and the
TIMEOUT behavior must hold the coroutine open past the deadline so the
broker's gate cancels genuinely in-flight work.

``InProcessTargetClient`` runs the sync mock via ``asyncio.to_thread`` then
awaits the mock's simulated latency. ``HttpTargetClient`` uses a shared
``httpx.AsyncClient`` (never a blocking post) and consults
``destination_allowed()`` BEFORE dialing (D17).
"""

from __future__ import annotations

import asyncio
from typing import Protocol, runtime_checkable

import httpx

from app.target.mock import MockResponse, MockTarget


class TargetTimeout(Exception):
    """The target call exceeded its deadline and was cancelled."""


class TargetError(Exception):
    """The target faulted (non-timeout). Fail closed at the broker."""


class DestinationRejected(Exception):
    """The URL is not on the explicit allowlist — never dialed (D17)."""


@runtime_checkable
class TargetClient(Protocol):
    async def call(self, prompt: str, timeout: float) -> MockResponse: ...


class InProcessTargetClient:
    """Local demo path (D1): wraps MockTarget directly, in-memory."""

    def __init__(self, mock: MockTarget):
        self._mock = mock

    @property
    def mock(self) -> MockTarget:
        return self._mock

    async def call(self, prompt: str, timeout: float) -> MockResponse:
        resp = await asyncio.to_thread(self._mock.respond, prompt)
        # Simulated latency is REAL: the TIMEOUT behavior sleeps past the
        # deadline so the broker's asyncio.wait_for gate cancels mid-flight.
        await asyncio.sleep(resp.latency_ms / 1000)
        return resp


def destination_allowed(url: str, allowlist: list[str]) -> bool:
    """Exact string membership on the explicit allowlist (SC-03 + client).

    Normalizes scheme/host/port for comparison; never a prefix or regex match.
    """
    try:
        parsed = httpx.URL(url)
    except Exception:
        return False
    for allowed in allowlist:
        try:
            a = httpx.URL(allowed)
        except Exception:
            continue
        if (parsed.scheme == a.scheme and parsed.host == a.host
                and parsed.port == a.port):
            return True
    return False


class HttpTargetClient:
    """Docker mode. Shared AsyncClient, per-call timeout, allowlist-before-dial."""

    def __init__(self, base_url: str, allowlist: list[str],
                 client: httpx.AsyncClient | None = None):
        self._base_url = base_url.rstrip("/")
        self._allowlist = allowlist
        self._client = client or httpx.AsyncClient(timeout=httpx.Timeout(10.0))

    async def call(self, prompt: str, timeout: float) -> MockResponse:
        if not destination_allowed(self._base_url, self._allowlist):
            raise DestinationRejected(f"destination {self._base_url} not allowlisted")
        try:
            resp = await self._client.post(
                f"{self._base_url}/v1/respond",
                json={"prompt": prompt},
                timeout=timeout,
            )
            resp.raise_for_status()
            data = resp.json()
            return MockResponse(text=data["text"], behavior=data["behavior"],
                                latency_ms=data.get("latency_ms", 0))
        except httpx.TimeoutException as exc:
            raise TargetTimeout(str(exc)) from exc
        except httpx.HTTPError as exc:
            raise TargetError(str(exc)) from exc


class LocalModelAdapter:
    """DELIBERATE STUB (spec §17 P6, §18.1).

    Never downloads a model. Raises unless BAYORA_LOCAL_MODEL_READY=1 AND a
    provider is implemented — there is no silent fallback.
    """

    def __init__(self):
        import os
        if os.environ.get("BAYORA_LOCAL_MODEL_READY") != "1":
            raise NotImplementedError(
                "local_model adapter is an optional extension; set "
                "BAYORA_LOCAL_MODEL_READY=1 and implement provider discovery")
        raise NotImplementedError(
            "local_model adapter requested but no provider is implemented; "
            "Bayora never downloads models automatically (spec §18.1)")


class TargetSpy:
    """Wraps any TargetClient; counts calls (D17: proves block-mode never calls)."""

    def __init__(self, inner: TargetClient):
        self._inner = inner
        self.calls: list[str] = []

    @property
    def call_count(self) -> int:
        return len(self.calls)

    async def call(self, prompt: str, timeout: float) -> MockResponse:
        self.calls.append(prompt)
        return await self._inner.call(prompt, timeout)
