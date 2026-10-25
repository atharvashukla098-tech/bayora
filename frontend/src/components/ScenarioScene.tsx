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

export interface WorldProps {
  mode?: string; // 'idle' | 'dispatching' | 'detected' | 'blocked' | 'redacted' | 'allowed'
  onFirstGrab?: () => void;
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
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, mid);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
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

function baseSetup(mount: HTMLDivElement, fov = 45, camZ = 8) {
  const tier = useTier();
  const PR = Math.min(window.devicePixelRatio, tier === 'low' ? 0.75 : tier === 'mid' ? 1 : 1.5);
  const renderer = new THREE.WebGLRenderer({ antialias: tier !== 'low', alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(PR);
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
  return { renderer, scene, camera, ro, tier };
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
    const { renderer, scene, camera, ro, tier } = baseSetup(mount, 46, 9.5);
    scene.fog = new THREE.FogExp2(0x04070f, 0.045);

    const world = new THREE.Group();
    scene.add(world);

    // ---- filament brain: CURVED, BRANCHING neurons (not straight rays) ----
    const filCount = tier === 'low' ? 34 : 64;
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
    const synapseCount = 40;
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
    const starCount = tier === 'low' ? 350 : 900;
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

    const clock = new THREE.Clock();
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (document.hidden) return;
      const dt = Math.min(clock.getDelta(), 0.05);
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
    const { renderer, scene, camera, ro } = baseSetup(mount, 42, 8.6);
    scene.fog = new THREE.FogExp2(0x07060c, 0.05);

    const world = new THREE.Group();
    scene.add(world);

    // ---- liquid chrome knot ----
    const knot = new THREE.Mesh(
      new THREE.TorusKnotGeometry(1.25, 0.4, 200, 26),
      new THREE.MeshStandardMaterial({ color: 0xdfe3ec, metalness: 1.0, roughness: 0.09 })
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

    const glowTex = makeGlowTexture('rgba(190,150,255,0.85)', 'rgba(120,60,255,0.2)');
    const underGlow = makeSoftSprite(glowTex, 0x9d6bff, 6, 0.6);
    underGlow.position.y = -1.2;
    world.add(underGlow);

    // ---- chrome beads on elliptical orbits ----
    const beadMat = new THREE.MeshStandardMaterial({ color: 0xe8ecf5, metalness: 1.0, roughness: 0.06 });
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

    const clock = new THREE.Clock();
    let raf = 0;
    const canaryColor = new THREE.Color(0xff5566);
    const redactedColor = new THREE.Color(0x3ddc97);
    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (document.hidden) return;
      const dt = Math.min(clock.getDelta(), 0.05);
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
    const { renderer, scene, camera, ro, tier } = baseSetup(mount, 48, 11);

    // ---- pastel sky gradient ----
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 4; skyCanvas.height = 256;
    const sctx = skyCanvas.getContext('2d')!;
    const skyGrad = sctx.createLinearGradient(0, 0, 0, 256);
    skyGrad.addColorStop(0, '#7fa8d8');
    skyGrad.addColorStop(0.45, '#c9d4e8');
    skyGrad.addColorStop(0.72, '#f2d8c8');
    skyGrad.addColorStop(1, '#f7c8ac');
    sctx.fillStyle = skyGrad;
    sctx.fillRect(0, 0, 4, 256);
    const skyTex = new THREE.CanvasTexture(skyCanvas);
    scene.background = skyTex;
    scene.fog = new THREE.Fog(0xd8d4e4, 14, 42);

    const world = new THREE.Group();
    scene.add(world);

    // ---- iridescent cloud: layered soft sprites ----
    const softTex = makeGlowTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0.25)');
    const pastels = [0xffc4e0, 0xc4f0dc, 0xc4d0ff, 0xffe4c4, 0xd4f4ff];
    const cloudPuffs: { s: THREE.Sprite; seed: number; base: THREE.Vector3 }[] = [];
    const puffCount = tier === 'low' ? 36 : 80;
    for (let i = 0; i < puffCount; i++) {
      const dir = new THREE.Vector3().randomDirection();
      const r = Math.pow(Math.random(), 0.6) * 2.2;
      const c = pastels[i % pastels.length];
      const s = makeSoftSprite(softTex, c, 1.6 + Math.random() * 2.4, 0.16 + Math.random() * 0.22);
      s.position.set(dir.x * r * 1.3, dir.y * r * 0.75 + 1.4, dir.z * r * 0.9);
      world.add(s);
      cloudPuffs.push({ s, seed: Math.random() * Math.PI * 2, base: s.position.clone() });
    }
    // warm core glow
    const coreTex = makeGlowTexture('rgba(255,230,190,0.95)', 'rgba(255,170,90,0.3)');
    const coreGlow = makeSoftSprite(coreTex, 0xffd9a8, 6.5, 0.9);
    coreGlow.position.set(0, 1.2, 0);
    world.add(coreGlow);

    // ---- boundary rings with glowing orbs ----
    const ringGroup = new THREE.Group();
    world.add(ringGroup);
    const patrolOrbs: THREE.Sprite[] = [];
    for (let i = 0; i < 2; i++) {
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
        const orb = makeSoftSprite(softTex, 0xfff4e0, 0.55, 0.95);
        const a = (b / n) * Math.PI * 2;
        orb.position.set(Math.cos(a) * R, 0, Math.sin(a) * R);
        holder.add(orb);
        patrolOrbs.push(orb);
      }
      ringGroup.add(holder);
    }

    // ---- water ----
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(30, 48),
      new THREE.MeshStandardMaterial({ color: 0x8fb2c8, metalness: 0.75, roughness: 0.22 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = -2.2;
    world.add(water);

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

    const clock = new THREE.Clock();
    let raf = 0;
    const RAY_DIR = new THREE.Vector3(1, 0.05, 0.35).normalize();
    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (document.hidden) return;
      const dt = Math.min(clock.getDelta(), 0.05);
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
    const { renderer, scene, camera, ro, tier } = baseSetup(mount, 40, 8.2);
    camera.position.set(0.4, 1.1, 8.2);
    camera.lookAt(0, 0.6, 0);
    scene.fog = new THREE.Fog(0xbfd8dc, 20, 60);
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

    // ---- floating rock island (jittered icosahedron) ----
    const rockGeo = new THREE.IcosahedronGeometry(2.1, tier === 'low' ? 1 : 2);
    const pos = rockGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const jitter = 1 + (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.22;
      pos.setXYZ(i, pos.getX(i) * jitter, pos.getY(i) * (jitter * 0.8), pos.getZ(i) * jitter);
    }
    rockGeo.computeVertexNormals();
    const rock = new THREE.Mesh(rockGeo, new THREE.MeshStandardMaterial({
      color: 0x5c5648, roughness: 0.95, metalness: 0.02, flatShading: true,
    }));
    world.add(rock);

    // ---- moss cap ----
    const mossGeo = new THREE.IcosahedronGeometry(1.95, 2);
    const mpos = mossGeo.attributes.position as THREE.BufferAttribute;
    const mossColors: number[] = [];
    const cA = new THREE.Color(0x4f7d3a), cB = new THREE.Color(0x77a84f);
    for (let i = 0; i < mpos.count; i++) {
      if (mpos.getY(i) > 0.2) mpos.setXYZ(i, mpos.getX(i) * (1 + Math.sin(i * 3.7) * 0.08), mpos.getY(i) * 0.55, mpos.getZ(i) * (1 + Math.cos(i * 2.9) * 0.08));
      const mix = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1);
      const c = cA.clone().lerp(cB, mix);
      mossColors.push(c.r, c.g, c.b);
    }
    mossGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(mossColors), 3));
    mossGeo.computeVertexNormals();
    const moss = new THREE.Mesh(mossGeo, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.95,
    }));
    moss.position.y = 1.05;
    world.add(moss);

    // ---- gnarled oak: stacked bent trunk + canopy blobs ----
    const tree = new THREE.Group();
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 0.9, flatShading: true });
    let ty = 1.3;
    let tRot = 0;
    for (let i = 0; i < 7; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.14 - i * 0.013, 0.17 - i * 0.013, 0.42, 8), trunkMat);
      tRot += 0.34;
      seg.position.set(Math.sin(tRot) * i * 0.075, ty + 0.2, Math.cos(tRot * 0.7) * i * 0.055);
      seg.rotation.z = 0.16 * Math.sin(i * 1.3);
      tree.add(seg);
      if (i === 2 || i === 4) {
        const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.5, 6), trunkMat);
        stub.position.set(seg.position.x + (i === 2 ? 0.3 : -0.32), seg.position.y + 0.08, seg.position.z);
        stub.rotation.z = i === 2 ? -1.1 : 1.2;
        tree.add(stub);
      }
      ty += 0.38;
    }
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x5c8d46, roughness: 0.85, flatShading: true });
    const canopy: THREE.Mesh[] = [];
    const canopyTop = new THREE.Vector3(0.35, 3.6, 0.1);
    for (let i = 0; i < 6; i++) {
      const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42 + (i % 3) * 0.12, 1), canopyMat);
      blob.position.set(
        canopyTop.x + Math.cos(i * 2.4) * (0.35 + (i % 2) * 0.25),
        canopyTop.y + Math.sin(i * 1.9) * 0.28,
        canopyTop.z + Math.sin(i * 2.4) * 0.3
      );
      tree.add(blob);
      canopy.push(blob);
    }
    world.add(tree);

    // ---- mist sprites under the island ----
    const mistTex = makeGlowTexture('rgba(255,255,255,0.55)', 'rgba(230,240,245,0.2)');
    const mists: { s: THREE.Sprite; seed: number }[] = [];
    for (let i = 0; i < (tier === 'low' ? 22 : 46); i++) {
      const s = makeSoftSprite(mistTex, 0xf4f8f9, 3 + Math.random() * 3.5, 0.14 + Math.random() * 0.16);
      s.material.blending = THREE.NormalBlending;
      const a = Math.random() * Math.PI * 2;
      s.position.set(Math.cos(a) * (1.5 + Math.random() * 2.2), -1.4 - Math.random() * 1.2, Math.sin(a) * (1.5 + Math.random() * 2.2));
      world.add(s);
      mists.push({ s, seed: Math.random() * 6.28 });
    }

    // ---- hazy mountains ----
    for (let i = 0; i < 8; i++) {
      const haze = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x6a8f96).lerp(new THREE.Color(0x9fc0c8), i / 8),
        roughness: 1, flatShading: true, transparent: true, opacity: 0.85 - i * 0.05,
      });
      const mtn = new THREE.Mesh(new THREE.ConeGeometry(4.5 + Math.random() * 3.5, 7 + Math.random() * 6, 5), haze);
      const a = (i / 8) * Math.PI * 2 + 0.5;
      mtn.position.set(Math.cos(a) * (17 + i * 1.5), -1.5 + Math.random() * 2, Math.sin(a) * (17 + i * 1.5) - 7);
      world.add(mtn);
    }

    // ---- water ----
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(45, 48),
      new THREE.MeshStandardMaterial({ color: 0x7aa8ac, metalness: 0.6, roughness: 0.28 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = -4.4;
    world.add(water);

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
    world.add(corruptShell);
    const fireTex = makeGlowTexture('rgba(255,120,60,0.95)', 'rgba(255,40,20,0.35)');
    const fireFlares: THREE.Sprite[] = [];
    const flareCount = tier === 'low' ? 10 : 22;
    for (let i = 0; i < flareCount; i++) {
      const f = makeSoftSprite(fireTex, 0xff6633, 0.6 + Math.random() * 0.9, 0);
      const d = new THREE.Vector3().randomDirection();
      f.position.set(d.x * 1.6, d.y * 1.2 + 0.4, d.z * 1.6);
      world.add(f);
      fireFlares.push(f);
    }
    const bigFire = makeSoftSprite(fireTex, 0xff4422, 4.5, 0);
    bigFire.position.set(0.5, 0.6, 0.3);
    world.add(bigFire);
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
    scene.add(new THREE.AmbientLight(0xd8e8e0, 1.2));
    const sun = new THREE.DirectionalLight(0xfff2d8, 2.6); sun.position.set(6, 8, 4); scene.add(sun);
    const fill = new THREE.DirectionalLight(0xa8c8d8, 0.7); fill.position.set(-5, 3, -4); scene.add(fill);
    const sunGlowTex = makeGlowTexture('rgba(255,245,220,0.8)', 'rgba(255,230,180,0.15)');
    const sunGlow = makeSoftSprite(sunGlowTex, 0xfff2d8, 8, 0.5);
    sunGlow.position.set(7, 6, 4);
    world.add(sunGlow);

    const orbit = useOrbit(mount, world, onFirstGrab);

    let m = modeRef.current || 'idle';
    let modeT = 0;
    apiRef.current = { setMode: (nm: string) => { m = nm || 'idle'; modeT = 0; } };
    apiRef.current.setMode(modeRef.current || 'idle'); // sync any mode that arrived during mount

    const clock = new THREE.Clock();
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (document.hidden) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      modeT += dt;

      orbit.update(dt);
      // island gently bobs; tree canopy sways
      world.position.y = Math.sin(t * 0.5) * 0.18;
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
