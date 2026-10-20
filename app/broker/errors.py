"""Broker error codes with fixed, static, safe messages (blueprint §7.2, D13).

Untrusted callers can never be shown stack traces, config, prompts or canary
values: every code carries one fixed human message; dynamic detail is logged
server-side only (structured, sanitized, prompt-digest only).
"""

from __future__ import annotations

import re
from enum import Enum


class BrokerErrorCode(str, Enum):
    SCHEMA_INVALID = "SCHEMA_INVALID"
    REQUEST_TOO_LARGE = "REQUEST_TOO_LARGE"
    RATE_LIMITED = "RATE_LIMITED"
    INJECTION_DETECTED = "INJECTION_DETECTED"
    DESTINATION_REJECTED = "DESTINATION_REJECTED"
    FS_WRITE_DETECTED = "FS_WRITE_DETECTED"
    TARGET_ERROR = "TARGET_ERROR"
    TARGET_TIMEOUT = "TARGET_TIMEOUT"
    TOO_BUSY = "TOO_BUSY"
    INTERNAL = "INTERNAL"


STATIC_MESSAGES: dict[BrokerErrorCode, str] = {
    BrokerErrorCode.SCHEMA_INVALID:
        "request body failed schema validation",
    BrokerErrorCode.REQUEST_TOO_LARGE:
        "request body exceeds the configured size limit",
    BrokerErrorCode.RATE_LIMITED:
        "request rate exceeds the configured per-client limit",
    BrokerErrorCode.INJECTION_DETECTED:
        "request blocked by injection policy before target evaluation",
    BrokerErrorCode.DESTINATION_REJECTED:
        "destination is not on the configured allowlist",
    BrokerErrorCode.FS_WRITE_DETECTED:
        "response flagged: simulated protected-path write reported",
    BrokerErrorCode.TARGET_ERROR:
        "target evaluation failed; response withheld (fail closed)",
    BrokerErrorCode.TARGET_TIMEOUT:
        "target evaluation timed out; response withheld (fail closed)",
    BrokerErrorCode.TOO_BUSY:
        "broker concurrency limit reached; try again shortly",
    BrokerErrorCode.INTERNAL:
        "internal error; no details are exposed to callers",
}

# Server-side structured logging: digest-only, never raw prompts (D13).
_DIGEST_RE = re.compile(r"[0-9a-f]{16}")


def as_broker_error(exc: BaseException) -> tuple[BrokerErrorCode, str]:
    """Map an unexpected exception to (code, static message) for the 500 path.

    Full internal detail is logged server-side by the caller; only the static
    message ever reaches the response.
    """
    _ = exc
    return BrokerErrorCode.INTERNAL, STATIC_MESSAGES[BrokerErrorCode.INTERNAL]
