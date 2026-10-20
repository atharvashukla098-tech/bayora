#!/usr/bin/env bash
# One-time dependency setup for the Bayora build (run from the project root).
set -euo pipefail
PY=./venv/Scripts/python.exe
"$PY" -m pip install --disable-pip-version-check --quiet \
    fastapi pydantic uvicorn httpx cryptography PyYAML \
    pytest pytest-asyncio pytest-timeout
"$PY" -m pip list --format=freeze | grep -Ei '^(fastapi|pydantic|pydantic_core|pydantic-core|uvicorn|httpx|cryptography|PyYAML|pytest|pytest-asyncio|pytest-timeout|anyio|starlette|typing_extensions|typing-extensions)='
echo "SETUP_OK"
