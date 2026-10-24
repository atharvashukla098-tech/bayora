// BAYORA 3D experience — entry point.
// Boots the renderer, loads the REAL run bundle, drives scroll→scene,
// renders HUD panels from real artifacts, handles WebGL/reduced-motion
// fallbacks and performance tiers. Zero network at runtime.

import * as THREE from 'three';
import { createRenderer, buildWorld, applyScene, CAM, SCENES } from './scenes.js';

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */
async function loadBundle() {
  try {
    const r = await fetch('data/demo_bundle.json');
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } catch (e) {
    console.warn('bundle unavailable, HUDs render in placeholder mode', e);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* HUD rendering — real data only; placeholder text if bundle missing   */
/* ------------------------------------------------------------------ */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function row(k, v, cls = '') {
  return `<div class="row"><span class="dim">${esc(k)}</span><b class="${cls}">${esc(v)}</b></div>`;
}

function renderHUDs(b) {
  const hero = document.getElementById('hud-hero');
  const attack = document.getElementById('hud-attack');
  const chain = document.getElementById('hud-chain');
  const reveal = document.getElementById('hud-reveal');

  if (!b) {
    for (const el of [hero, attack, chain, reveal]) {
      if (el) el.innerHTML = '<h3>RUN ARTIFACTS</h3><div class="row"><span class="dim">bundle not loaded — run scripts/export_demo_bundle.py</span></div>';
    }
    return;
  }

  const sig = b.signature && typeof b.signature === 'object'
    ? `${b.signature.algorithm ?? 'Ed25519'} · ${b.signature.key_id ?? ''}`
    : String(b.signature ?? '');

  if (hero) {
    hero.innerHTML = `
      <h3>RUN ${esc(b.run_id)}</h3>
      ${row('status', b.status, b.status === 'VERIFIED' ? 'ok' : 'warn')}
      ${row('events (ledger height)', b.events.length)}
      ${row('scenarios', b.scenario_count)}
      ${row('assertions passed', `${b.assertion_totals.passed}/${b.assertion_totals.total}`, 'ok')}
      ${row('signature', sig)}
      <div class="row"><span class="dim">exported</span><b>${esc((b.exported_at ?? '').slice(0, 19))}</b></div>`;
  }

  const det = (b.observations ?? []).find(o => o.outcome === 'DETECTED');
  if (attack) {
    attack.innerHTML = `
      <h3>INTERCEPTED — REAL EVENT</h3>
      ${det ? `
        ${row('scenario', det.scenario_id)}
        ${row('outcome', det.outcome, 'bad')}
        ${row('policy_reason', det.policy_reason, 'bad')}
        ${row('status_code', det.status_code)}
        <div class="row"><span class="dim">released (redacted)</span></div>
        <div class="hash">"${esc(det.released_text)}"</div>` : '<div class="row"><span class="dim">no DETECTED observation in bundle</span></div>'}`;
  }

  if (chain) {
    const steps = b.verification_steps ?? [];
    chain.innerHTML = `
      <h3>LEDGER VERIFICATION</h3>
      ${steps.map(s => row(s.assertion_id, s.status,
        (s.status === 'pass') ? 'ok' : 'warn')).join('')}
      <div class="row"><span class="dim">head</span><b class="hash">${esc((b.events.at(-1)?.hash ?? ''))}</b></div>
      <div class="row"><span class="dim">prev</span><b class="hash">${esc((b.events.at(-1)?.prev_hash ?? ''))}</b></div>`;
  }

  if (reveal) {
    const rows = (b.observations ?? []).map(o =>
      row(o.scenario_id, o.outcome, o.outcome === 'ALLOWED' ? 'ok' : (o.outcome === 'DETECTED' ? 'warn' : ''))).join('');
    reveal.innerHTML = `
      <h3>SCENARIO MATRIX — LIVE</h3>
      ${rows || '<div class="row"><span class="dim">no observations</span></div>'}
      ${row('known gap', 'encoded-leak redaction — documented', 'warn')}`;
  }

  const er = document.getElementById('evidence-rows');
  if (er) {
    er.innerHTML = `Run <b>${esc(b.run_id)}</b> · ${b.events.length} ledger events ·
      ${b.assertion_totals.passed}/${b.assertion_totals.total} assertions passed ·
      report status <b>${esc(b.status)}</b>. Download the bundle, check it against
      the pinned Ed25519 fingerprint in the repo README — every number above
      is reproducible with <span class="hash">python scripts/verify_ledger.py</span>.`;
  }
}

/* ------------------------------------------------------------------ */
/* Ledger ticker (bottom pill)                                          */
/* ------------------------------------------------------------------ */
function startTicker(b) {
  const el = document.getElementById('ledger-ticker');
  if (!el || !b) return;
  const events = b.events ?? [];
  let i = 0;
  el.classList.add('visible');
  setInterval(() => {
    const e = events[i % events.length];
    i++;
    if (!e) return;
    const bad = /DENIED|REJECT|ERROR|BLOCK/i.test(e.outcome ?? e.event_type ?? '');
    el.innerHTML =
      `<span>#${String(e.seq).padStart(2, '0')}</span>` +
      `<span>${esc(e.event_type)}</span>` +
      `<span>${esc((e.hash ?? ''))}</span>` +
      `<span class="${bad ? 't-bad' : 't-ok'}">${esc(e.outcome ?? e.component ?? '')}</span>`;
  }, 1400);
}

/* ------------------------------------------------------------------ */
/* Progress rail                                                        */
/* ------------------------------------------------------------------ */
function initRail() {
  const rail = document.getElementById('progress-rail');
  const sections = [...document.querySelectorAll('section[data-scene]')];
  if (!rail) return;
  const ids = sections.map(s => s.id);
  sections.forEach((s, i) => {
    const d = document.createElement('a');
    d.className = 'dot';
    d.href = '#' + s.id;
    d.setAttribute('aria-label', s.id);
    rail.appendChild(d);
  });
  const dots = [...rail.children];
  const io = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      const idx = ids.indexOf(en.target.id);
      dots.forEach((d, j) => {
        d.classList.toggle('active', j === idx);
        d.classList.toggle('done', j < idx);
      });
    });
  }, { threshold: 0.4 });
  sections.forEach(s => io.observe(s));
}

/* ------------------------------------------------------------------ */
/* Scroll → scene state (GSAP ScrollTrigger if present; IO fallback)    */
/* ------------------------------------------------------------------ */
function initScroll(onScene) {
  const sections = [...document.querySelectorAll('section[data-scene]')];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!reduce && window.gsap && window.ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);
    if (window.Lenis) {
      const lenis = new Lenis({ duration: 1.15, smoothWheel: true });
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add(t => lenis.raf(t * 1000));
      gsap.ticker.lagSmoothing(0);
    }
    sections.forEach(s => {
      ScrollTrigger.create({
        trigger: s,
        start: 'top 55%',
        end: 'bottom 45%',
        onEnter: () => onScene(s.dataset.scene),
        onEnterBack: () => onScene(s.dataset.scene),
      });
    });
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (en.isIntersecting) onScene(en.target.dataset.scene);
      });
    }, { threshold: 0.4 });
    sections.forEach(s => io.observe(s));
  }
}

/* ------------------------------------------------------------------ */
/* Camera glide — smooth move between scene framings                     */
/* ------------------------------------------------------------------ */
function makeCameraGlider(camera) {
  const cur = { x: 0, y: 1.2, z: 9.5 };
  let target = { ...cur };
  return {
    to(name) {
      const c = CAM[name];
      if (c) target = { x: c.pos[0], y: c.pos[1], z: c.pos[2] };
    },
    update(dt) {
      const k = 1 - Math.pow(0.001, dt);   // framerate-independent lerp
      cur.x += (target.x - cur.x) * k;
      cur.y += (target.y - cur.y) * k;
      cur.z += (target.z - cur.z) * k;
      camera.position.set(cur.x, cur.y, cur.z);
      camera.lookAt(0, 0, 0);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Main                                                                 */
/* ------------------------------------------------------------------ */
async function main() {
  const b = await loadBundle();
  renderHUDs(b);
  startTicker(b);
  initRail();

  const canvas = document.getElementById('gl-canvas');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let three = null;
  try {
    three = createRenderer(canvas);
  } catch (e) {
    console.warn('WebGL unavailable', e);
  }

  if (!three) {
    document.body.classList.add('no-webgl');
    return;   // 2D fallback is CSS-driven; nothing else to boot
  }
  if (reduced) {
    // reduced motion: keep the 2D narrative path too — no 3D animation
    document.body.classList.add('no-webgl');
    return;
  }

  const { renderer, tier } = three;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05070d, 0.016);
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 300);
  const world = buildWorld(scene, tier);
  const glide = makeCameraGlider(camera);

  let current = 'hero';
  const onScene = (name) => {
    if (!SCENES.includes(name) || name === current) return;
    current = name;
    glide.to(name);
  };
  initScroll(onScene);
  onScene('hero');

  const clock = new THREE.Clock();
  let visible = true;
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; });

  function resize() {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);

  renderer.setAnimationLoop(() => {
    if (!visible) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    applyScene(world, current, t, dt);
    glide.update(dt);
    renderer.render(scene, camera);
  });
}

main().catch(err => {
  console.error('boot failed', err);
  document.body.classList.add('no-webgl');
});
