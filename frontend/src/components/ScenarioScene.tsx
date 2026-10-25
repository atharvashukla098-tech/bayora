// BAYORA — Scenario Worlds: four dedicated HD 3D scenes, one per pillar card.
// SC-01 NeuralGateway (glowing orb + filament brain, quarantine shield)
// SC-02 CanaryKnot (liquid-chrome torus knot, canary escape/redaction chase)
// SC-03 EgressBoundary (iridescent cloud over water, SSRF blocked at the ring)
// SC-04r FilesystemIsland (floating oak island, corrupted write rejected)
//
// Every scene: real backend action drives the choreography, drag-to-spin with
// inertia, potato-tier aware, pauses when hidden, reduced-motion safe.

import { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

export interface WorldProps {
  mode?: string; // 'idle' | 'dispatching' | 'detected' | 'blocked' | 'redacted' | 'allowed'
  onFirstGrab?: () => void;
}



// Deprecation-free replacement for THREE.Clock (same getDelta/elapsedTime
// semantics; THREE.Clock warns on every instantiation in current builds).
class FrameClock {
  private prev = 0;
  elapsedTime = 0;
  getDelta() {
    const now = performance.now() / 1000;
    const dt = this.prev === 0 ? 0 : now - this.prev;
    this.prev = now;
    this.elapsedTime += dt;
    return dt;
  }
}

/* ------------------------------------------------------------------ */
/* shared helpers                                                       */
/* ------------------------------------------------------------------ */

function useTier() {
  return (typeof window !== 'undefined'
    ? ((window as unknown as { __BAYORA_TIER?: string }).__BAYORA_TIER || 'mid')
    : 'mid');
}

function makeGlowTexture(inner: string, mid: string): THREE.CanvasTexture {
  // 512px: smooth cinematic falloff, anisotropic-filtered. Generated once
  // per world mount — a few ms — and the GPU handles the rest.
  const SZ = 512;
  const c = document.createElement('canvas');
  c.width = c.height = SZ;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(SZ / 2, SZ / 2, 2, SZ / 2, SZ / 2, SZ / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.28, mid);
  g.addColorStop(0.62, 'rgba(0,0,0,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SZ, SZ);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  return tex;
}

function makeSoftSprite(tex: THREE.Texture, color: number, scale: number, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color, transparent: true, opacity,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  s.scale.setScalar(scale);
  return s;
}

/** drag-to-spin with inertia + cursor parallax, shared by all worlds */
function useOrbit(
  mount: HTMLDivElement,
  group: THREE.Object3D,
  onFirstGrab?: () => void,
) {
  let dragging = false, lastX = 0, lastY = 0;
  let spinVelY = 0;
  let userSpinY = 0, userSpinX = 0;
  const INTERACTIVE = 'textarea, button, a, input, select, [contenteditable]';
  let hinted = false;
  const onDown = (e: PointerEvent) => {
    const el = e.target as HTMLElement | null;
    if (el && el.closest?.(INTERACTIVE)) return;
    if (e.button !== 0) return;
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    mount.style.cursor = 'grabbing';
    if (!hinted) { hinted = true; onFirstGrab?.(); }
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    userSpinY += dx * 0.005;
    userSpinX = Math.max(-0.5, Math.min(0.5, userSpinX + dy * 0.003));
    spinVelY = dx * 0.005 * 60;
  };
  const onUp = () => { dragging = false; mount.style.cursor = 'grab'; };
  mount.style.cursor = 'grab';
  window.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  const update = (dt: number) => {
    if (!dragging) {
      spinVelY *= Math.pow(0.04, dt);
      userSpinY += spinVelY * dt;
    }
    group.rotation.y = userSpinY;
    group.rotation.x = userSpinX;
  };
  const cleanup = () => {
    window.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    mount.style.cursor = '';
  };
  return { update, cleanup };
}


// ---- adaptive fps governor: keeps native resolution without dropping below 1.0 ----
function makeGovernor(renderer: THREE.WebGLRenderer, maxPR: number) {
  let pr = maxPR;
  let accum = 0, frames = 0, cool = 2.0; // 2s initial warmup
  const step = 0.25;
  const floor = 1.0; // Never drop below native 1.0 DPR!
  const apply = (v: number) => { pr = v; renderer.setPixelRatio(Math.min(v, window.devicePixelRatio || 1)); };
  return {
    tick(dt: number) {
      if (cool > 0) { cool -= dt; return; }
      accum += dt; frames++;
      if (frames < 45) return; // ~0.75s sample window
      const avg = accum / frames;
      accum = 0; frames = 0; cool = 1.0;
      if (avg > 1 / 28 && pr > floor) {           // only if sustained below 28fps
        apply(Math.max(floor, +(pr - step).toFixed(2)));
      } else if (avg < 1 / 55 && pr < maxPR) {    // reclaim on standard 60hz/120hz displays
        apply(Math.min(maxPR, +(pr + step).toFixed(2)));
      }
    },
    get pixelRatio() { return pr; },
  };
}

function baseSetup(mount: HTMLDivElement, fov = 45, camZ = 8) {
  const tier = useTier();
  const PR_CAP = tier === 'low' ? 1.25 : tier === 'mid' ? 1.75 : 2.0;
  const PR = Math.min(window.devicePixelRatio || 1, PR_CAP);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(PR);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  const governor = makeGovernor(renderer, PR_CAP);
  renderer.setClearColor(0x000000, 0);
  mount.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 120);
  camera.position.set(0, 0.6, camZ);
  const resize = () => {
    const w = mount.clientWidth, h = mount.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(mount);
  return { renderer, scene, camera, ro, tier, governor };
}

function disposeScene(scene: THREE.Scene, renderer: THREE.WebGLRenderer, ro: ResizeObserver, mount: HTMLDivElement) {
  ro.disconnect();
  renderer.dispose();
  scene.traverse((obj) => {
    (obj as THREE.Mesh).geometry?.dispose?.();
    const mat = (obj as THREE.Mesh).material;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose?.();
  });
  if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
}

/* ------------------------------------------------------------------ */
/* SC-01 — NEURAL GATEWAY: orb, filament brain, quarantine shield       */
/* ------------------------------------------------------------------ */

export function NeuralGateway({ mode = 'idle', onFirstGrab }: WorldProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef(mode);
  const apiRef = useRef<{ setMode: (m: string) => void } | null>(null);
  useEffect(() => { modeRef.current = mode; if (apiRef.current) apiRef.current.setMode(mode); }, [mode]);

  useEffect(() => {
    const mount = mountRef.current!;
    const { renderer, scene, camera, ro, tier, governor } = baseSetup(mount, 46, 9.5);
    scene.fog = new THREE.FogExp2(0x04070f, 0.045);

    const world = new THREE.Group();
    scene.add(world);

    // ---- filament brain: CURVED, BRANCHING neurons (not straight rays) ----
    const filCount = tier === 'low' ? 34 : tier === 'mid' ? 84 : 110;
    const filPos: number[] = [];
    const segs = 7; // curve segments per filament
    for (let i = 0; i < filCount; i++) {
      const dir = new THREE.Vector3().randomDirection();
      // random bezier-ish control offsets -> organic curl
      const c1 = new THREE.Vector3().randomDirection().multiplyScalar(0.45);
      const c2 = new THREE.Vector3().randomDirection().multiplyScalar(0.5);
      const end = dir.clone().multiplyScalar(0.8 + Math.random() * 0.55);
      let prev = new THREE.Vector3();
      for (let sIdx = 0; sIdx <= segs; sIdx++) {
        const u = sIdx / segs;
        // quadratic-ish curve through control points
        const p = new THREE.Vector3(
          (1 - u) * (1 - u) * 0 + 2 * (1 - u) * u * c1.x + u * u * end.x,
          (1 - u) * (1 - u) * 0 + 2 * (1 - u) * u * c1.y + u * u * end.y,
          (1 - u) * (1 - u) * 0 + 2 * (1 - u) * u * c1.z + u * u * end.z
        );
        p.addScaledVector(c2, Math.sin(u * Math.PI) * 0.35);
        if (sIdx > 0) {
          filPos.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
        }
        prev = p;
        // branch: at mid-segment, spawn a short offshoot
        if (sIdx === 3 && Math.random() < 0.6) {
          const branch = new THREE.Vector3().randomDirection().multiplyScalar(0.3);
          filPos.push(p.x, p.y, p.z, p.x + branch.x, p.y + branch.y, p.z + branch.z);
        }
      }
    }
    // synapse nodes: tiny glow points at filament tips
    const synapseCount = tier === 'low' ? 18 : tier === 'mid' ? 56 : 80;
    const synPos = new Float32Array(synapseCount * 3);
    for (let i = 0; i < synapseCount; i++) {
      const d = new THREE.Vector3().randomDirection().multiplyScalar(0.55 + Math.random() * 0.65);
      synPos.set([d.x, d.y, d.z], i * 3);
    }
    const synGeo = new THREE.BufferGeometry();
    synGeo.setAttribute('position', new THREE.BufferAttribute(synPos, 3));
    const synapses = new THREE.Points(synGeo, new THREE.PointsMaterial({
      color: 0x8fe8ff, size: 0.05, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    world.add(synapses);
    const filGeo = new THREE.BufferGeometry();
    filGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(filPos), 3));
    const filMat = new THREE.LineBasicMaterial({ color: 0x5fd8ff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending });
    const filaments = new THREE.LineSegments(filGeo, filMat);
    world.add(filaments);

    // ---- core + shell ----
    const glowTex = makeGlowTexture('rgba(200,240,255,0.9)', 'rgba(43,140,255,0.25)');
    const coreGlow = makeSoftSprite(glowTex, 0xffffff, 5.5);
    world.add(coreGlow);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xdff6ff })
    );
    world.add(core);
    const shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.35, 2),
      new THREE.MeshBasicMaterial({ color: 0x2f7dd1, wireframe: true, transparent: true, opacity: 0.28 })
    );
    world.add(shell);

    // ---- orbital rings with beads ----
    const ringGroup = new THREE.Group();
    world.add(ringGroup);
    const rings: { mesh: THREE.Mesh; speed: number }[] = [];
    const beadMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff });
    for (let i = 0; i < 3; i++) {
      const holder = new THREE.Group();
      holder.rotation.set(Math.PI / 2.6 + i * 0.35, i * 1.1, i * 0.5);
      const r = 1.9 + i * 0.4;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.012, 6, 90),
        new THREE.MeshBasicMaterial({ color: 0x57c8ff, transparent: true, opacity: 0.5 })
      );
      ring.rotation.x = Math.PI / 2;
      holder.add(ring);
      const beadCount = 6 + i * 2;
      for (let b = 0; b < beadCount; b++) {
        const bead = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), beadMat);
        const a = (b / beadCount) * Math.PI * 2;
        bead.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        holder.add(bead);
      }
      rings.push({ mesh: holder as unknown as THREE.Mesh, speed: (0.25 + i * 0.14) * (i % 2 ? -1 : 1) });
      ringGroup.add(holder);
    }

    // ---- reflective platform + MIRROR REFLECTION of the orb ----
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(9, 48),
      new THREE.MeshStandardMaterial({ color: 0x060a16, metalness: 0.85, roughness: 0.25 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.6;
    world.add(floor);
    // mirrored copy of core + shell + glow, flipped under the floor line
    const reflectGroup = new THREE.Group();
    reflectGroup.scale.y = -1;
    reflectGroup.position.y = -2.6;
    const rCore = new THREE.Mesh(core.geometry, new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.45 }));
    rCore.position.set(0, 2.62, 0);
    reflectGroup.add(rCore);
    const rShell = new THREE.Mesh(shell.geometry, new THREE.MeshBasicMaterial({ color: 0x2f7dd1, wireframe: true, transparent: true, opacity: 0.10 }));
    rShell.position.set(0, 2.62, 0);
    reflectGroup.add(rShell);
    const rGlow = makeSoftSprite(glowTex, 0x2f7dd1, 6.5, 0.28);
    rGlow.position.set(0, 2.62, 0);
    reflectGroup.add(rGlow);
    const rFil = new THREE.LineSegments(filGeo, new THREE.LineBasicMaterial({ color: 0x2f7dd1, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending }));
    rFil.position.set(0, 2.62, 0);
    reflectGroup.add(rFil);
    world.add(reflectGroup);
    const floorRings: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const pr = new THREE.Mesh(
        new THREE.TorusGeometry(1.6 + i * 0.75, 0.015, 6, 80),
        new THREE.MeshBasicMaterial({ color: 0x2fa9e8, transparent: true, opacity: 0.55 - i * 0.13 })
      );
      pr.rotation.x = Math.PI / 2;
      pr.position.y = -2.58;
      world.add(pr);
      floorRings.push(pr);
    }

    // ---- starfield atmosphere ----
    const starCount = tier === 'low' ? 400 : tier === 'mid' ? 1400 : 2600;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 16 + Math.random() * 26;
      const t2 = Math.random() * Math.PI * 2;
      const p2 = Math.acos(2 * Math.random() - 1);
      starPos.set([r * Math.sin(p2) * Math.cos(t2), Math.abs(r * Math.cos(p2)) * 0.6 - 1, r * Math.sin(p2) * Math.sin(t2)], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xcfe8f8, size: 0.09, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    scene.add(stars);
    // starfield slow drift in the animate loop: add via closure var below

    // ---- quarantine shield (appears on detected) ----
    const shield = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.72, 1),
      new THREE.MeshBasicMaterial({ color: 0xff2233, wireframe: true, transparent: true, opacity: 0 })
    );
    world.add(shield);
    const shieldGlowTex = makeGlowTexture('rgba(255,80,80,0.8)', 'rgba(255,30,30,0.25)');
    const shieldGlow = makeSoftSprite(shieldGlowTex, 0xff3344, 6, 0);
    world.add(shieldGlow);

    // ---- attack beam (dispatching) ----
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.02, 12, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffb454, transparent: true, opacity: 0 })
    );
    beam.rotation.z = Math.PI / 2.4;
    beam.position.set(-7, 0.4, 2);
    world.add(beam);
    const beamGlow = makeSoftSprite(glowTex, 0xffb454, 2.2, 0);
    world.add(beamGlow);

    // ---- lights ----
    scene.add(new THREE.AmbientLight(0x1c3a5e, 0.7));
    const key = new THREE.PointLight(0x66d9ff, 22, 26); key.position.set(2.5, 3, 4); scene.add(key);
    const rim = new THREE.PointLight(0x2b50ff, 10, 20); rim.position.set(-4, -1, -3); scene.add(rim);

    // ---- interaction ----
    const orbit = useOrbit(mount, world, onFirstGrab);

    // ---- mode machinery ----
    let m = modeRef.current || 'idle';
    let modeT = 0;
    apiRef.current = { setMode: (nm: string) => { m = nm || 'idle'; modeT = 0; } };
    apiRef.current.setMode(modeRef.current || 'idle'); // sync any mode that arrived during mount

    const clock = new FrameClock();
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (document.hidden) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      governor.tick(dt);
      const t = clock.elapsedTime;
      modeT += dt;

      orbit.update(dt);
      rings.forEach((r) => { r.mesh.rotation.y += dt * r.speed; });
      shell.rotation.y += dt * 0.12;
      filaments.rotation.y -= dt * 0.08;
      stars.rotation.y += dt * 0.008;

      // breathing + flicker
      const breathe = 1 + Math.sin(t * 1.5) * 0.06;
      core.scale.setScalar(breathe);
      coreGlow.scale.setScalar(5.2 + Math.sin(t * 1.5) * 0.6);
      filMat.opacity = 0.55 + Math.sin(t * 3.1) * 0.18;

      if (m === 'dispatching') {
        const p = Math.min(modeT / 1.1, 1);
        (beam.material as THREE.MeshBasicMaterial).opacity = p < 1 ? 0.85 : Math.max(0, 0.85 - (modeT - 1.1) * 2);
        beam.position.x = -7 + p * 6.4;
        beamGlow.position.copy(beam.position);
        beamGlow.material.opacity = (beam.material as THREE.MeshBasicMaterial).opacity * 0.8;
        filMat.color.setHex(0xffb454);
        coreGlow.material.color.setHex(0xffb454);
      } else if (m === 'detected' || m === 'blocked') {
        (beam.material as THREE.MeshBasicMaterial).opacity = 0; // no stray amber in alarm state
        beamGlow.material.opacity = 0;
        // pure alarm red — the whole neighborhood goes alarm
        filMat.color.setHex(0xff2233);
        coreGlow.material.color.setHex(0xff4455);
        shell.material.color.setHex(0x661122);
        rings.forEach((r) => {
          r.mesh.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (mesh.isMesh || (mesh as unknown as THREE.Sprite).isSprite) {
              const mat = mesh.material as THREE.MeshBasicMaterial & THREE.SpriteMaterial;
              if (mat && mat.color) mat.color.setHex(0xff3344);
            }
          });
        });
        const so = Math.min(modeT * 2.2, 1);
        shield.scale.setScalar(0.01 + so);
        (shield.material as THREE.MeshBasicMaterial).opacity = so * (0.55 + Math.sin(t * 5) * 0.2);
        shieldGlow.material.opacity = so * 0.5;
        shield.rotation.y += dt * 0.8; // the cage spins on its own
        filMat.opacity = 0.9 + Math.sin(t * 9) * 0.1;
        floorRings.forEach((fr) => {
          (fr.material as THREE.MeshBasicMaterial).color.setHex(0xff3344);
        });
        key.color.setHex(0xff5566);
      } else {
        // ease back to idle
        filMat.color.lerp(new THREE.Color(0x5fd8ff), dt * 2);
        coreGlow.material.color.lerp(new THREE.Color(0xffffff), dt * 2);
        shell.material.color.lerp(new THREE.Color(0x2f7dd1), dt * 2);
        rings.forEach((r) => {
          r.mesh.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (mesh.isMesh || (mesh as unknown as THREE.Sprite).isSprite) {
              const mat = mesh.material as THREE.MeshBasicMaterial & THREE.SpriteMaterial;
              if (mat && mat.color) mat.color.lerp(new THREE.Color(0x57c8ff), dt * 2);
            }
          });
        });
        shieldGlow.material.opacity = Math.max(0, shieldGlow.material.opacity - dt * 1.5);
        (beam.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (beam.material as THREE.MeshBasicMaterial).opacity - dt * 2);
        beamGlow.material.opacity = Math.max(0, beamGlow.material.opacity - dt * 2);
        floorRings.forEach((fr) => {
          (fr.material as THREE.MeshBasicMaterial).color.lerp(new THREE.Color(0x2fa9e8), dt * 2);
        });
        key.color.lerp(new THREE.Color(0x66d9ff), dt * 2);
        (shield.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (shield.material as THREE.MeshBasicMaterial).opacity - dt * 1.5);
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      orbit.cleanup();
      disposeScene(scene, renderer, ro, mount);
    };
  }, []);

  return <div ref={mountRef} className="absolute inset-0" aria-hidden style={{ touchAction: 'none' }} />;
}

/* ------------------------------------------------------------------ */
/* SC-02 — CANARY KNOT: liquid chrome, canary escape + redaction chase  */
/* ------------------------------------------------------------------ */

export function CanaryKnot({ mode = 'idle', onFirstGrab }: WorldProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef(mode);
  const apiRef = useRef<{ setMode: (m: string) => void } | null>(null);
  useEffect(() => { modeRef.current = mode; if (apiRef.current) apiRef.current.setMode(mode); }, [mode]);

  useEffect(() => {
    const mount = mountRef.current!;
    const { renderer, scene, camera, ro, tier, governor } = baseSetup(mount, 42, 8.6);
    scene.fog = new THREE.FogExp2(0x07060c, 0.028);

    // ---- studio environment: softbox strips the chrome can actually reflect.
    // PMREM bakes it once (~ms); runtime cost is zero. This is what makes
    // metalness:1 read as liquid chrome instead of black rubber.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x030308);
    const strip = (color: number, intensity: number, w: number, h: number, x: number, y: number, z: number, ry = 0) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
      );
      m.material.color.multiplyScalar(intensity);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      envScene.add(m);
    };
    strip(0xffffff, 6, 8, 1.2, 0, 4, 4);          // white key softbox above
    strip(0x9d6bff, 4, 7, 1.0, -5, 1.5, -1, Math.PI / 2); // violet strip left
    strip(0x22d3ee, 3, 6, 0.9, 5, 0.5, -1, -Math.PI / 2); // cyan strip right
    strip(0xfff4e0, 1.5, 10, 0.8, 0, -3.5, -3);   // warm bounce below
    scene.environment = pmrem.fromScene(envScene, 0.06).texture;
    pmrem.dispose();

    const world = new THREE.Group();
    scene.add(world);

    // ---- deep-space backdrop: starfield + twin nebulae (kills the black void) ----
    const starN = tier === 'low' ? 350 : tier === 'mid' ? 900 : 1500;
    const sPos = new Float32Array(starN * 3);
    for (let i = 0; i < starN; i++) {
      const d = new THREE.Vector3().randomDirection().multiplyScalar(38 + Math.random() * 42);
      sPos.set([d.x, Math.abs(d.y) * 0.7 + 1.5, d.z], i * 3);
    }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    const stars = new THREE.Points(sGeo, new THREE.PointsMaterial({
      color: 0xffffff, size: 0.35, sizeAttenuation: true,
      transparent: true, opacity: 1.0, depthWrite: false,
    }));
    world.add(stars);
    // standout beacons: 12 bright stars so the field has heroes, not just dust
    const beaconTex = makeGlowTexture('rgba(255,255,255,0.95)', 'rgba(180,210,255,0.25)');
    const starBeacons: THREE.Sprite[] = [];
    for (let i = 0; i < (tier === 'low' ? 6 : 12); i++) {
      const b = makeSoftSprite(beaconTex, 0xffffff, 1.6 + Math.random() * 1.4, 1.0);
      const d = new THREE.Vector3().randomDirection();
      b.position.set(d.x * 34, Math.abs(d.y) * 0.6 * 34 + 3, d.z * 34);
      world.add(b);
      starBeacons.push(b);
    }
    const nebTexA = makeGlowTexture('rgba(190,140,255,0.65)', 'rgba(100,50,200,0.22)');
    const nebA = makeSoftSprite(nebTexA, 0xb478ff, 38, 1.0);
    nebA.position.set(-12, 6, -20);
    world.add(nebA);
    const nebA2 = makeSoftSprite(nebTexA, 0x8a4dff, 22, 0.9);
    nebA2.position.set(-9, 3.5, -16);
    world.add(nebA2);
    const nebTexB = makeGlowTexture('rgba(34,211,238,0.55)', 'rgba(20,120,160,0.2)');
    const nebB = makeSoftSprite(nebTexB, 0x22d3ee, 34, 0.8);
    nebB.position.set(13, 1, -19);
    world.add(nebB);
    const nebB2 = makeSoftSprite(nebTexB, 0x18b0d8, 18, 0.7);
    nebB2.position.set(10, 4, -15);
    world.add(nebB2);

    // ---- liquid chrome knot ----
    const knot = new THREE.Mesh(
      new THREE.TorusKnotGeometry(1.25, 0.4, tier === 'low' ? 200 : 340, tier === 'low' ? 26 : 36),
      new THREE.MeshStandardMaterial({ color: 0xdfe3ec, metalness: 1.0, roughness: 0.09, envMapIntensity: 1.6 })
    );
    knot.position.y = 0.55;
    world.add(knot);

    // ---- violet pedestal + floor ----
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(2.3, 2.5, 0.16, 48),
      new THREE.MeshStandardMaterial({ color: 0x0c0a12, metalness: 0.8, roughness: 0.4 })
    );
    pedestal.position.y = -1.7;
    world.add(pedestal);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(2.32, 0.035, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0x9d6bff, transparent: true, opacity: 0.95 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -1.61;
    world.add(rim);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(11, 48),
      new THREE.MeshStandardMaterial({ color: 0x050409, metalness: 0.9, roughness: 0.18 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.79;
    world.add(floor);
    // concentric floor rings: the stage reads against the void
    const floorRings: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const fr = new THREE.Mesh(
        new THREE.TorusGeometry(3.2 + i * 2.1, 0.008, 6, 90),
        new THREE.MeshBasicMaterial({ color: i === 1 ? 0xc084fc : 0x9d6bff, transparent: true, opacity: 0.5 - i * 0.09 })
      );
      fr.rotation.x = Math.PI / 2;
      fr.position.y = -1.78;
      world.add(fr);
      floorRings.push(fr);
    }

    const glowTex = makeGlowTexture('rgba(190,150,255,0.85)', 'rgba(120,60,255,0.2)');
    const underGlow = makeSoftSprite(glowTex, 0x9d6bff, 8, 0.75);
    underGlow.position.y = -1.2;
    world.add(underGlow);

    // ---- chrome beads on elliptical orbits ----
    const beadMat = new THREE.MeshStandardMaterial({ color: 0xe8ecf5, metalness: 1.0, roughness: 0.06, envMapIntensity: 1.8 });
    const beads: { mesh: THREE.Mesh; tilt: number; r: number; speed: number; phase: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.09 + Math.random() * 0.05, 16, 16), beadMat);
      world.add(b);
      beads.push({
        mesh: b, tilt: Math.random() * Math.PI, r: 2.1 + Math.random() * 0.7,
        speed: 0.3 + Math.random() * 0.4, phase: Math.random() * Math.PI * 2,
      });
    }

    // ---- the canary token (the escaping secret) + scan ring ----
    const canaryTex = makeGlowTexture('rgba(255,120,120,0.95)', 'rgba(255,60,60,0.3)');
    const canary = makeSoftSprite(canaryTex, 0xff5566, 0.9, 0);
    canary.position.set(0, 0.55, 0);
    world.add(canary);
    const scanRing = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.014, 8, 90),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0 })
    );
    scanRing.rotation.x = Math.PI / 2;
    scanRing.position.y = 0.55;
    world.add(scanRing);

    // ---- studio lighting (fake HDRI for liquid chrome) ----
    scene.add(new THREE.AmbientLight(0x2a2440, 0.9));
    const key = new THREE.PointLight(0xffffff, 30, 30); key.position.set(4, 5, 3); scene.add(key);
    const fill = new THREE.PointLight(0x9d6bff, 14, 24); fill.position.set(-4, 1.5, -2); scene.add(fill);
    const cyanRim = new THREE.PointLight(0x22d3ee, 9, 20); cyanRim.position.set(0, -1, 5); scene.add(cyanRim);

    const orbit = useOrbit(mount, world, onFirstGrab);

    let m = modeRef.current || 'idle';
    let modeT = 0;
    apiRef.current = { setMode: (nm: string) => { m = nm || 'idle'; modeT = 0; } };
    apiRef.current.setMode(modeRef.current || 'idle'); // sync any mode that arrived during mount

    const clock = new FrameClock();
    let raf = 0;
    const canaryColor = new THREE.Color(0xff5566);
    const redactedColor = new THREE.Color(0x3ddc97);
    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (document.hidden) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      governor.tick(dt);
      const t = clock.elapsedTime;
      modeT += dt;

      orbit.update(dt);
      knot.rotation.y += dt * (m === 'dispatching' ? 1.4 : 0.18);
      knot.rotation.x = Math.sin(t * 0.3) * 0.15;
      beads.forEach((b) => {
        const a = t * b.speed + b.phase;
        b.mesh.position.set(
          Math.cos(a) * b.r,
          0.55 + Math.sin(a + b.tilt) * 0.55,
          Math.sin(a) * b.r * 0.8
        );
      });

      if (m === 'dispatching') {
        // the secret tries to escape: token drifts out of the knot
        const p = Math.min(modeT / 1.4, 1);
        canary.material.opacity = 1;
        canary.position.set(p * 2.1, 0.55 + p * 0.9, p * 0.6);
        canary.material.color.setHex(0xff5566);
      } else if (m === 'redacted') {
        // scan ring sweeps out; when it passes the canary, the token is scrubbed
        const sweep = Math.min(modeT * 2.2, 3.4);
        scanRing.position.y = 0.55;
        scanRing.scale.setScalar(Math.max(sweep, 0.01));
        (scanRing.material as THREE.MeshBasicMaterial).opacity = sweep < 3.2 ? 0.8 : Math.max(0, 0.8 - (modeT - 1.6) * 1.2);
        canary.material.color.lerp(redactedColor, dt * 4);
        canary.material.opacity = Math.max(0, 1 - Math.max(modeT - 1.4, 0) * 1.2);
        // pulled back toward the knot (contained)
        canary.position.multiplyScalar(1 - dt * 1.2);
      } else if (m === 'blocked') {
        canary.material.color.setHex(0xef4444);
        canary.material.opacity = Math.max(0, 1 - modeT * 1.5);
        canary.position.multiplyScalar(1 - dt * 2.5);
      } else {
        // idle: token hidden inside the knot
        canary.material.opacity = Math.max(0, canary.material.opacity - dt);
        canary.position.set(0, 0.55, 0);
        canary.material.color.copy(canaryColor);
        (scanRing.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (scanRing.material as THREE.MeshBasicMaterial).opacity - dt);
        scanRing.scale.setScalar(0.01);
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      orbit.cleanup();
      disposeScene(scene, renderer, ro, mount);
    };
  }, []);

  return <div ref={mountRef} className="absolute inset-0" aria-hidden style={{ touchAction: 'none' }} />;
}

/* ------------------------------------------------------------------ */
/* SC-03 — EGRESS BOUNDARY: cloud over water, SSRF blocked at the ring  */
/* ------------------------------------------------------------------ */

export function EgressBoundary({ mode = 'idle', onFirstGrab }: WorldProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef(mode);
  const apiRef = useRef<{ setMode: (m: string) => void } | null>(null);
  useEffect(() => { modeRef.current = mode; if (apiRef.current) apiRef.current.setMode(mode); }, [mode]);

  useEffect(() => {
    const mount = mountRef.current!;
    const { renderer, scene, camera, ro, tier, governor } = baseSetup(mount, 48, 11);
    renderer.toneMapping = THREE.NoToneMapping; // authored palette, keep exact colors
    camera.position.set(0, 2.6, 10.5);
    camera.lookAt(0, 1.8, 0);

    // ---- pastel sky gradient ----
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 4; skyCanvas.height = 256;
    const sctx = skyCanvas.getContext('2d')!;
    const skyGrad = sctx.createLinearGradient(0, 0, 0, 256);
    skyGrad.addColorStop(0, '#2a3f66');
    skyGrad.addColorStop(0.42, '#7a9cc4');
    skyGrad.addColorStop(0.68, '#d9c2ae');
    skyGrad.addColorStop(1, '#f0b896');
    sctx.fillStyle = skyGrad;
    sctx.fillRect(0, 0, 4, 256);
    const skyTex = new THREE.CanvasTexture(skyCanvas);
    scene.background = skyTex;
    scene.fog = new THREE.Fog(0xbcd2e4, 22, 52);

    const world = new THREE.Group();
    scene.add(world);

    // ---- iridescent cumulus: structured cloud, NormalBlending so puffs
    // layer as VOLUME instead of stacking into a white-hot sunburst ----
    // puff texture: hard-ish edge — reads as a cumulus lobe, not lens bokeh
    const puffCanvas = document.createElement('canvas');
    puffCanvas.width = puffCanvas.height = 256;
    const pctx = puffCanvas.getContext('2d')!;
    const pg = pctx.createRadialGradient(128, 110, 10, 128, 128, 126);
    pg.addColorStop(0, 'rgba(255,255,255,1)');
    pg.addColorStop(0.55, 'rgba(255,255,255,0.92)');
    pg.addColorStop(0.8, 'rgba(255,255,255,0.45)');
    pg.addColorStop(1, 'rgba(255,255,255,0)');
    pctx.fillStyle = pg;
    pctx.fillRect(0, 0, 256, 256);
    const cloudTex = new THREE.CanvasTexture(puffCanvas);
    cloudTex.anisotropy = 8;
    const pastels = [0xffffff, 0xffffff, 0xfff2f6, 0xffe8f0, 0xffffff]; // one family: white + blush pink
    const cloudPuffs: { s: THREE.Sprite; seed: number; base: THREE.Vector3 }[] = [];
    const puffCount = tier === 'low' ? 30 : tier === 'mid' ? 48 : 64;
    const puffMat = (c: number, o: number) => new THREE.SpriteMaterial({
      map: cloudTex, color: c, transparent: true, opacity: o,
      depthWrite: false, blending: THREE.NormalBlending,
    });
    for (let i = 0; i < puffCount; i++) {
      // cumulus: flat collective base at y~1.1, lobes mound above it,
      // tighter xz spread so the mass holds ONE silhouette
      const spread = Math.pow(Math.random(), 1.4);
      const angle = Math.random() * Math.PI * 2;
      const radius = spread * 2.6;
      const mound = Math.pow(Math.random(), 0.8) * 1.6 * (1 - spread * 0.55);
      const c = pastels[i % pastels.length];
      const s = new THREE.Sprite(puffMat(c, 0.72 + Math.random() * 0.2));
      s.scale.setScalar(1.4 + Math.random() * 1.8);
      s.position.set(
        Math.cos(angle) * radius + 1.4,
        1.0 + mound,
        Math.sin(angle) * radius * 0.5 - 2.6
      );
      world.add(s);
      cloudPuffs.push({ s, seed: Math.random() * Math.PI * 2, base: s.position.clone() });
    }
    // sun: small warm disc ABOVE the cloud, not a mega-bloom in the middle
    const coreTex = makeGlowTexture('rgba(255,230,190,0.95)', 'rgba(255,170,90,0.3)');
    const coreGlow = makeSoftSprite(coreTex, 0xffd9a8, 1.6, 0.45);
    coreGlow.position.set(3.6, 4.8, -2);
    world.add(coreGlow);
    // crisp solar disc: tiny, bright, unmistakably a sun
    const sunCanvas = document.createElement('canvas');
    sunCanvas.width = sunCanvas.height = 128;
    const sunCtx = sunCanvas.getContext('2d')!;
    const sunGrad = sunCtx.createRadialGradient(64, 64, 4, 64, 64, 64);
    sunGrad.addColorStop(0, 'rgba(255,250,230,1)');
    sunGrad.addColorStop(0.4, 'rgba(255,240,200,1)');
    sunGrad.addColorStop(0.55, 'rgba(255,220,150,0.6)');
    sunGrad.addColorStop(1, 'rgba(255,200,120,0)');
    sunCtx.fillStyle = sunGrad;
    sunCtx.fillRect(0, 0, 128, 128);
    const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(sunCanvas), transparent: true, opacity: 1,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    sunDisc.scale.setScalar(0.95);
    sunDisc.position.set(3.7, 5.0, -2);
    world.add(sunDisc);

    // ---- boundary rings with glowing orbs ----
    const ringGroup = new THREE.Group();
    world.add(ringGroup);
    const patrolOrbs: THREE.Sprite[] = [];
    for (let i = 0; i < (tier === 'high' ? 3 : 2); i++) {
      const holder = new THREE.Group();
      holder.rotation.set(0.3 + i * 0.5, i * 1.4, 0.22 * (i + 1));
      const R = 4.4 + i * 1.2;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(R, 0.018, 6, 120),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 })
      );
      holder.add(ring);
      const n = 7;
      for (let b = 0; b < n; b++) {
        const orb = makeSoftSprite(cloudTex, 0xfff4e0, 0.55, 0.95);
        const a = (b / n) * Math.PI * 2;
        orb.position.set(Math.cos(a) * R, 0, Math.sin(a) * R);
        holder.add(orb);
        patrolOrbs.push(orb);
      }
      ringGroup.add(holder);
    }

    // ---- water ----
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(18, 48),
      new THREE.MeshStandardMaterial({ color: 0x3d6b80, metalness: 0.7, roughness: 0.22 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = -2.2;
    world.add(water);
    // horizon glow: a warm line where sea meets sky — reads instantly as a coast
    // amber horizon strip — a WIDE flat glow, elongated along the horizon
    const stripCanvas = document.createElement('canvas');
    stripCanvas.width = 256; stripCanvas.height = 32;
    const stCtx = stripCanvas.getContext('2d')!;
    const stG = stCtx.createLinearGradient(0, 0, 256, 0);
    stG.addColorStop(0, 'rgba(255,190,130,0)');
    stG.addColorStop(0.5, 'rgba(255,214,160,0.9)');
    stG.addColorStop(1, 'rgba(255,190,130,0)');
    stCtx.fillStyle = stG;
    stCtx.fillRect(0, 0, 256, 32);
    const stripTex = new THREE.CanvasTexture(stripCanvas);
    const horizonStrip = new THREE.Sprite(new THREE.SpriteMaterial({
      map: stripTex, color: 0xffd6aa, transparent: true, opacity: 0.9,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    horizonStrip.scale.set(30, 1.1, 1);
    horizonStrip.position.set(0, -2.05, -12);
    horizonStrip.material.opacity = 1.0;
    world.add(horizonStrip);


    // ---- request streak (the SSRF attempt) + shield ripple ----
    const streakTex = makeGlowTexture('rgba(255,255,255,0.95)', 'rgba(255,120,120,0.35)');
    const streak = makeSoftSprite(streakTex, 0xffffff, 0.8, 0);
    world.add(streak);
    const ripple = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.03, 8, 90),
      new THREE.MeshBasicMaterial({ color: 0xff8899, transparent: true, opacity: 0 })
    );
    ripple.rotation.set(0.3, 1.4, 0.22); // aligned with first ring
    world.add(ripple);

    // ---- lights ----
    scene.add(new THREE.AmbientLight(0xf0e0e8, 1.4));
    const sun = new THREE.DirectionalLight(0xffe8d0, 2.2); sun.position.set(5, 6, 3); scene.add(sun);
    const cool = new THREE.DirectionalLight(0xa8c8ff, 0.8); cool.position.set(-4, 3, -3); scene.add(cool);

    const orbit = useOrbit(mount, world, onFirstGrab);

    let m = modeRef.current || 'idle';
    let modeT = 0;
    apiRef.current = { setMode: (nm: string) => { m = nm || 'idle'; modeT = 0; } };
    apiRef.current.setMode(modeRef.current || 'idle'); // sync any mode that arrived during mount

    const clock = new FrameClock();
    let raf = 0;
    const RAY_DIR = new THREE.Vector3(1, 0.05, 0.35).normalize();
    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (document.hidden) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      governor.tick(dt);
      const t = clock.elapsedTime;
      modeT += dt;

      orbit.update(dt);
      ringGroup.children.forEach((h, i) => { h.rotation.y += dt * (0.1 + i * 0.06); });

      // cloud breathing
      cloudPuffs.forEach((p) => {
        p.s.position.y = p.base.y + Math.sin(t * 0.6 + p.seed) * 0.12;
        p.s.position.x = p.base.x + Math.cos(t * 0.4 + p.seed) * 0.08;
      });
      coreGlow.scale.setScalar(6.2 + Math.sin(t * 0.8) * 0.5);
      // gentle water shimmer
      (water.material as THREE.MeshStandardMaterial).roughness = 0.2 + Math.sin(t * 0.7) * 0.05;

      if (m === 'dispatching') {
        // request streak fires from the cloud toward the boundary
        const p = Math.min(modeT / 1.2, 1);
        streak.material.opacity = 0.95;
        streak.material.color.setHex(0xffffff);
        streak.position.copy(RAY_DIR).multiplyScalar(1.2 + p * 3.4).setY(1.2 + p * 0.3);
      } else if (m === 'blocked') {
        // hits the wall at ring radius: shield ripple flashes, streak dissolves red
        const p = Math.min(modeT / 0.6, 1);
        streak.material.color.setHex(0xff5566);
        streak.material.opacity = Math.max(0, 1 - p);
        streak.position.copy(RAY_DIR).multiplyScalar(4.6).setY(1.5);
        ripple.scale.setScalar(0.01 + p * 2.2);
        ripple.position.copy(streak.position);
        (ripple.material as THREE.MeshBasicMaterial).opacity = p < 1 ? 0.85 : Math.max(0, 0.85 - (modeT - 0.6) * 1.4);
      } else {
        streak.material.opacity = Math.max(0, streak.material.opacity - dt * 2);
        (ripple.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (ripple.material as THREE.MeshBasicMaterial).opacity - dt * 1.5);
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      orbit.cleanup();
      disposeScene(scene, renderer, ro, mount);
    };
  }, []);

  return <div ref={mountRef} className="absolute inset-0" aria-hidden style={{ touchAction: 'none' }} />;
}

/* ------------------------------------------------------------------ */
/* SC-04r — FILESYSTEM ISLAND: floating oak, corrupted write rejected   */
/* ------------------------------------------------------------------ */

export function FilesystemIsland({ mode = 'idle', onFirstGrab }: WorldProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef(mode);
  const apiRef = useRef<{ setMode: (m: string) => void } | null>(null);
  useEffect(() => { modeRef.current = mode; if (apiRef.current) apiRef.current.setMode(mode); }, [mode]);

  useEffect(() => {
    const mount = mountRef.current!;
    const { renderer, scene, camera, ro, tier, governor } = baseSetup(mount, 40, 8.2);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    camera.position.set(3.0, 3.2, 15.0);
    camera.lookAt(0.5, 2.5, 0);

    // Deep atmospheric dawn fog that blends seamlessly into the horizon
    scene.fog = new THREE.Fog(0x223647, 48, 125);

    // ---- High-Resolution Panoramic Dawn Sky Backdrop ----
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 32; skyCanvas.height = 512;
    const sCtx = skyCanvas.getContext('2d')!;
    const sGrad = sCtx.createLinearGradient(0, 0, 0, 512);
    sGrad.addColorStop(0.00, '#0a1928'); // deep oceanic zenith
    sGrad.addColorStop(0.25, '#16354d'); // twilight blue
    sGrad.addColorStop(0.50, '#2d5873'); // misty atmosphere
    sGrad.addColorStop(0.68, '#6d6974'); // morning lilac
    sGrad.addColorStop(0.80, '#d97d52'); // radiant dawn amber
    sGrad.addColorStop(0.90, '#f9be7b'); // golden horizon alpenglow
    sGrad.addColorStop(1.00, '#e5d7c8'); // warm sea horizon
    sCtx.fillStyle = sGrad;
    sCtx.fillRect(0, 0, 32, 512);
    const skyTexture = new THREE.CanvasTexture(skyCanvas);
    scene.background = skyTexture;

    // Curved cyclorama backdrop plane so Reflector & camera see the warm horizon
    const backdropGeo = new THREE.PlaneGeometry(240, 80);
    const backdropMat = new THREE.MeshBasicMaterial({
      map: skyTexture,
      side: THREE.DoubleSide,
      fog: false,
    });
    const skyBackdrop = new THREE.Mesh(backdropGeo, backdropMat);
    skyBackdrop.position.set(0, 16, -65);
    scene.add(skyBackdrop);

    // Soft celestial morning sun disc
    const sunDiscTex = makeGlowTexture('rgba(255,248,230,1.0)', 'rgba(255,185,110,0.3)');
    const sunDisc = makeSoftSprite(sunDiscTex, 0xfff4db, 14, 0.85);
    sunDisc.position.set(12, 18, -60);
    scene.add(sunDisc);

    // ---- PMREM Environment Reflections ----
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x182c3c);
    const strip = (color: number, intensity: number, w: number, h: number, x: number, y: number, z: number, ry = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
      m.material.color.multiplyScalar(intensity);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      envScene.add(m);
    };
    strip(0xffdfa8, 4.5, 14, 4, 10, 8, 8);               // warm dawn key
    strip(0xff9966, 3.2, 12, 3, -8, 2, -2, Math.PI / 2); // alpenglow horizon strip
    strip(0x3898d4, 2.5, 10, 3, 8, 4, -4, -Math.PI / 2); // azure fill
    strip(0x0c3242, 2.0, 16, 3, 0, -5, -4);             // ocean deep bounce
    scene.environment = pmrem.fromScene(envScene, 0.05).texture;
    pmrem.dispose();

    const world = new THREE.Group();
    scene.add(world);
    world.position.x = 3.2;

    // =========================================================================
    // 1. HIGH-RESOLUTION FLOATING ISLAND (Sculpted Granite & Ancient Bedrock)
    // =========================================================================
    const islandCore = new THREE.Group();
    world.add(islandCore);

    // Lathe profile with geological stratifications and natural rock taper
    const rockProfile: THREE.Vector2[] = [];
    const RP = (h: number, r: number) => rockProfile.push(new THREE.Vector2(Math.max(r, 0.01), h));
    RP(1.05, 2.25); // top turf rim
    RP(0.85, 2.42); // rock overhang
    RP(0.55, 2.22);
    RP(0.15, 1.90);
    RP(-0.35, 1.55);
    RP(-0.90, 1.18);
    RP(-1.50, 0.82);
    RP(-2.15, 0.48);
    RP(-2.75, 0.22);
    RP(-3.20, 0.04); // keel tip

    const rockSegments = tier === 'low' ? 32 : 48;
    const rockGeo = new THREE.LatheGeometry(rockProfile, rockSegments);
    const pos = rockGeo.attributes.position as THREE.BufferAttribute;
    
    // Per-vertex geological strata sculpting using pure spatial harmonic functions
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const a = Math.atan2(z, x);
      const strata = Math.sin(y * 4.2 + a * 4) * 0.05 + Math.cos(a * 7 - y * 2.5) * 0.035;
      const crag = Math.sin(a * 11 + y * 5.5) * 0.02;
      const mult = 1 + strata + crag;
      pos.setXYZ(i, x * mult, y, z * mult);
    }
    rockGeo.computeVertexNormals();

    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x383e46,
      roughness: 0.82,
      metalness: 0.15,
      envMapIntensity: 1.0,
    });
    const rockMesh = new THREE.Mesh(rockGeo, rockMat);
    islandCore.add(rockMesh);

    // Floating satellite boulder shards hovering near the keel
    const shardGeo = new THREE.DodecahedronGeometry(0.24, 1);
    const shardMat = new THREE.MeshStandardMaterial({ color: 0x30363d, roughness: 0.85, metalness: 0.1 });
    const shards: THREE.Mesh[] = [];
    const shardPositions = [
      [1.6, -1.8, 0.6],
      [-1.4, -2.1, -0.4],
      [0.8, -2.6, -0.9],
      [-0.7, -2.4, 0.8],
    ];
    shardPositions.forEach(([sx, sy, sz]) => {
      const sh = new THREE.Mesh(shardGeo, shardMat);
      sh.position.set(sx, sy, sz);
      sh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      islandCore.add(sh);
      shards.push(sh);
    });

    // Glowing EROFS Kernel Cryptographic Veins running through fractures
    const veinMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00c4e2,
      emissiveIntensity: 0.95,
      roughness: 0.2,
      metalness: 0.8,
    });
    const vein1 = new THREE.Mesh(new THREE.TorusGeometry(1.72, 0.038, 10, 48), veinMat);
    vein1.rotation.x = Math.PI / 2 + 0.14;
    vein1.rotation.y = 0.25;
    vein1.position.set(0, -0.45, 0);
    islandCore.add(vein1);

    const vein2 = new THREE.Mesh(new THREE.TorusGeometry(1.22, 0.032, 10, 40), veinMat);
    vein2.rotation.x = Math.PI / 2 - 0.20;
    vein2.rotation.y = -0.32;
    vein2.position.set(0.08, -1.25, 0.05);
    islandCore.add(vein2);

    // Hanging Root Tendrils cascading off the cliffs
    const rootMat = new THREE.MeshStandardMaterial({
      color: 0x2b2118,
      roughness: 0.9,
      metalness: 0.05,
    });
    const makeRoot = (curvePts: THREE.Vector3[], radius: number) => {
      const curve = new THREE.CatmullRomCurve3(curvePts);
      const geo = new THREE.TubeGeometry(curve, 18, radius, 8, false);
      return new THREE.Mesh(geo, rootMat);
    };

    const rootTendrils: THREE.Mesh[] = [
      makeRoot([new THREE.Vector3(2.0, 0.8, 0.4), new THREE.Vector3(2.2, 0.1, 0.5), new THREE.Vector3(1.9, -0.8, 0.45), new THREE.Vector3(1.7, -1.8, 0.4)], 0.045),
      makeRoot([new THREE.Vector3(-1.9, 0.85, 0.6), new THREE.Vector3(-2.05, 0.1, 0.7), new THREE.Vector3(-1.8, -1.0, 0.6), new THREE.Vector3(-1.5, -2.2, 0.5)], 0.048),
      makeRoot([new THREE.Vector3(0.5, 0.82, -1.9), new THREE.Vector3(0.7, 0.0, -2.0), new THREE.Vector3(0.5, -1.2, -1.8), new THREE.Vector3(0.35, -2.3, -1.6)], 0.04),
      makeRoot([new THREE.Vector3(-0.9, 0.9, -1.7), new THREE.Vector3(-1.15, 0.25, -1.8), new THREE.Vector3(-0.9, -0.7, -1.6)], 0.038),
    ];
    rootTendrils.forEach((r) => islandCore.add(r));

    // Lush undulating turf top
    const turfGeo = new THREE.CylinderGeometry(2.45, 2.28, 0.35, rockSegments, 3);
    const turfPos = turfGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < turfPos.count; i++) {
      const tx = turfPos.getX(i), ty = turfPos.getY(i), tz = turfPos.getZ(i);
      if (ty > 0.05) {
        const d = Math.sqrt(tx * tx + tz * tz);
        const mound = Math.max(0, (2.1 - d) * 0.15) + Math.sin(tx * 3.5 + tz * 2.8) * 0.035;
        turfPos.setY(i, ty + mound);
      }
    }
    turfGeo.computeVertexNormals();

    const turfMat = new THREE.MeshStandardMaterial({
      color: 0x487f32,
      roughness: 0.85,
      metalness: 0.06,
      envMapIntensity: 0.8,
    });
    const turf = new THREE.Mesh(turfGeo, turfMat);
    turf.position.y = 1.02;
    islandCore.add(turf);

    // =========================================================================
    // 2. THE ANCIENT GREAT OAK (Smooth High-Poly Trunk + Organic Canopy)
    // =========================================================================
    const tree = new THREE.Group();
    const barkMat = new THREE.MeshStandardMaterial({
      color: 0x423224,
      roughness: 0.88,
      metalness: 0.05,
      envMapIntensity: 0.6,
    });

    const trunkProfile: THREE.Vector2[] = [];
    const TP = (h: number, r: number) => trunkProfile.push(new THREE.Vector2(r, h));
    TP(0.00, 0.72); // wide root buttress
    TP(0.14, 0.58);
    TP(0.38, 0.40);
    TP(0.75, 0.33); // slender waist
    TP(1.15, 0.36); // burl shoulder
    TP(1.60, 0.30);
    TP(2.00, 0.24);
    TP(2.35, 0.16); // crown stem
    TP(2.60, 0.08);

    const trunkGeo = new THREE.LatheGeometry(trunkProfile, tier === 'low' ? 18 : 32);
    const tp = trunkGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < tp.count; i++) {
      const x = tp.getX(i), y = tp.getY(i), z = tp.getZ(i);
      const angle = Math.atan2(z, x);
      const barkGroove = Math.sin(angle * 10 + y * 2.2) * 0.04 + Math.cos(angle * 5) * 0.025;
      const buttress = (y < 0.45) ? Math.pow(Math.cos(angle * 3.5), 2) * 0.09 : 0;
      const m = 1 + barkGroove + buttress;
      tp.setXYZ(i, x * m, y, z * m);
    }
    trunkGeo.computeVertexNormals();

    const trunk = new THREE.Mesh(trunkGeo, barkMat);
    trunk.position.y = 1.08;
    tree.add(trunk);

    // Natural curving boughs
    const makeBough = (pts: THREE.Vector3[], r0: number, r1: number) => {
      const curve = new THREE.CatmullRomCurve3(pts);
      const geo = new THREE.TubeGeometry(curve, 16, r0, 12, false);
      const p = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const u = Math.floor(i / 13) / 16;
        const curR = r0 * (1 - u) + r1 * u;
        const scale = curR / r0;
        p.setXYZ(i, p.getX(i) * scale, p.getY(i), p.getZ(i) * scale);
      }
      geo.computeVertexNormals();
      return new THREE.Mesh(geo, barkMat);
    };

    const bough1 = makeBough([
      new THREE.Vector3(0.05, 2.85, 0.02),
      new THREE.Vector3(0.55, 3.3, 0.25),
      new THREE.Vector3(1.35, 3.6, 0.45),
      new THREE.Vector3(1.85, 3.9, 0.6),
    ], 0.13, 0.045);
    tree.add(bough1);

    const bough2 = makeBough([
      new THREE.Vector3(-0.05, 2.75, 0.0),
      new THREE.Vector3(-0.65, 3.15, -0.2),
      new THREE.Vector3(-1.3, 3.45, -0.35),
      new THREE.Vector3(-1.75, 3.7, -0.45),
    ], 0.12, 0.04);
    tree.add(bough2);

    const bough3 = makeBough([
      new THREE.Vector3(0.0, 2.95, -0.05),
      new THREE.Vector3(0.1, 3.5, -0.55),
      new THREE.Vector3(0.2, 4.0, -0.9),
    ], 0.10, 0.038);
    tree.add(bough3);

    // Volumetric Lush Canopy (Smooth Subdivided Spheres with Spatial Harmonic Bulges)
    // Pure spatial functions — zero index dependencies for butter-smooth organic leaf clouds
    const leafPalette = [
      0x4a8532, // sunlit lime-olive
      0x325f20, // deep forest shadow
      0x58953c, // radiant leaf green
      0x3e7428, // rich midtone
      0x68a544, // dawn highlight
      0x2c531c, // under-canopy emerald
    ];

    const canopy: THREE.Mesh[] = [];
    const canopyClusters: [number, number, number, number, number][] = [
      [1.6, 4.0, 0.55, 0.74, 0],
      [2.15, 3.8, 0.75, 0.58, 2],
      [-1.5, 3.8, -0.4, 0.70, 1],
      [-1.98, 3.6, -0.55, 0.54, 3],
      [0.2, 4.2, -0.85, 0.64, 2],
      [0.05, 4.3, 0.15, 0.88, 4],
      [0.78, 4.5, 0.2, 0.62, 0],
      [-0.68, 4.4, -0.1, 0.60, 3],
      [0.15, 4.9, 0.0, 0.54, 4],
      [0.98, 3.5, 0.5, 0.50, 1],
      [-0.95, 3.4, -0.3, 0.48, 5],
      [0.0, 3.75, 0.65, 0.52, 2],
    ];

    canopyClusters.forEach(([cx, cy, cz, cr, cIdx]) => {
      // Smooth SphereGeometry (22 width, 18 height segments) for completely facet-free volume
      const g = new THREE.SphereGeometry(cr, tier === 'low' ? 14 : 22, tier === 'low' ? 12 : 18);
      const gp = g.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < gp.count; k++) {
        const vx = gp.getX(k), vy = gp.getY(k), vz = gp.getZ(k);
        // Pure spatial harmonic displacement
        const b1 = Math.sin(vx * 4.2 + cy) * Math.cos(vy * 3.8 + cx) * 0.10;
        const b2 = Math.cos(vz * 4.5 + cz) * 0.06;
        const mult = 1 + b1 + b2;
        gp.setXYZ(k, vx * mult, vy * (1 + b1 * 0.6), vz * mult);
      }
      g.computeVertexNormals();

      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
        color: leafPalette[cIdx % leafPalette.length],
        roughness: 0.80,
        metalness: 0.04,
        envMapIntensity: 0.7,
      }));
      m.position.set(cx, cy + 0.8, cz);
      tree.add(m);
      canopy.push(m);
    });

    islandCore.add(tree);

    // Glowing Bio-luminescent Spore Motes orbiting the Canopy
    const sporeCount = tier === 'low' ? 12 : 24;
    const sporeGeo = new THREE.BufferGeometry();
    const sporePositions = new Float32Array(sporeCount * 3);
    const sporeSeeds = new Float32Array(sporeCount);
    for (let i = 0; i < sporeCount; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 1.0 + Math.random() * 2.2;
      sporePositions[i * 3] = Math.cos(ang) * rad;
      sporePositions[i * 3 + 1] = 3.6 + Math.random() * 2.5;
      sporePositions[i * 3 + 2] = Math.sin(ang) * rad;
      sporeSeeds[i] = Math.random() * 10;
    }
    sporeGeo.setAttribute('position', new THREE.BufferAttribute(sporePositions, 3));
    const sporeTex = makeGlowTexture('rgba(210,255,190,1.0)', 'rgba(120,250,170,0.35)');
    const sporeMat = new THREE.PointsMaterial({
      color: 0x9eff75,
      size: 0.42,
      map: sporeTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sporeField = new THREE.Points(sporeGeo, sporeMat);
    tree.add(sporeField);

    // =========================================================================
    // 3. MAJESTIC ALPINE MOUNTAIN MASSIFS (Horizon Ridge with Alpenglow)
    // =========================================================================
    const makeMassif = (height: number, baseRadius: number, seed: number) => {
      const radialSegs = tier === 'low' ? 24 : 44;
      const heightSegs = tier === 'low' ? 12 : 20;
      const geo = new THREE.ConeGeometry(baseRadius, height, radialSegs, heightSegs);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const colors = new Float32Array(pos.count * 3);

      const snowLine = height * 0.58;
      const rockDeep = new THREE.Color(0x273444);
      const rockMid = new THREE.Color(0x445568);
      const snowAlpenglow = new THREE.Color(0xfff3e6);

      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const elevation = y + height / 2;
        const angle = Math.atan2(z, x);

        // Craggy ridges and couloirs
        const ridge1 = Math.sin(angle * 5 + seed) * 0.28;
        const ridge2 = Math.cos(angle * 11 + elevation * 0.8) * 0.12;
        const crag = Math.sin(elevation * 3.5 + angle * 7) * 0.05;
        const displacement = 1 + ridge1 + ridge2 + crag;

        pos.setXYZ(i, x * displacement, y, z * displacement);

        const snowVariation = snowLine + Math.sin(angle * 6 + seed) * (height * 0.08);
        let vertexCol: THREE.Color;
        if (elevation > snowVariation) {
          const snowFade = Math.min(1, (elevation - snowVariation) / (height * 0.14));
          vertexCol = rockMid.clone().lerp(snowAlpenglow, snowFade);
        } else {
          const rockFade = elevation / snowLine;
          vertexCol = rockDeep.clone().lerp(rockMid, rockFade);
        }
        colors[i * 3] = vertexCol.r;
        colors[i * 3 + 1] = vertexCol.g;
        colors[i * 3 + 2] = vertexCol.b;
      }

      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      return geo;
    };

    const mountainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.80,
      metalness: 0.12,
      envMapIntensity: 0.9,
    });

    const mountainDefs = [
      { h: 24, b: 7.8, x: -11.0, z: -25, seed: 2.4 },  // Western Peak
      { h: 29, b: 9.2, x: 1.0, z: -29, seed: 5.8 },    // Imperial Central Massif
      { h: 23, b: 7.2, x: 12.5, z: -23, seed: 8.1 },   // Eastern Ridge
    ];

    mountainDefs.forEach((d) => {
      const massif = new THREE.Mesh(makeMassif(d.h, d.b, d.seed), mountainMat);
      massif.position.set(d.x, -5.2, d.z);
      world.add(massif);
    });

    // =========================================================================
    // 4. WATER SURFACE & TRUE PLANAR REFLECTOR MIRROR
    // =========================================================================
    const mirrorSize = 100;
    const mirror = new Reflector(new THREE.CircleGeometry(mirrorSize, 64), {
      clipBias: 0.003,
      textureWidth: tier === 'low' ? 512 : 1024,
      textureHeight: tier === 'low' ? 512 : 1024,
      color: 0xffffff,
    });
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.y = -4.6;
    scene.add(mirror);

    const waterGlaze = new THREE.Mesh(
      new THREE.CircleGeometry(mirrorSize - 1, 48),
      new THREE.MeshStandardMaterial({
        color: 0x113b4c,
        metalness: 0.18,
        roughness: 0.14,
        transparent: true,
        opacity: 0.58,
        envMapIntensity: 1.4,
      })
    );
    waterGlaze.rotation.x = -Math.PI / 2;
    waterGlaze.position.y = -4.55;
    scene.add(waterGlaze);

    // Floating island soft contact shadow on the mirror
    const shadowTex = makeGlowTexture('rgba(10,22,30,0.75)', 'rgba(10,22,30,0.18)');
    const floatShadow = makeSoftSprite(shadowTex, 0x06141a, 11.5, 0.72);
    floatShadow.position.set(0.2, -4.38, 0.3);
    world.add(floatShadow);

    // Atmosphere low mists over the water
    const mistTex = makeGlowTexture('rgba(255,255,255,0.4)', 'rgba(210,235,245,0.15)');
    const mists: { s: THREE.Sprite; seed: number; baseSpeed: number }[] = [];
    const mistCount = tier === 'low' ? 14 : 32;
    for (let i = 0; i < mistCount; i++) {
      const s = makeSoftSprite(mistTex, 0xe4f2f7, 7 + Math.random() * 5, 0.12 + Math.random() * 0.12);
      s.material.blending = THREE.NormalBlending;
      const a = Math.random() * Math.PI * 2;
      const rad = 3.5 + Math.random() * 5.5;
      s.position.set(Math.cos(a) * rad, -2.8 - Math.random() * 1.5, Math.sin(a) * rad);
      world.add(s);
      mists.push({ s, seed: Math.random() * 6.28, baseSpeed: 0.2 + Math.random() * 0.3 });
    }

    // =========================================================================
    // 5. DEFENSE DYNAMICS: EROFS KERNEL BOUNDARY & CORRUPTION REJECTION FX
    // =========================================================================
    const corruptGeo = new THREE.OctahedronGeometry(0.55, 1);
    const corruptMat = new THREE.MeshStandardMaterial({
      color: 0xff1e38,
      emissive: 0xbd001f,
      emissiveIntensity: 1.8,
      roughness: 0.2,
      metalness: 0.8,
      transparent: true,
      opacity: 0,
    });
    const corruptShard = new THREE.Mesh(corruptGeo, corruptMat);
    corruptShard.position.set(0.4, 5.0, 0.3);
    world.add(corruptShard);

    const corruptAuraTex = makeGlowTexture('rgba(255,40,60,0.95)', 'rgba(180,10,20,0.25)');
    const corruptAura = makeSoftSprite(corruptAuraTex, 0xff2244, 3.2, 0);
    corruptShard.add(corruptAura);

    // Cryptographic EROFS Read-Only Kernel Boundary Shield
    const shieldGeo = new THREE.TorusGeometry(3.1, 0.08, 16, 64);
    const shieldMat = new THREE.MeshStandardMaterial({
      color: 0x00f5ff,
      emissive: 0x00d9e6,
      emissiveIntensity: 1.5,
      roughness: 0.1,
      metalness: 0.9,
      transparent: true,
      opacity: 0,
    });
    const shield = new THREE.Mesh(shieldGeo, shieldMat);
    shield.rotation.x = Math.PI / 2;
    shield.position.y = 0.5;
    world.add(shield);

    const shieldGlowTex = makeGlowTexture('rgba(0,245,255,0.9)', 'rgba(0,180,220,0.25)');
    const shieldGlow = makeSoftSprite(shieldGlowTex, 0x00f5ff, 8.5, 0);
    shieldGlow.position.y = 0.5;
    world.add(shieldGlow);

    // Sparkling Defense Shockwave Sparks
    const sparkCount = tier === 'low' ? 12 : 28;
    const sparkTex = makeGlowTexture('rgba(255,255,255,1.0)', 'rgba(0,240,255,0.4)');
    const sparks: THREE.Sprite[] = [];
    for (let i = 0; i < sparkCount; i++) {
      const sp = makeSoftSprite(sparkTex, 0x38ef7d, 0.6 + Math.random() * 0.8, 0);
      world.add(sp);
      sparks.push(sp);
    }

    // =========================================================================
    // 6. CINEMATIC LIGHTING RIG
    // =========================================================================
    scene.add(new THREE.AmbientLight(0xdde8ef, 0.85));
    // Warm morning key sun
    const sun = new THREE.DirectionalLight(0xffdfa8, 4.6);
    sun.position.set(-11, 14, 15);
    scene.add(sun);
    // Cool ambient sky fill
    const skyFill = new THREE.DirectionalLight(0x78a6c8, 1.2);
    skyFill.position.set(12, 8, -6);
    scene.add(skyFill);
    // Sharp cyan cryptographic rim light
    const cyanRim = new THREE.DirectionalLight(0x00f5ff, 1.1);
    cyanRim.position.set(-6, 2, -12);
    scene.add(cyanRim);
    // Warm water mirror bounce
    const waterBounce = new THREE.DirectionalLight(0xf2a468, 0.85);
    waterBounce.position.set(2, -9, 8);
    scene.add(waterBounce);

    islandCore.position.y = 2.4;
    islandCore.rotation.z = 0.04;
    islandCore.rotation.x = 0.025;

    const orbit = useOrbit(mount, world, onFirstGrab);

    let m = modeRef.current || 'idle';
    let modeT = 0;
    apiRef.current = { setMode: (nm: string) => { m = nm || 'idle'; modeT = 0; } };
    apiRef.current.setMode(modeRef.current || 'idle');

    const clock = new FrameClock();
    let raf = 0;

    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (document.hidden) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      governor.tick(dt);
      const t = clock.elapsedTime;
      modeT += dt;

      orbit.update(dt);

      // Gentle organic breathing & floating physics
      world.position.y = Math.sin(t * 0.6) * 0.16;
      islandCore.rotation.z = 0.04 + Math.sin(t * 0.5) * 0.015;
      islandCore.rotation.x = 0.025 + Math.cos(t * 0.4) * 0.012;

      // Canopy leaf billow sways gently in the breeze
      canopy.forEach((b, i) => {
        b.scale.setScalar(1 + Math.sin(t * 1.5 + i * 0.9) * 0.035);
      });

      // Shard satellites gentle float
      shards.forEach((sh, idx) => {
        sh.rotation.x += dt * 0.4;
        sh.rotation.y += dt * 0.3;
        sh.position.y = shardPositions[idx][1] + Math.sin(t * 0.8 + idx) * 0.08;
      });

      // Bio-spores gentle orbital levitation
      const spPositions = sporeField.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < sporeCount; i++) {
        const curY = sporePositions[i * 3 + 1];
        spPositions.setY(i, curY + Math.sin(t * 1.8 + sporeSeeds[i]) * 0.004);
      }
      spPositions.needsUpdate = true;

      // Water mists drift
      mists.forEach((p) => {
        p.s.position.y += Math.sin(t * p.baseSpeed + p.seed) * 0.0018;
      });

      // Vein idle glow breathing
      veinMat.emissiveIntensity = 0.95 + Math.sin(t * 2.2) * 0.35;

      // Mode Choreography
      if (m === 'dispatching') {
        const p = Math.min(modeT / 1.1, 1);
        corruptMat.opacity = p;
        corruptAura.material.opacity = p * 0.85;
        corruptShard.position.set(0.4, 5.0 - p * 3.1, 0.3);
        corruptShard.rotation.y += dt * 3.5;
        corruptShard.rotation.x += dt * 2.0;

        shieldMat.opacity = Math.max(0, shieldMat.opacity - dt * 2);
        shieldGlow.material.opacity = Math.max(0, shieldGlow.material.opacity - dt * 2);
      } else if (m === 'detected' || m === 'denied' || m === 'blocked') {
        const flare = Math.min(modeT / 0.5, 1);
        const shieldScale = 0.4 + flare * 0.65;
        shield.scale.setScalar(shieldScale);
        shieldMat.opacity = flare * 0.95;
        shieldGlow.material.opacity = flare * 0.8;
        shield.rotation.z += dt * 1.2;

        veinMat.emissiveIntensity = 2.4;

        const repelled = Math.min(modeT / 0.6, 1);
        corruptShard.position.y += dt * 2.5;
        corruptMat.opacity = Math.max(0, 1 - repelled * 1.4);
        corruptAura.material.opacity = Math.max(0, 0.85 - repelled * 1.4);

        sparks.forEach((sp, idx) => {
          const spAngle = (idx / sparkCount) * Math.PI * 2 + t * 0.8;
          const spDist = 1.2 + flare * 2.4;
          sp.position.set(Math.cos(spAngle) * spDist, 1.8 + Math.sin(idx * 3 + t * 4) * 0.6, Math.sin(spAngle) * spDist);
          sp.material.opacity = Math.max(0, flare * (1 - (modeT - 0.3) * 0.7));
        });
      } else {
        corruptMat.opacity = Math.max(0, corruptMat.opacity - dt * 2.5);
        corruptAura.material.opacity = Math.max(0, corruptAura.material.opacity - dt * 2.5);
        shieldMat.opacity = Math.max(0, shieldMat.opacity - dt * 1.5);
        shieldGlow.material.opacity = Math.max(0, shieldGlow.material.opacity - dt * 1.5);
        sparks.forEach((sp) => {
          sp.material.opacity = Math.max(0, sp.material.opacity - dt * 2);
        });
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      orbit.cleanup();
      rockGeo.dispose();
      rockMat.dispose();
      veinMat.dispose();
      turfGeo.dispose();
      turfMat.dispose();
      trunkGeo.dispose();
      barkMat.dispose();
      mountainMat.dispose();
      sporeGeo.dispose();
      sporeMat.dispose();
      corruptGeo.dispose();
      corruptMat.dispose();
      shieldGeo.dispose();
      shieldMat.dispose();
      disposeScene(scene, renderer, ro, mount);
    };
  }, []);

  return <div ref={mountRef} className="absolute inset-0" aria-hidden style={{ touchAction: 'none' }} />;
}

/* ------------------------------------------------------------------ */
/* DISPATCHER — picks the world for the scenario                        */
/* ------------------------------------------------------------------ */

export function ScenarioScene({
  scenarioId,
  mode,
  onFirstGrab,
}: WorldProps & { scenarioId: string }) {
  const [grabbed, setGrabbed] = useState(false);
  const firstGrab = () => { if (!grabbed) { setGrabbed(true); onFirstGrab?.(); } };

  if (scenarioId === 'SC-01' || scenarioId === 'SC-01b') {
    return <NeuralGateway mode={mode} onFirstGrab={firstGrab} />;
  }
  if (scenarioId === 'SC-02') {
    return <CanaryKnot mode={mode} onFirstGrab={firstGrab} />;
  }
  if (scenarioId === 'SC-03') {
    return <EgressBoundary mode={mode} onFirstGrab={firstGrab} />;
  }
  if (scenarioId === 'SC-04r') {
    return <FilesystemIsland mode={mode} onFirstGrab={firstGrab} />;
  }
  return <CanaryKnot mode={mode} onFirstGrab={firstGrab} />;
}
