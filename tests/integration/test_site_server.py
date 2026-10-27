"""Integration tests for the public site: the static surface, the
read-only evidence API, and the offline-purity rule (the site must never
load a resource from anywhere else).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / "site"


@pytest.fixture(scope="module")
def client() -> TestClient:
    from app.site_server import app
    return TestClient(app)


def test_site_serves_the_page(client: TestClient):
    res = client.get("/")
    assert res.status_code == 200
    html = res.text
    assert "<canvas id=\"scene\"" in html
    for chapter in ("ch-hero", "ch-attack", "ch-decision", "ch-evidence",
                    "ch-tamper", "ch-attestation"):
        assert f'id="{chapter}"' in html
    # the import map that points the bare "three" specifier at the vendored
    # build must be present, or the module graph fails to resolve
    assert "three.module.min.js" in html


def test_site_assets_resolve(client: TestClient):
    for path in ("/assets/css/site.css",
                 "/assets/js/main.js",
                 "/assets/js/data.js",
                 "/assets/js/scene.js",
                 "/assets/vendor/three.module.min.js",
                 "/assets/vendor/three.core.min.js",
                 "/assets/fonts/fonts.css"):
        res = client.get(path)
        assert res.status_code == 200, path
        assert len(res.content) > 0


def test_evidence_api_returns_a_bundle(client: TestClient):
    res = client.get("/api/site/run.json")
    if res.status_code == 404:
        pytest.skip("no run artifacts in this environment")
    assert res.status_code == 200
    data = res.json()
    assert set(data) == {"run", "events", "matrix", "report", "checkpoint",
                         "integrity", "summary"}
    assert data["run"]["run_id"]
    assert isinstance(data["events"], list)


def test_runs_api_lists_runs(client: TestClient):
    res = client.get("/api/site/runs")
    assert res.status_code == 200
    assert "runs" in res.json()


def test_api_has_no_mutating_routes():
    """The public surface is read-only by construction."""
    from app.site_server import app
    mutating = []
    for route in app.routes:
        methods = getattr(route, "methods", set()) or set()
        if methods & {"POST", "PUT", "PATCH", "DELETE"}:
            mutating.append((getattr(route, "path", "?"), sorted(methods)))
    assert mutating == [], f"mutating routes exposed: {mutating}"


def test_site_makes_no_external_resource_requests():
    """Offline purity: no stylesheet, script, font, image or CSS url may
    point off the machine. Plain hyperlinks are allowed."""
    offenders: list[str] = []
    html = (SITE / "index.html").read_text(encoding="utf-8")
    for pattern in (r'<script[^>]+src="https?://',
                    r'<link[^>]+href="https?://',
                    r'<img[^>]+src="https?://',
                    r'@import\s+url\(\s*["\']?https?://'):
        offenders += re.findall(pattern, html, re.IGNORECASE)
    for css in (SITE / "assets" / "css").glob("*.css"):
        text = css.read_text(encoding="utf-8")
        offenders += re.findall(r"url\(\s*['\"]?https?://", text, re.IGNORECASE)
    for js in (SITE / "assets" / "js").glob("*.js"):
        text = js.read_text(encoding="utf-8")
        offenders += re.findall(r"fetch\(\s*['\"]https?://", text)
        offenders += re.findall(r"import\(\s*['\"]https?://", text)
    assert offenders == [], f"external resource references: {offenders}"


def test_vendored_three_is_local_and_licensed():
    vendor = SITE / "assets" / "vendor"
    assert (vendor / "three.module.min.js").is_file()
    assert (vendor / "three.core.min.js").is_file()
    license_text = (vendor / "LICENSE").read_text(encoding="utf-8")
    assert "MIT" in license_text
    # the module must resolve its sibling core build relatively
    module = (vendor / "three.module.min.js").read_text(encoding="utf-8")
    assert 'from"./three.core.min.js"' in module


def test_fonts_are_vendored_with_their_license():
    fonts = SITE / "assets" / "fonts"
    css = (fonts / "fonts.css").read_text(encoding="utf-8")
    assert "Syne" in css and "Manrope" in css and "JetBrains Mono" in css
    assert "url('./" in css, "font faces must point at local files"
    assert list(fonts.glob("*.woff2")), "no local font files committed"
    assert (fonts / "OFL.txt").is_file(), "the font licence must ship with them"


def test_every_html_binding_is_filled_by_the_data_layer():
    """A data-bind attribute the JS never writes would silently render '—'."""
    html = (SITE / "index.html").read_text(encoding="utf-8")
    bindings = set(re.findall(r'data-bind="([^"]+)"', html))
    data_js = (SITE / "assets" / "js" / "data.js").read_text(encoding="utf-8")
    table_hosts = {"events.table", "matrix.table"}
    for binding in sorted(bindings - table_hosts):
        assert f'setText("{binding}"' in data_js, \
            f"binding '{binding}' is never filled"


def test_chapter_count_matches_camera_keyframes():
    """Every chapter needs a camera keyframe, or the scroll hits a dead end."""
    html = (SITE / "index.html").read_text(encoding="utf-8")
    chapters = len(re.findall(r'class="chapter[^"]*"', html))
    scene_js = (SITE / "assets" / "js" / "scene.js").read_text(encoding="utf-8")
    keys = len(re.findall(r"\{\s*pos:\s*\[", scene_js))
    assert chapters == keys, f"{chapters} chapters but {keys} camera keyframes"


def test_static_snapshot_is_committed_and_shaped():
    snapshot = SITE / "data" / "run-snapshot.json"
    assert snapshot.is_file(), "the offline snapshot must be committed"
    data = json.loads(snapshot.read_text(encoding="utf-8"))
    assert set(data) == {"run", "events", "matrix", "report", "checkpoint",
                         "integrity", "summary"}
    assert "BAYORA-CANARY" not in snapshot.read_text(encoding="utf-8").upper()
