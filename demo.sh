#!/usr/bin/env bash
# BAYORA demo-day launcher: backend + production frontend, one command.
# Usage: bash demo.sh   (then open http://localhost:4173)
set -e
cd "$(dirname "$0")"

PY="C:/Users/Admin/AppData/Local/Programs/Python/Python312/python.exe"

echo "[1/3] backend: FastAPI broker on :8000"
"$PY" -m uvicorn scripts.serve_api:app --host 127.0.0.1 --port 8000 &
BACK_PID=$!

echo "[2/3] building production frontend (vite build)..."
cd frontend && node node_modules/vite/bin/vite.js build
cd ..

echo "[3/3] serving production build on :4173"
cd frontend && { node node_modules/vite/bin/vite.js preview --port 4173 --host & }
FRONT_PID=$!

echo ""
echo "  BAYORA LIVE: http://localhost:4173"
echo "  backend    : http://127.0.0.1:8000/v1/ledger"
echo ""
trap "kill $BACK_PID $FRONT_PID 2>/dev/null" EXIT
wait
