"""In-container runtime probe (blueprint §14.2/§14.4, D26).

STDLIB ONLY — it is COPY'd into the Docker image and must not depend on any
package beyond the base python:3.12-slim image. Runs INSIDE the target (or
broker) container via ``docker compose exec -T target python
scripts/runtime_probe.py --json``.

Probes:
  control_healthz_target — broker->target /healthz (Control A, broker ns)
  control_dns_internal    — resolve 'target' via embedded DNS (Control B)
  machinery_local_refused — dial a closed port on the subnet (machinery
                            control; its signal is NEVER denial evidence, D16)
  external_tcp            — dial 192.0.2.1:443 (RFC 5737 TEST-NET-1; evidence)
  external_dns            — resolve example.com (evidence)
  external_http           — GET http://192.0.2.1/ with short timeout (evidence)

A connection timeout ALONE is never a positive denial signal: refused /
unreachable / DNS-failure are; bare ETIMEDOUT is recorded as no signal.
"""

from __future__ import annotations

import argparse
import http.client
import json
import socket
import sys


def _probe_control_healthz_target() -> dict:
    """Broker-container probe: reach the target's /healthz over internal_net."""
    try:
        conn = http.client.HTTPConnection("target", 8000, timeout=5)
        conn.request("GET", "/healthz")
        resp = conn.getresponse()
        body = resp.read().decode("utf-8", "replace")
        # tolerate both spaced and compact JSON serialization
        compact = body.replace(" ", "")
        ok = resp.status == 200 and '"status":"ok"' in compact
        return {"id": "control_healthz_target", "ok": ok,
                "status": resp.status, "body_excerpt": body[:120]}
    except OSError as exc:
        return {"id": "control_healthz_target", "ok": False,
                "error": f"{type(exc).__name__}: {exc}"}


def _probe_control_dns_internal() -> dict:
    try:
        infos = socket.getaddrinfo("target", 8000, proto=socket.IPPROTO_TCP)
        return {"id": "control_dns_internal", "ok": bool(infos),
                "resolved": len(infos)}
    except OSError as exc:
        return {"id": "control_dns_internal", "ok": False,
                "error": f"{type(exc).__name__}: {exc}"}


def _classify_conn_error(exc: OSError) -> tuple[str, bool]:
    """Return (classification, denial_signal) for a socket error.

    denial_signal=True only for refused/unreachable/DNS-failure classes —
    never for a bare timeout (spec §4.1).
    """
    import errno as _errno
    name = type(exc).__name__
    err = getattr(exc, "errno", None)
    if isinstance(exc, socket.gaierror):
        return f"dns_failure:{name}", True
    if err == _errno.ECONNREFUSED:
        return "connection_refused", True
    if err in (_errno.ENETUNREACH, _errno.EHOSTUNREACH):
        return "unreachable", True
    if err == _errno.ETIMEDOUT:
        return "timeout", False
    return f"other:{name}:errno={err}", False


def _probe_machinery_local_refused() -> dict:
    """Dial a port with no listener on the container's default gateway.

    Machinery control (D16): proves the probe produces classified signals in
    this environment. NEVER counted as denial evidence.
    """
    gateway = None
    try:
        import ipaddress
        with open("/proc/net/route") as fh:  # container: linux — fine
            for line in fh.readlines()[1:]:
                parts = line.split()
                if parts[1] == "00000000":
                    hexaddr = parts[2]
                    gateway = socket.inet_ntoa(
                        bytes.fromhex(hexaddr)[::-1])
                    break
    except OSError:
        gateway = None
    if gateway is None:
        gateway = "127.0.0.1"   # loopback closed port: RST guaranteed
    try:
        sock = socket.create_connection((gateway, 9), timeout=2)
        sock.close()
        return {"id": "machinery_local_refused", "classified": False,
                "note": "connected — no RST; machinery unclassifiable",
                "gateway": gateway}
    except OSError as exc:
        classification, _ = _classify_conn_error(exc)
        return {"id": "machinery_local_refused", "classified": True,
                "classification": classification, "gateway": gateway}


def _probe_external_tcp() -> dict:
    """RFC 5737 TEST-NET-1 dial — evidence probe 4."""
    try:
        sock = socket.create_connection(("192.0.2.1", 443), timeout=3)
        sock.close()
        return {"id": "external_tcp", "denial_signal": False,
                "classification": "connected",
                "note": "UNEXPECTED — external dial succeeded; containment FAIL"}
    except OSError as exc:
        classification, signal = _classify_conn_error(exc)
        return {"id": "external_tcp", "denial_signal": signal,
                "classification": classification}


def _probe_external_dns() -> dict:
    try:
        socket.getaddrinfo("example.com", 443, proto=socket.IPPROTO_TCP)
        return {"id": "external_dns", "denial_signal": False,
                "classification": "resolved",
                "note": "UNEXPECTED — external DNS resolved; containment FAIL"}
    except OSError as exc:
        classification, signal = _classify_conn_error(exc)
        return {"id": "external_dns", "denial_signal": signal,
                "classification": classification}


def _probe_external_http() -> dict:
    try:
        conn = http.client.HTTPConnection("192.0.2.1", 80, timeout=3)
        conn.request("GET", "/")
        resp = conn.getresponse()
        return {"id": "external_http", "denial_signal": False,
                "classification": f"http_status_{resp.status}",
                "note": "UNEXPECTED — external HTTP answered; containment FAIL"}
    except OSError as exc:
        classification, signal = _classify_conn_error(exc)
        return {"id": "external_http", "denial_signal": signal,
                "classification": classification}


def _full_record() -> dict:
    return {
        "container": "target",
        "probes": [
            _probe_control_dns_internal(),
            _probe_machinery_local_refused(),
            _probe_external_tcp(),
            _probe_external_dns(),
            _probe_external_http(),
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Bayora in-container runtime probe")
    parser.add_argument("--json", action="store_true",
                        help="emit the full probe record as JSON")
    parser.add_argument("--probe", choices=["healthz_target"],
                        help="run a single named probe (Control A)")
    args = parser.parse_args(argv)

    if args.probe == "healthz_target":
        rec = _probe_control_healthz_target()
        print(json.dumps(rec))
        return 0 if rec.get("ok") else 1
    print(json.dumps(_full_record()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
