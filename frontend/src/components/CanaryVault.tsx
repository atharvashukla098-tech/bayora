// BAYORA — Canary Vault: the real-time 3D hero for pillar case pages.
// Three.js: a glowing core (the canary) sealed inside a rotating armor
// cage. Mouse-reactive orbit, idle rotation, and a dispatch mode where
// the cage bars SLAM shut / the core pulses red on BLOCKED, cyan scan
// sweep on REDACTED. Tier-aware (potato-safe), pauses when hidden.

import { useRef, useEffect } from 'react';
import * as THREE from 'three';

// Deprecation-free THREE.Clock replacement (same getDelta semantics)
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
  getElapsedTime() {
    return this.elapsedTime;
  }
}


interface CanaryVaultProps {
  /** 'idle' | 'dispatching' | 'blocked' | 'redacted' | 'allowed' */
  mode?: string;
  accent?: string; // hex accent color, default cyan
  onFirstGrab?: () => void; // fired once — used to fade the drag hint
}

export function CanaryVault({ mode = 'idle', onFirstGrab }: CanaryVaultProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef(mode);
  const apiRef = useRef<{ setMode: (m: string) => void } | null>(null);

  useEffect(() => { modeRef.current = mode; if (apiRef.current) apiRef.current.setMode(mode); }, [mode]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const TIER = (window as unknown as { __BAYORA_TIER?: string }).__BAYORA_TIER || 'mid';
    const PR = Math.min(window.devicePixelRatio, TIER === 'low' ? 0.75 : TIER === 'mid' ? 1 : 1.5);
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    // ---------- scene ----------
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x06070a, 0.06);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
    camera.position.set(0, 0.6, 7.2);
    const renderer = new THREE.WebGLRenderer({ antialias: TIER !== 'low', alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(PR);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    // ---------- the core: glowing canary sphere ----------
    const coreGroup = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.05, TIER === 'low' ? 1 : 3),
      new THREE.MeshStandardMaterial({
        color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 1.6,
        roughness: 0.25, metalness: 0.1,
      })
    );
    coreGroup.add(core);
    // halo shell
    const halo = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.35, 2),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, wireframe: true, transparent: true, opacity: 0.22 })
    );
    coreGroup.add(halo);
    scene.add(coreGroup);

    // ---------- the cage: 10 angled armor bars — thick, beveled, metallic ----------
    const cageGroup = new THREE.Group();
    const barGeo = new THREE.BoxGeometry(0.26, 2.15, 0.42);
    const barMat = new THREE.MeshStandardMaterial({
      color: 0x9aa1ad, metalness: 0.9, roughness: 0.28,
      emissive: 0x0a0c12, emissiveIntensity: 0.5,
    });
    const bars: THREE.Mesh[] = [];
    const BAR_COUNT = 9;
    for (let i = 0; i < BAR_COUNT; i++) {
      const bar = new THREE.Mesh(barGeo, barMat);
      const angle = (i / BAR_COUNT) * Math.PI * 2;
      bar.position.set(Math.cos(angle) * 2.15, 0, Math.sin(angle) * 2.15);
      bar.lookAt(0, 0, 0);
      bar.rotateX(Math.PI / 2);
      bars.push(bar);
      cageGroup.add(bar);
    }
    // corner bolts on each bar (armor detail)
    const boltGeo = new THREE.SphereGeometry(0.05, 8, 8);
    const boltMat = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.8, roughness: 0.4, emissive: 0xd97706, emissiveIntensity: 0.6 });
    bars.forEach((bar) => {
      const b1 = new THREE.Mesh(boltGeo, boltMat);
      b1.position.set(0, 0.95, 0.24);
      bar.add(b1);
      const b2 = b1.clone(); b2.position.set(0, -0.95, 0.24);
      bar.add(b2);
    });
    // top + bottom rings
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x5c6270, metalness: 0.9, roughness: 0.3 });
    const ringTop = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.05, 8, 48), ringMat);
    ringTop.rotation.x = Math.PI / 2; ringTop.position.y = 1.05;
    const ringBot = ringTop.clone(); ringBot.position.y = -1.05;
    cageGroup.add(ringTop, ringBot);
    scene.add(cageGroup);

    // ---------- scan plane (sweeps during redacted mode) ----------
    const scan = new THREE.Mesh(
      new THREE.RingGeometry(1.5, 2.0, 48),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0, side: THREE.DoubleSide })
    );
    scan.rotation.x = Math.PI / 2;
    scene.add(scan);

    // ---------- glow sprite (bloom halo around the core — cheap, no post pass) ----------
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 128;
    const gctx = glowCanvas.getContext('2d')!;
    const grad = gctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(34, 211, 238, 0.55)');
    grad.addColorStop(0.4, 'rgba(34, 211, 238, 0.18)');
    grad.addColorStop(1, 'rgba(34, 211, 238, 0)');
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, 128, 128);
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    const glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    glowSprite.scale.setScalar(7.5);
    scene.add(glowSprite);

    // ---------- dust particles (sparse, cheap) ----------
    const particleCount = TIER === 'low' ? 90 : 260;
    const pPos = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const r = 3.2 + Math.random() * 4.5;
      const t = Math.random() * Math.PI * 2;
      pPos[i*3] = Math.cos(t) * r;
      pPos[i*3+1] = (Math.random() - 0.5) * 5;
      pPos[i*3+2] = Math.sin(t) * r;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
      color: 0x9fd8e8, size: 0.035, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    scene.add(particles);

    // ---------- lights ----------
    scene.add(new THREE.AmbientLight(0x334455, 0.5));
    const key = new THREE.PointLight(0x22d3ee, 18, 20); key.position.set(3, 3, 4); scene.add(key);
    const rim = new THREE.PointLight(0xd97706, 8, 16); rim.position.set(-4, -1, -3); scene.add(rim);

    // ---------- interaction state: cursor parallax + DRAG-TO-SPIN with inertia ----------
    let mouseX = 0, mouseY = 0, targetMX = 0, targetMY = 0;
    const onMouse = (e: MouseEvent) => {
      const r = mount.getBoundingClientRect();
      targetMX = ((e.clientX - r.left) / r.width - 0.5) * 2;
      targetMY = ((e.clientY - r.top) / r.height - 0.5) * 2;
    };
    mount.addEventListener('mousemove', onMouse);

    // drag-to-rotate: grab ANYWHERE on the case page and throw the vault —
    // angular momentum with damping. Control elements (textarea/button/a)
    // are excluded so typing and dispatch still work; wheel still scrolls.
    let dragging = false, lastX = 0, lastY = 0;
    let spinVelY = 0, spinVelX = 0;       // rad/s inertia
    let userSpinY = 0, userSpinX = 0;     // accumulated user rotation
    const INTERACTIVE = 'textarea, button, a, input, select, [contenteditable]';
    let hinted = false;
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && el.closest?.(INTERACTIVE)) return; // let real controls work
      if (e.button !== 0) return;
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      mount.style.cursor = 'grabbing';
      if (!hinted) { hinted = true; onFirstGrab?.(); }
    };
    const onMoveDrag = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      const kx = 0.0055, ky = 0.0035;
      userSpinY += dx * kx;
      userSpinX += dy * ky;
      spinVelY = dx * kx * 60;   // velocity for inertia (per second)
      spinVelX = dy * ky * 60;
    };
    const onUp = () => { dragging = false; mount.style.cursor = 'grab'; };
    // keyboard rotation for accessibility (arrow keys), reduced-motion safe
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      const step = 0.25;
      if (e.key === 'ArrowLeft') { userSpinY -= step; spinVelY = -step * 2; }
      else if (e.key === 'ArrowRight') { userSpinY += step; spinVelY = step * 2; }
      else if (e.key === 'ArrowUp') { userSpinX = Math.max(userSpinX - step, -0.9); }
      else if (e.key === 'ArrowDown') { userSpinX = Math.min(userSpinX + step, 0.9); }
    };
    window.addEventListener('keydown', onKey);
    mount.style.cursor = 'grab';
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMoveDrag);
    window.addEventListener('pointerup', onUp);

    let m: 'idle' | 'dispatching' | 'blocked' | 'redacted' | 'allowed' = 'idle';
    let modeT = 0;          // time since mode switch
    let scanY = -1.2;
    const setMode = (nm: string) => { m = (nm as typeof m) || 'idle'; modeT = 0; };
    apiRef.current = { setMode };
    setMode(modeRef.current);

    // ---------- resize ----------
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

    // ---------- render loop ----------
    let raf = 0;
    const clock = new FrameClock();
    const coreMat = core.material as THREE.MeshStandardMaterial;

    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (document.hidden) return;

      const t = clock.getElapsedTime();
      const dt = Math.min(clock.getDelta(), 0.05);
      modeT += dt;

      // smooth mouse follow
      mouseX += (targetMX - mouseX) * 0.06;
      mouseY += (targetMY - mouseY) * 0.06;

      // cage: continuous auto orbit + user drag spin with inertia
      if (!reduceMotion) {
        // inertia decay (drag throws the vault, it coasts to a stop)
        if (!dragging) {
          spinVelY *= Math.pow(0.04, dt);
          spinVelX *= Math.pow(0.04, dt);
          userSpinY += spinVelY * dt;
          userSpinX += spinVelX * dt;
          userSpinX = Math.max(-0.9, Math.min(0.9, userSpinX)); // don't flip over
        }
        cageGroup.rotation.y = t * 0.22 + userSpinY; // auto orbit + user spin
        cageGroup.rotation.x = userSpinX + mouseY * 0.12;
        cageGroup.position.x = mouseX * 0.25;
        coreGroup.rotation.y -= dt * 0.35;
        coreGroup.rotation.x = mouseY * 0.2 + Math.sin(t * 0.5) * 0.05;
        coreGroup.position.x = mouseX * 0.4;
      }

      // core breathing
      const breathe = 1 + Math.sin(t * 1.6) * 0.03;
      core.scale.setScalar(breathe);

      // mode choreography
      if (m === 'dispatching') {
        coreMat.emissiveIntensity = 1.2 + Math.abs(Math.sin(t * 12)) * 2.2;
        coreMat.color.setHex(0xffb454);
        coreMat.emissive.setHex(0xffb454);
        (glowSprite.material as THREE.SpriteMaterial).color.setHex(0xffb454);
      } else if (m === 'blocked') {
        coreMat.color.setHex(0xef4444);
        coreMat.emissive.setHex(0xef4444);
        coreMat.emissiveIntensity = 1.8 + Math.abs(Math.sin(t * 6)) * 1.2;
        (glowSprite.material as THREE.SpriteMaterial).color.setHex(0xef4444);
        // cage bars squeeze in (defense slam)
        const squeeze = 2.15 - Math.min(modeT * 2.5, 1) * 0.45;
        bars.forEach((bar, i) => {
          const angle = (i / BAR_COUNT) * Math.PI * 2;
          bar.position.x = Math.cos(angle) * squeeze;
          bar.position.z = Math.sin(angle) * squeeze;
        });
      } else if (m === 'redacted') {
        coreMat.color.setHex(0x22d3ee);
        coreMat.emissive.setHex(0x22d3ee);
        coreMat.emissiveIntensity = 2.2;
        (glowSprite.material as THREE.SpriteMaterial).color.setHex(0x22d3ee);
        // scan plane sweeps bottom -> top then fades
        scanY = Math.min(-1.2 + modeT * 1.1, 1.25);
        scan.position.y = scanY;
        (scan.material as THREE.MeshBasicMaterial).opacity = scanY < 1.2 ? 0.35 : Math.max(0.35 - (modeT - 2.2) * 0.5, 0);
      } else if (m === 'allowed') {
        coreMat.color.setHex(0x34d399);
        coreMat.emissive.setHex(0x34d399);
        coreMat.emissiveIntensity = 1.4;
        (glowSprite.material as THREE.SpriteMaterial).color.setHex(0x34d399);
      } else {
        // idle: restore + a slow ambient scanline roll so the scene is never still
        coreMat.color.setHex(0x22d3ee);
        coreMat.emissive.setHex(0x22d3ee);
        coreMat.emissiveIntensity = 1.6 + Math.sin(t * 2) * 0.3;
        (glowSprite.material as THREE.SpriteMaterial).color.setHex(0x22d3ee);
        const rollY = ((t * 0.35) % 4) - 2; // -2..2 loop
        scan.position.y = rollY;
        (scan.material as THREE.MeshBasicMaterial).opacity = 0.10 + Math.sin(t * 2) * 0.04;
        // bars ease back out
        bars.forEach((bar, i) => {
          const angle = (i / BAR_COUNT) * Math.PI * 2;
          bar.position.x += (Math.cos(angle) * 2.15 - bar.position.x) * 0.05;
          bar.position.z += (Math.sin(angle) * 2.15 - bar.position.z) * 0.05;
        });
      }

      // glow breathes with the core, follows it
      glowSprite.position.copy(coreGroup.position);
      glowSprite.scale.setScalar(7.2 + Math.sin(t * 1.6) * 0.5);

      particles.rotation.y += dt * 0.03;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mount.removeEventListener('mousemove', onMouse);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMoveDrag);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      renderer.dispose();
      scene.traverse((obj) => {
        (obj as THREE.Mesh).geometry?.dispose?.();
        const mat = (obj as THREE.Mesh).material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose?.();
      });
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="absolute inset-0"
      aria-hidden
      style={{ touchAction: 'none' }}
    />
  );
}
