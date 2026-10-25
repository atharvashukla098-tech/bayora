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


// ---- adaptive fps governor: keeps 60fps on any potato ----
function makeGovernor(renderer: THREE.WebGLRenderer, maxPR: number) {
  let pr = maxPR;
  let accum = 0, frames = 0, cool = 0;
  const step = 0.75;
  const floor = 0.6;
  const apply = (v: number) => { pr = v; renderer.setPixelRatio(Math.min(v, window.devicePixelRatio || 1)); };
  return {
    tick(dt: number) {
      if (cool > 0) { cool -= dt; return; }
      accum += dt; frames++;
      if (frames < 30) return; // ~0.5s window at 60fps
      const avg = accum / frames;
      accum = 0; frames = 0; cool = 0.5;
      if (avg > 1 / 50 && pr > floor) {           // dropping below 50fps: shed pixels
        apply(Math.max(floor, +(pr - step).toFixed(2)));
      } else if (avg < 1 / 75 && pr < maxPR) {    // headroom: reclaim quality
        apply(Math.min(maxPR, +(pr + step * 0.5).toFixed(2)));
      }
    },
    get pixelRatio() { return pr; },
  };
}

function baseSetup(mount: HTMLDivElement, fov = 45, camZ = 8) {
  const tier = useTier();
  // max-def within potato limits: low 1.0 (potato laptops are 1366x768 @1x —
  // that's already native), mid up to 1.75, high up to 2. AA everywhere
  // except low tier.
  const PR_CAP = tier === 'low' ? 1.0 : tier === 'mid' ? 1.75 : 2.0;
  const PR = Math.min(window.devicePixelRatio || 1, PR_CAP);
  const renderer = new THREE.WebGLRenderer({ antialias: tier !== 'low', alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(PR);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
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
    renderer.toneMapping = THREE.NoToneMapping; // authored palette, keep exact colors

    // ---- PMREM studio environment: sky/water reflections on every material.
    // Baked once per mount; zero runtime cost. Sells the 3D read instantly.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x9db8cc);
    const strip = (color: number, intensity: number, w: number, h: number, x: number, y: number, z: number, ry = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
      m.material.color.multiplyScalar(intensity);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      envScene.add(m);
    };
    strip(0xfff2dc, 5, 9, 1.4, 0, 6, 6);            // warm sun softbox
    strip(0xffc9a0, 2.5, 8, 1.0, -6, 2, -2, Math.PI / 2);  // peach horizon strip
    strip(0x8fc4e8, 2, 7, 0.9, 6, 3, -2, -Math.PI / 2);   // sky-blue strip
    strip(0x4a8ca0, 1.5, 10, 0.8, 0, -4, -4);      // teal water bounce below
    scene.environment = pmrem.fromScene(envScene, 0.08).texture;
    pmrem.dispose();
    camera.position.set(3.4, 3.0, 15.5);
    camera.lookAt(0.6, 2.6, 0);
    scene.fog = new THREE.Fog(0xd8e4e8, 48, 110);
    // pastel sky gradient: pale blue -> warm peach at the horizon
    const skyC = document.createElement('canvas');
    skyC.width = 4; skyC.height = 256;
    const skyCtx = skyC.getContext('2d')!;
    const sg = skyCtx.createLinearGradient(0, 0, 0, 256);
    sg.addColorStop(0, '#7fa8cf');
    sg.addColorStop(0.35, '#bcd4de');
    sg.addColorStop(0.52, '#f5d4b8');
    sg.addColorStop(0.62, '#f7b98e');
    sg.addColorStop(0.7, '#f7ad7a');
    sg.addColorStop(1, '#e8c9a8');
    skyCtx.fillStyle = sg;
    skyCtx.fillRect(0, 0, 4, 256);
    scene.background = new THREE.CanvasTexture(skyC);

    const world = new THREE.Group();
    scene.add(world);
    world.position.x = 3.4; // island fully clear of the text column

    // ---- floating island: classic inverted-teardrop earth chunk ----
    // Lathe profile: flat grass-top rim, stone walls tapering DOWN to a
    // point (the iconic floating-island silhouette), gentle jitter only.
    const islandCore = new THREE.Group();
    world.add(islandCore);

    // (contact shadow handled by the floatShadow further below)
    const rockProfile: THREE.Vector2[] = [];
    const RP = (h: number, r: number) => rockProfile.push(new THREE.Vector2(Math.max(r, 0.001), h));
    RP(0.9, 1.9);   // top rim (grass line)
    RP(0.72, 2.05); // slight overhang bulge
    RP(0.4, 1.75);
    RP(0.0, 1.45);
    RP(-0.5, 1.0);  // taper begins
    RP(-1.2, 0.62);
    RP(-1.9, 0.30);
    RP(-2.5, 0.10); // tip
    const rockGeo = new THREE.LatheGeometry(rockProfile, tier === 'low' ? 9 : 14);
    const pos = rockGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      // gentle strata ripple — organic, not exploded
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const a = Math.atan2(z, x);
      const ripple = 1 + Math.sin(a * 6 + y * 2.2) * 0.045 + Math.sin(a * 11) * 0.02;
      pos.setXYZ(i, x * ripple, y, z * ripple);
    }
    rockGeo.computeVertexNormals();
    const rock = new THREE.Mesh(rockGeo, new THREE.MeshStandardMaterial({
      color: 0xa08a6c, roughness: 0.62, metalness: 0.08, flatShading: true, envMapIntensity: 1.2,
    }));
    islandCore.add(rock);
    // grass top: flat disc capping the island rim
    const grassTop = new THREE.Mesh(
      new THREE.CylinderGeometry(2.12, 1.92, 0.34, tier === 'low' ? 18 : 28),
      new THREE.MeshStandardMaterial({ color: 0x7ab558, roughness: 0.8, flatShading: true, envMapIntensity: 0.9 })
    );
    grassTop.position.y = 0.92;
    islandCore.add(grassTop);



    // ---- real oak: lathe trunk w/ root flare + taper, limbs, organic canopy ----
    const tree = new THREE.Group();
    const barkMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9, flatShading: true, envMapIntensity: 0.55 });
    // trunk profile: wide flared base -> slim waist -> thick shoulder -> tip.
    // Lathe gives one smooth, continuous, organic surface (no stacked cans).
    const profile: THREE.Vector2[] = [];
    const P = (h: number, r: number) => profile.push(new THREE.Vector2(r, h));
    P(0.0, 0.52);   // root flare (wide)
    P(0.10, 0.46);
    P(0.28, 0.30);  // pulls in above the roots
    P(0.55, 0.24);
    P(0.85, 0.27);  // swell (burl shoulder)
    P(1.15, 0.20);
    P(1.5, 0.15);
    P(1.8, 0.10);
    P(2.05, 0.05);  // tip
    const trunkGeo = new THREE.LatheGeometry(profile, tier === 'low' ? 7 : 10);
    // bark ridges: radial ripple so it reads as bark, not plastic
    const tp = trunkGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < tp.count; i++) {
      const x = tp.getX(i), y = tp.getY(i), z = tp.getZ(i);
      const rr = Math.atan2(z, x);
      const ripple = 1 + Math.sin(rr * (tier === 'low' ? 9 : 14)) * 0.05 + Math.sin(y * 6.0) * 0.02;
      tp.setXYZ(i, x * ripple, y, z * ripple);
    }
    trunkGeo.computeVertexNormals();
    const trunk = new THREE.Mesh(trunkGeo, barkMat);
    trunk.position.y = 0.92;
    tree.add(trunk);
    // main limbs: two asymmetric forking arms from the upper trunk
    const limb = (len: number, r0: number, _r1: number, bend: number, twist: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 5; i++) {
        const t = i / 5;
        pts.push(new THREE.Vector3(
          Math.sin(twist + bend * t * 2.2) * len * t * 0.5,
          len * t * Math.cos(bend * 0.8),
          Math.cos(twist) * len * t * 0.3
        ));
      }
      const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), tier === 'low' ? 5 : 8, r0, tier === 'low' ? 5 : 7, false);
      const m = new THREE.Mesh(g, barkMat);
      m.userData.tip = pts[5];
      return m;
    };
    const arm1 = limb(1.35, 0.09, 0.03, 0.7, 0.4);
    arm1.position.set(0.02, 2.54, 0.02);
    arm1.rotation.z = 0.95;
    tree.add(arm1);
    const arm2 = limb(1.15, 0.08, 0.03, -0.9, 2.6);
    arm2.position.set(-0.02, 2.42, 0.02);
    arm2.rotation.z = -0.8;
    arm2.rotation.y = 0.5;
    tree.add(arm2);
    // organic canopy: 9 clumps, EACH with its own tone (sunlit vs shadow
    // greens) + irregular jittered icosahedra — reads as leaf masses, not a ball
    const leafTones = [0x84b45e, 0x4c7a38, 0x9cc46e, 0x5c8d46, 0x6f9d4e, 0x87ae52];
    const canopy: THREE.Mesh[] = [];
    // clumps anchored ON the limb tips / trunk top — nothing floats free.
    // limb tips (from the limb() calls): R-limb ends ~ (1.9, +2.3), L-limb ~ (-1.7, +2.1), top ~ (0.5, +3.4)
    const clumpAnchors: [number, number, number, number][] = [
      [0.95, 2.72, 0.25, 0.52],   // right-limb tip mass (big)
      [-0.85, 2.62, 0.15, 0.5],  // left-limb tip mass (big)
      [0.12, 3.5, -0.3, 0.5],    // trunk-top crown
      [1.35, 2.95, 0.35, 0.38],  // right outer satellite (overlaps limb mass)
      [-1.2, 2.85, -0.2, 0.4],   // left outer satellite (overlaps limb mass)
      [0.85, 3.4, 0.2, 0.34],    // crown right shoulder
      [-0.75, 3.3, 0.1, 0.32],   // crown left shoulder
      [0.25, 3.95, 0.0, 0.3],    // crown cap
    ];
    clumpAnchors.forEach(([ax, ay, az, ar], i) => {
      const g = new THREE.IcosahedronGeometry(ar, 1);
      const gp = g.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < gp.count; k++) {
        const j = 1 + ((Math.sin(k * 7.3 + i * 3.1) * 43758.5) % 1) * 0.16;
        gp.setXYZ(k, gp.getX(k) * j, gp.getY(k) * j * 0.85, gp.getZ(k) * j);
      }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
        color: leafTones[i % leafTones.length], roughness: 0.85, flatShading: true, envMapIntensity: 0.55,
      }));
      m.position.set(ax, ay + 0.92, az);
      tree.add(m);
      canopy.push(m);
    });
    islandCore.add(tree);

    // ---- mist sprites under the island ----
    const mistTex = makeGlowTexture('rgba(255,255,255,0.55)', 'rgba(230,240,245,0.2)');
    const mists: { s: THREE.Sprite; seed: number }[] = [];
    for (let i = 0; i < (tier === 'low' ? 14 : tier === 'mid' ? 30 : 42); i++) {
      const s = makeSoftSprite(mistTex, 0xf4f8f9, 5 + Math.random() * 4, 0.10 + Math.random() * 0.10);
      s.material.blending = THREE.NormalBlending;
      const a = Math.random() * Math.PI * 2;
      s.position.set(Math.cos(a) * (2 + Math.random() * 3), -2.6 - Math.random() * 1.4, Math.sin(a) * (2 + Math.random() * 3));
      world.add(s);
      mists.push({ s, seed: Math.random() * 6.28 });
    }

    // ---- real mountains: displaced ridged peaks with snowlines ----
    // Each peak: cone base geometry, then radial ridging (alternate ring
    // radii) + per-vertex jitter + vertex colors (rock strata below the
    // snowline, bright snow above). flatShading keeps facets crisp and
    // cheap — no textures, no normals work, potato-friendly.
    const makeMountain = (h: number, base: number, seed: number) => {
      const segs = tier === 'low' ? 9 : 12;
      const geo = new THREE.ConeGeometry(base, h, segs, tier === 'low' ? 4 : 6);
      const p = geo.attributes.position as THREE.BufferAttribute;
      const colors: number[] = [];
      const snowLine = h * 0.62;
      const rockC = new THREE.Color(0x5d6b7c);
      const rockD = new THREE.Color(0x45525f);
      const snowC = new THREE.Color(0xf6fafc);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        // ridging: alternate radius by angle ring — jagged silhouette
        const ang = Math.atan2(z, x);
        const ring = Math.floor((y + h / 2) / (h / (segs / 1.5)));
        const ridge = 1 + Math.sin(ang * segs + ring * 1.7 + seed) * 0.30
          + Math.sin(ang * (segs * 2) + seed * 2) * 0.12;
        const nx = x * ridge, nz = z * ridge;
        // per-vertex jitter: no perfect cones in nature
        const j = (Math.sin(i * 12.9898 + seed) * 43758.5453) % 1;
        p.setXYZ(i, nx * (1 + j * 0.05), y, nz * (1 + j * 0.05));
        // snow above the line, strata rock below
        const vy = y + h / 2;
        const c = vy > snowLine + j * h * 0.08
          ? snowC
          : rockC.clone().lerp(rockD, Math.abs(j));
        colors.push(c.r, c.g, c.b);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
      geo.computeVertexNormals();
      return geo;
    };
    const mountainMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.9, flatShading: true, envMapIntensity: 0.8, emissive: 0x1c222b, emissiveIntensity: 0.5,
    });
    const mountainDefs = [
      { h: 16, b: 5.4, x: -7.0, z: -15, seed: 3.1 },
      { h: 19, b: 6.2, x: 0.8, z: -19, seed: 7.7 },
      { h: 15, b: 5.2, x: 8.0, z: -14, seed: 1.4 },
    ];
    mountainDefs.forEach((d, i) => {
      const mtn = new THREE.Mesh(makeMountain(d.h, d.b, d.seed), mountainMat);
      mtn.position.set(d.x, -5.6 + (i % 2) * 0.4, d.z);
      mtn.scale.setScalar(1 - i * 0.03); // slight size falloff = depth
      world.add(mtn);
    });

    // ---- water: TRUE planar mirror (Reflector) under a tinted glass layer ----
    // physical warm-horizon backdrop (the mirror reflects this -> peach folds onto water)
    const backdropCanvas = document.createElement('canvas');
    backdropCanvas.width = 4; backdropCanvas.height = 256;
    const bdCtx = backdropCanvas.getContext('2d')!;
    const bdG = bdCtx.createLinearGradient(0, 0, 0, 256);
    bdG.addColorStop(0, '#7fa8cf');
    bdG.addColorStop(0.45, '#bcd4de');
    bdG.addColorStop(0.66, '#f7b98e');
    bdG.addColorStop(0.8, '#f7ad7a');
    bdG.addColorStop(1, '#e8c9a8');
    bdCtx.fillStyle = bdG;
    bdCtx.fillRect(0, 0, 4, 256);
    const skyBackdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 60),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(backdropCanvas), side: THREE.DoubleSide })
    );
    skyBackdrop.position.set(0, 10, -80);
    scene.add(skyBackdrop); // static backdrop

    const mirror = new Reflector(new THREE.CircleGeometry(46, 64), {
      clipBias: 0.003,
      textureWidth: tier === 'low' ? 512 : 1024,
      textureHeight: tier === 'low' ? 512 : 1024,
      color: 0xffffff, // pure mirror — the sky paints the water
    });
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.y = -4.6;
    scene.add(mirror); // NOT in `world`: Reflector's virtual camera must not inherit orbit rotation
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(45, 48),
      new THREE.MeshStandardMaterial({ color: 0x1f7f96, metalness: 0.1, roughness: 0.2, transparent: true, opacity: 0.65, envMapIntensity: 1.2 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = -4.54;
    scene.add(water); // above the mirror, below the island; stable under orbit

    // ---- float proof: soft shadow cast on the water + island tilt ----
    const shadowTex = makeGlowTexture('rgba(20,30,38,0.6)', 'rgba(20,30,38,0.12)');
    const floatShadow = makeSoftSprite(shadowTex, 0x0d2028, 9.5, 0.66);
    floatShadow.position.set(0.3, -4.32, 0.4);
    world.add(floatShadow);
    islandCore.rotation.z = 0.045; // slight flying tilt
    islandCore.rotation.x = 0.03;
    islandCore.position.y = 2.6; // clear air gap: rock bottom ~0.5, water at -4.6

    // ---- corruption (write attempt) + roots seal ----
    const corruptTex = makeGlowTexture('rgba(255,90,90,0.9)', 'rgba(200,20,20,0.3)');
    const corrupt = makeSoftSprite(corruptTex, 0xff4444, 2.2, 0);
    corrupt.position.set(0.5, 1.8, 0.3);
    world.add(corrupt);
    // corruption = FIRE on the rock: a hot glowing shell + ember sprites that burn off
    const corruptShell = new THREE.Mesh(
      rockGeo.clone(),
      new THREE.MeshBasicMaterial({ color: 0xff2233, transparent: true, opacity: 0 })
    );
    corruptShell.scale.setScalar(1.05);
    islandCore.add(corruptShell);
    const fireTex = makeGlowTexture('rgba(255,120,60,0.95)', 'rgba(255,40,20,0.35)');
    const fireFlares: THREE.Sprite[] = [];
    const flareCount = tier === 'low' ? 10 : tier === 'mid' ? 22 : 34;
    for (let i = 0; i < flareCount; i++) {
      const f = makeSoftSprite(fireTex, 0xff6633, 0.6 + Math.random() * 0.9, 0);
      const d = new THREE.Vector3().randomDirection();
      f.position.set(d.x * 1.6, d.y * 1.2 + 0.4, d.z * 1.6);
      islandCore.add(f);
      fireFlares.push(f);
    }
    const bigFire = makeSoftSprite(fireTex, 0xff4422, 4.5, 0);
    bigFire.position.set(0.5, 0.6, 0.3);
    islandCore.add(bigFire);
    const seal = new THREE.Mesh(
      new THREE.TorusGeometry(2.7, 0.07, 10, 72),
      new THREE.MeshBasicMaterial({ color: 0x3ddc97, transparent: true, opacity: 0 })
    );
    seal.rotation.x = Math.PI / 2;
    seal.position.y = -0.6;
    world.add(seal);
    const sealGlowTex = makeGlowTexture('rgba(90,240,170,0.85)', 'rgba(40,200,120,0.25)');
    const sealGlow = makeSoftSprite(sealGlowTex, 0x3ddc97, 7.5, 0);
    sealGlow.position.y = -0.6;
    world.add(sealGlow);

    // ---- soft god-ray lighting ----
    scene.add(new THREE.AmbientLight(0xe8ddd0, 1.0));
    const sun = new THREE.DirectionalLight(0xffd7a0, 4.2); sun.position.set(-10, 12, 14); scene.add(sun); // low warm sun from front-left
    const fill = new THREE.DirectionalLight(0xa8c8d8, 0.55); fill.position.set(-5, 3, -4); scene.add(fill);
    const cyanRim = new THREE.DirectionalLight(0x7deeff, 0.5); cyanRim.position.set(8, 4, -6); scene.add(cyanRim); // cyan rim ties to UI accent
    const bounce = new THREE.DirectionalLight(0xffc490, 0.5); bounce.position.set(2, -8, 8); scene.add(bounce); // water bounce up-light
    const sunGlowTex = makeGlowTexture('rgba(255,245,220,0.8)', 'rgba(255,230,180,0.15)');
    const sunGlow = makeSoftSprite(sunGlowTex, 0xfff2d8, 8, 0.5);
    sunGlow.position.set(7, 6, 4);
    world.add(sunGlow);

    const orbit = useOrbit(mount, world, onFirstGrab);

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
      // island gently bobs; tree canopy sways
      world.position.y = Math.sin(t * 0.5) * 0.18;
    islandCore.rotation.z = 0.045 + Math.sin(t * 0.4) * 0.02;
      canopy.forEach((b, i) => { b.scale.setScalar(1 + Math.sin(t * 1.4 + i) * 0.04); });
      mists.forEach((p) => { p.s.position.y += Math.sin(t * 0.3 + p.seed) * 0.002; });

      if (m === 'dispatching') {
        // write attempt descends onto the island
        const p = Math.min(modeT / 1.1, 1);
        corrupt.material.opacity = p;
        corrupt.position.set(0.5, 4.2 - p * 2.4, 0.3);
        corrupt.scale.setScalar(1.4 - p * 0.5);
      } else if (m === 'detected' || m === 'denied' || m === 'blocked') {
        // corruption IGNITES on the rock, then the armor burns it off
        const flare = Math.min(modeT / 0.7, 1);
        const burnOut = Math.max(0, Math.min((modeT - 0.7) / 1.6, 1)); // 0->1 after 0.7s
        const heat = (1 - burnOut) * flare;
        (corruptShell.material as THREE.MeshBasicMaterial).opacity = heat * (0.7 + Math.sin(t * 11) * 0.2);
        fireFlares.forEach((f, i) => {
          f.material.opacity = heat * (0.7 + Math.sin(t * 13 + i * 2.4) * 0.3);
          f.position.y += dt * heat * 0.35; // embers rise
          f.scale.setScalar(f.scale.x * (1 + dt * heat * 0.12));
        });
        bigFire.material.opacity = heat * 0.75;
        bigFire.scale.setScalar(4.2 + Math.sin(t * 9) * 0.6 * heat);
        corrupt.material.opacity = Math.max(0, 1 - Math.max(modeT - 0.7, 0) * 1.4);
        // green seal rings in as EROFS verdict — bright enough to win the frame
        const so = Math.min(Math.max(modeT - 0.8, 0) / 0.8, 1);
        (seal.material as THREE.MeshBasicMaterial).opacity = so * 0.95;
        seal.scale.setScalar(0.01 + so);
        sealGlow.material.opacity = so * 0.65;
        seal.rotation.z += dt * 0.5;
      } else {
        // idle: all fire settles out
        (corruptShell.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (corruptShell.material as THREE.MeshBasicMaterial).opacity - dt * 2);
        fireFlares.forEach((f) => { f.material.opacity = Math.max(0, f.material.opacity - dt * 2); });
        bigFire.material.opacity = Math.max(0, bigFire.material.opacity - dt * 2);
        corrupt.material.opacity = Math.max(0, corrupt.material.opacity - dt);
        (seal.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (seal.material as THREE.MeshBasicMaterial).opacity - dt * 0.4);
        sealGlow.material.opacity = Math.max(0, sealGlow.material.opacity - dt * 0.5);
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
