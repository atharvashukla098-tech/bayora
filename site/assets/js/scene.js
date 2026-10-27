/* Bayora site — the 3D evidence strand.
 *
 * A vertical spine of blocks, one per recorded ledger event, joined by
 * the hash links that chain them. The camera rides the strand as the page
 * scrolls: attack -> decision -> evidence -> tamper -> attestation.
 *
 * The scene is a visualization of recorded events. It never states a
 * verification verdict — that lives in the text, from the signed report.
 */

import * as THREE from "three";

const PALETTE = {
  void: 0x08090b,
  bone: 0xedeae3,
  ash: 0x8b8f98,
  rule: 0x6b7688,
  amber: 0xe8a33d,
  alarm: 0xe5484d,
  mint: 0x5fe3a1,
  cyan: 0x4cc9f0,
  violet: 0x8b7cf6,
};

const OUTCOME_COLOR = {
  ALLOWED: PALETTE.mint,
  DETECTED: PALETTE.amber,
  REDACTED: PALETTE.amber,
  BLOCKED: PALETTE.alarm,
  ERROR: PALETTE.violet,
};

const LANE = {
  "red-harness": -0.55,
  HARNESS: -0.55,
  "policy-broker": 0.0,
  INGRESS: 0.0,
  "mock-target": 0.55,
  TARGET: 0.55,
  "blue-guardrail": 0.3,
  "audit-ledger": -0.25,
  "AUDIT-LEDGER": -0.25,
  verifier: 0.5,
  VERIFIER: 0.5,
};

const SPACING = 1.15;

/* Camera keyframes, one per chapter. Interpolated continuously so the
 * scroll never cuts. */
const KEYS = [
  { pos: [-6.4, 4.2, 6.4], target: [-4.0, -0.4, 0.0], fov: 46 },
  { pos: [2.9, 0.9, 4.6], target: [0.0, 0.2, 0.0], fov: 42 },
  { pos: [-3.3, -3.9, 4.8], target: [0.1, -4.2, 0.0], fov: 44 },
  { pos: [3.9, -10.2, 6.0], target: [0.0, -10.6, 0.0], fov: 46 },
  { pos: [5.4, -15.4, 5.4], target: [1.9, -15.8, 0.0], fov: 44 },
  { pos: [0.2, -9.0, 14.0], target: [0.0, -14.5, 0.0], fov: 48 },
];

const smooth = (t) => t * t * (3 - 2 * t);

export function createScene(canvas, bundle) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(PALETTE.void, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(PALETTE.void, 0.04);

  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
  camera.position.set(0, 5.4, 9.2);

  scene.add(new THREE.AmbientLight(0x6a7480, 0.55));
  const key = new THREE.DirectionalLight(0xfff2df, 1.15);
  key.position.set(4, 6, 7);
  scene.add(key);
  const rim = new THREE.PointLight(PALETTE.cyan, 18, 26, 2);
  rim.position.set(-3, -6, 5);
  scene.add(rim);
  const follow = new THREE.PointLight(0xffe9c9, 9, 16, 2);
  scene.add(follow);

  const events = (bundle && bundle.events) || [];
  const strand = new THREE.Group();
  scene.add(strand);

  const geo = new THREE.BoxGeometry(0.62, 0.62, 0.62);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2a2f38,
    roughness: 0.35,
    metalness: 0.15,
    emissive: 0x000000,
  });
  const edgeMat = new THREE.LineBasicMaterial({
    color: PALETTE.rule,
    transparent: true,
    opacity: 0.85,
  });

  const blocks = [];
  const positions = [];
  const linkColors = [];

  events.forEach((ev, i) => {
    const comp = String(ev.component || "");
    const lane = LANE[comp] !== undefined ? LANE[comp] : 0;
    const y = -i * SPACING;
    const color = OUTCOME_COLOR[String(ev.outcome || "").toUpperCase()] || 0x8fa3bd;

    const mesh = new THREE.Mesh(geo, mat.clone());
    mesh.position.set(lane, y, 0);
    const weight = ev.event_type === "policy.decision" ? 1.7
      : ev.event_type === "verification.performed" ? 1.5
      : ev.event_type === "ledger.committed" ? 0.72 : 1.0;
    mesh.scale.setScalar(weight);
    mesh.material.color.setHex(color).multiplyScalar(0.42);
    mesh.material.emissive.setHex(color);
    mesh.material.emissiveIntensity = 0.75;

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo), edgeMat);
    edges.scale.setScalar(weight * 1.02);
    mesh.add(edges);

    strand.add(mesh);
    blocks.push(mesh);
    positions.push(new THREE.Vector3(lane, y, 0));

    if (i > 0) {
      const prev = positions[i - 1];
      linkColors.push(PALETTE.rule, PALETTE.rule);
    }
  });

  /* hash links: one segment per consecutive pair */
  if (positions.length > 1) {
    const linkGeo = new THREE.BufferGeometry();
    const pts = [];
    const cols = [];
    for (let i = 1; i < positions.length; i++) {
      const a = positions[i - 1];
      const b = positions[i];
      pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      const c = new THREE.Color(PALETTE.rule);
      cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    linkGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    linkGeo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    const links = new THREE.LineSegments(
      linkGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true,
        opacity: 0.75 }));
    strand.add(links);
    strand.userData.links = links;
  }

  /* the tamper copy: a translucent strand whose third link snaps red */
  const tamper = new THREE.Group();
  tamper.position.x = 1.7;
  tamper.visible = false;
  scene.add(tamper);
  if (positions.length > 3) {
    const tGeo = new THREE.BoxGeometry(0.62, 0.62, 0.62);
    const tMat = new THREE.MeshStandardMaterial({
      color: 0x1c222c, roughness: 0.5, metalness: 0.1,
      transparent: true, opacity: 0.9,
      emissive: new THREE.Color(0x2a1a20), emissiveIntensity: 0.2,
    });
    positions.forEach((p, i) => {
      const m = new THREE.Mesh(tGeo, tMat.clone());
      m.position.copy(p);
      m.position.x += 1.7;
      tamper.add(m);
      if (i === 2) {
        m.material.emissive.setHex(PALETTE.alarm);
        m.material.emissiveIntensity = 1.2;
        m.rotation.z = 0.55;
        tamper.userData.broken = m;
      }
    });
    const tPts = [];
    const tCols = [];
    const red = new THREE.Color(PALETTE.alarm);
    const rule = new THREE.Color(PALETTE.rule);
    for (let i = 1; i < positions.length; i++) {
      const a = positions[i - 1].clone(); a.x += 1.7;
      const b = positions[i].clone(); b.x += 1.7;
      tPts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      const broken = i === 3;
      const c1 = broken ? red : rule;
      const c2 = broken ? rule : rule;
      tCols.push(c1.r, c1.g, c1.b, c2.r, c2.g, c2.b);
    }
    const tGeo2 = new THREE.BufferGeometry();
    tGeo2.setAttribute("position", new THREE.Float32BufferAttribute(tPts, 3));
    tGeo2.setAttribute("color", new THREE.Float32BufferAttribute(tCols, 3));
    tamper.add(new THREE.LineSegments(tGeo2,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true,
        opacity: 0.8 })));
  }

  /* the signed checkpoint seal - it marks the head of the chain */
  const seal = new THREE.Mesh(
    new THREE.TorusGeometry(1.5, 0.07, 16, 72),
    new THREE.MeshStandardMaterial({
      color: PALETTE.cyan, emissive: PALETTE.cyan, emissiveIntensity: 1.6,
      transparent: true, opacity: 0, fog: false,
    }));
  const headIndex = Math.max(0, positions.length - 1);
  const sealY = -headIndex * SPACING;
  seal.position.set(0, sealY, 0);
  seal.rotation.x = Math.PI / 2;
  scene.add(seal);

  /* the final chapter flies to the head of the chain, where the seal is */
  if (positions.length) {
    KEYS[5].target[1] = sealY;
    KEYS[5].pos[1] = sealY + 6.5;
    KEYS[5].pos[2] = 10.5;
  }

  /* dust */
  const dustCount = 700;
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 16;
    dustPos[i * 3 + 1] = -Math.random() * 46 + 6;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 12 - 2;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo,
    new THREE.PointsMaterial({ color: PALETTE.ash, size: 0.035,
      transparent: true, opacity: 0.42 }));
  scene.add(dust);

  /* -------------------------------------------------- state and controls */
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const camPos = new THREE.Vector3().copy(camera.position);
  const camTarget = new THREE.Vector3(0, 0, 0);
  let progress = 0;         // continuous chapter index (float)
  let visible = true;
  let clock = new THREE.Clock();

  window.addEventListener("pointermove", (e) => {
    pointer.tx = (e.clientX / window.innerWidth - 0.5) * 2;
    pointer.ty = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();

  function frame() {
    if (!visible) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    /* interpolate the camera between chapter keyframes */
    const i0 = Math.max(0, Math.min(KEYS.length - 1, Math.floor(progress)));
    const i1 = Math.max(0, Math.min(KEYS.length - 1, i0 + 1));
    const f = smooth(Math.max(0, Math.min(1, progress - i0)));
    const a = KEYS[i0];
    const b = KEYS[i1];
    tmpA.set(a.pos[0], a.pos[1], a.pos[2]);
    tmpB.set(b.pos[0], b.pos[1], b.pos[2]);
    tmpA.lerp(tmpB, f);
    tmpB.set(a.target[0], a.target[1], a.target[2]);
    const tgtB = new THREE.Vector3(b.target[0], b.target[1], b.target[2]);
    tmpB.lerp(tgtB, f);

    pointer.x += (pointer.tx - pointer.x) * 0.06;
    pointer.y += (pointer.ty - pointer.y) * 0.06;

    const drift = Math.sin(t * 0.22) * 0.16;
    camPos.lerp(tmpA, 0.09);
    camTarget.lerp(tmpB, 0.09);

    camera.position.set(
      camPos.x + pointer.x * 0.55 + drift,
      camPos.y - pointer.y * 0.35,
      camPos.z,
    );
    camera.lookAt(camTarget);
    const fov = a.fov + (b.fov - a.fov) * f;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    follow.position.set(camTarget.x + 1.2, camTarget.y + 1.4, camTarget.z + 2.4);
    rim.position.set(camTarget.x - 2.6, camTarget.y - 1.2, camTarget.z + 2.2);

    /* blocks breathe; the focused one glows harder */
    const focusIndex = Math.round(
      Math.max(0, Math.min(blocks.length - 1, -camTarget.y / SPACING)));
    blocks.forEach((m, i) => {
      const near = Math.abs(i - focusIndex);
      const pulse = 0.45 + 0.25 * Math.sin(t * 1.4 + i * 0.35);
      m.material.emissiveIntensity = near === 0 ? pulse + 0.55 : pulse * 0.5;
      const s = m.scale.x;
      const target = s * (near === 0 ? 1.12 : 1.0);
      m.scale.setScalar(m.scale.x + (target - m.scale.x) * 0.08);
    });

    /* the tamper copy only exists in its chapter */
    const tamperMix = Math.max(0, Math.min(1, (progress - 3.2) / 0.9));
    tamper.visible = tamperMix > 0.01;
    tamper.children.forEach((c) => {
      if (c.material && "opacity" in c.material) {
        c.material.opacity = tamperMix * (c.type === "LineSegments" ? 0.8 : 0.9);
      }
    });
    if (tamper.userData.broken) {
      tamper.userData.broken.rotation.y = t * 0.8;
      tamper.userData.broken.rotation.z = 0.55 + Math.sin(t * 1.6) * 0.12;
    }

    /* the seal materialises for the attestation and becomes the focus */
    const sealMix = Math.max(0, Math.min(1, (progress - 4.2) / 0.9));
    seal.material.opacity = sealMix * 0.95;
    seal.rotation.z = t * 0.35;
    seal.scale.setScalar(1 + (1 - sealMix) * 0.4);
    if (sealMix > 0) {
      const sealPos = new THREE.Vector3(seal.position.x, seal.position.y, 0);
      camTarget.lerp(sealPos, sealMix * 0.85);
      camPos.y += sealMix * (seal.position.y - camPos.y) * 0.85;
    }

    scene.fog.density = 0.052 - sealMix * 0.012;

    dust.rotation.y = t * 0.012;
    dust.position.y = Math.sin(t * 0.15) * 0.3;

    renderer.render(scene, camera);
  }

  const loop = () => {
    frame();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  document.addEventListener("visibilitychange", () => {
    visible = !document.hidden;
    if (visible) clock.getDelta();
  });

  return {
    setProgress(p) { progress = p; },
    getProgress() { return progress; },
    eventCount: events.length,
  };
}
