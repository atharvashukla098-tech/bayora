"""HTTP security headers middleware (production review: "add security headers").

Adds the defensive baseline to every broker/target response:
  X-Content-Type-Options: nosniff        (no MIME sniffing)
  X-Frame-Options: DENY                   (no clickjacking)
  Referrer-Policy: no-referrer           (no referrer leakage)
  Content-Security-Policy: default-src 'none'; frame-ancestors 'none'
  Cache-Control: no-store                 (no caching of security data)
  Strict-Transport-Security is NOT set: this is an offline/loopback demo
  over plain HTTP; HSTS on http://localhost is noise. A TLS-fronted
  deployment should add it at the proxy.
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Cache-Control": "no-store",
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        for k, v in SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
        return response
