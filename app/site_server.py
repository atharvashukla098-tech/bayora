"""Static site + read-only evidence API for the public 3D site.

Run (from the repo root):

    python -m app.site_server            # 127.0.0.1:8010

Design rules:

* **Read-only.** No mutating route exists. The tamper demo lives in the
  operator console, not here.
* **Loopback by default.** A non-loopback bind is refused unless a real
  auth policy is configured - the same fail-closed doctrine the rest of
  the repo uses.
* **No billing, no external calls.** The site and its data are served
  from this process; the browser talks to nothing else.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles

from app.config import load_config
from app.site_bundle import SiteDataUnavailable, build_bundle, list_runs

ROOT = Path(__file__).resolve().parents[1]
SITE_DIR = ROOT / "site"

app = FastAPI(title="Bayora site — read-only evidence surface", version="1.0.0")

_config = load_config(None)          # fails closed on invalid configuration


@app.get("/api/site/runs")
def api_runs() -> dict:
    """Runs available for the site's run switcher (newest first)."""
    return {"runs": list_runs(_config)}


@app.get("/api/site/run.json")
def api_run(run: Optional[str] = Query(default=None)) -> dict:
    """Evidence bundle for one run (default: the latest recorded run)."""
    try:
        return build_bundle(_config, run_id=run)
    except SiteDataUnavailable as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/site/health")
def api_health() -> dict:
    return {
        "status": "ok",
        "service": "site",
        "site": str(SITE_DIR.is_dir()),
        "runs_dir": str(_config.ledger.runs_dir),
    }


# The site itself is mounted last so the API routes above win.
app.mount("/", StaticFiles(directory=str(SITE_DIR), html=True), name="site")


def main() -> int:
    """Serve the site on loopback. Non-loopback binds fail closed."""
    import uvicorn

    host = os.environ.get("BAYORA_SITE_HOST", "127.0.0.1")
    port = int(os.environ.get("BAYORA_SITE_PORT", "8010"))

    if host not in ("127.0.0.1", "localhost", "::1"):
        from app.infra.wire import build_auth_policy
        try:
            auth = build_auth_policy(_config)
        except Exception as exc:
            print(f"[BAYORA] refusing non-loopback bind: {exc}")
            return 2
        if auth.backend == "trusted-loopback":
            print("[BAYORA] refusing non-loopback bind without real auth")
            return 2

    print(f"[BAYORA] site on http://{host}:{port}  "
          f"(runs dir: {_config.ledger.runs_dir})")
    uvicorn.run(app, host=host, port=port, log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
