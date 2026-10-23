// BAYORA 3D experience — scenes: hexagon core → attack interception →
// hash chain w/ TAMPER shatter → six-component architecture reveal.
// All geometry procedural. Real run artifacts feed the HUD panels.

import * as THREE from 'three';

export const SCENES = ['hero', 'attack', 'chain', 'reveal'];

/* ------------------------------------------------------------------ */
/* Palette                                                            */
/* ------------------------------------------------------------------ */
export const C = {
  bg: 0x05070d,
  core: 0x4f9fff,
  coreDim: 0x1d3a5f,
  danger: 0xff4d5e,
  ok: 0x3ddc97,
  amber: 0xffb454,
  wire: 0x8b94a7,
  white: 0xe8ecf4,
};

/* ------------------------------------------------------------------ */
/* Renderer bootstrap with capability tiers                           */
/* ------------------------------------------------------------------ */
export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) return null;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePIXELRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Performance tiering: fewer pixels/particles on weak GPUs
  const tier = detectTier(gl);
  return { renderer, tier };
}

function detectTier(gl) {
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  let name = '';
  try { name = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '' : ''; } catch { name = ''; }
  const weak = /Intel|HD Graphics|UHD|Mali|Adreno 5|Adreno 6[0-3]|PowerVR|SwiftShader|Software/i.test(name);
  const mem = (navigator.deviceMemory || navigator.hardwareConcurrency || 4);
  const lowEnd = weak || mem <= 4;
  return {
    pixelRatio: lowEnd ? 1 : Math.min(devicePixelRatio, 2),
    particles: lowEnd ? 0.5 : 1,
    postFx: !lowEnd,
    label: lowEnd ? 'lite' : 'full',
  };
}

/* ------------------------------------------------------------------ */
/* Scene graph: persistent world objects (built once)                 */
/* ------------------------------------------------------------------ */
export function buildWorld(scene, tier) {
  const world = {};

  // ---- starfield / data motes ----
  world.motes = buildMotes(tier.particles);
  scene.add(world.motes);

  // ---- crystalline hexagon core ----
  world.core = buildCore();
  scene.add(world.core);

  // ---- attack beam + shield ring ----
  world.attackGroup = buildAttack();
  scene.add(world.attackGroup);

  // ---- hash chain blocks ----
  world.chain = buildChain();
  scene.add(world.chain);

  // ---- six architecture nodes (reveal finale) ----
  world.nodes = buildArchNodes();
  scene.add(world.nodes);

  // ---- grid floor ----
  world.grid = buildGrid();
  scene.add(world.grid);

  return world;
}

/* starfield: instanced points, additive glow */
function buildMotes(scale = 1) {
  const N = Math.floor(1400 * scale);
  const pos = new Float32Array(N * 3);
  const seeds = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    // shell distribution for depth
    const r = 24 + Math.random() * 60;
    const t = Math.random() * Math.PI * 2;
    const p = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(p) * Math.cos(t);
    pos[i * 3 + 1] = r * Math.sin(p) * Math.sin(t) * 0.5;
    pos[i * 3 + 2] = r * Math.cos(p);
    seeds[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uSize: { value: (window.devicePixelRatio || 1) * 2.2 * scale } },
    vertexShader: `
      attribute float aSeed;
      uniform float uTime;
      uniform float uSize;
      varying float vA;
      void main() {
        vec3 p = position;
        p.y += sin(uTime * 0.35 + aSeed * 6.28) * 1.4;
        p.x += cos(uTame_placeholder) * 0.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = 0.55 + 0.45 * sin(uTime * (0.8 + aSeed) + aSeed * 40.0);
        vA = tw;
        gl_PointSize = uSize * tw * (140.0 / -mv.z);
      }`,
    fragmentShader: `
      uniform float uTime;
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float glow = pow(1.0 - d * 2.0, 2.2);
        gl_FragColor = vec4(vec3(0.31, 0.62, 1.0) * glow * vA, glow * vA);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

/* hexagonal prism cluster — the BAYORA core */
function buildCore() {
  const group = new THREE.Group();

  const geo = new THREE.CylinderGeometry(2.2, 2.2, 1.1, 6, 1, false);
  const mat = new THREE.MeshPhysicalMaterial({
    color: C.coreDim,
    metalness: 0.85,
    roughness: 0.22,
    transparent: true,
    opacity: 0.92,
    emissive: new THREE.Color(C.core),
    emissiveIntensity: 0.28,
    flatShading: true,
  });
  const prism = new THREE.Mesh(geo, mat);
  group.add(prism);

  // wireframe halo — hexagon outline
  const halo = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.CylinderGeometry(2.9, 2.9, 1.5, 6)),
    new THREE.LineBasicMaterial({ color: C.core, transparent: true, opacity: 0.6 })
  );
  group.add(halo);

  // inner glowing octahedron — the "heart"
  const heart = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.85, 0),
    new THREE.MeshBasicMaterial({ color: C.white })
  );
  group.add(heart);
  group.userData = { prism, halo, heart };

  return group;
}

/* red beam from distance → intercepted at shield ring */
function buildAttack() {
  const g = new THREE.Group();

  // beam
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 30, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: C.danger, transparent: true, opacity: 0.85 })
  );
  beam.rotation.z = Math.PI / 2;
  beam.position.set(-15, 0, 0);
  g.add(beam);

  // shield ring at x=0
  const shield = new THREE.Mesh(
    new THREE.TorusGeometry(2.35, 0.045, 8, 96),
    new THREE.MeshBasicMaterial({ color: C.core, transparent: true, opacity: 0.9 })
  );
  shield.rotation.y = Math.PI / 2;
  g.add(shield);

  // impact glow sprite
  const impact = new THREE.Sprite(
    new THREE.SpriteMaterial({ color: C.danger, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  impact.scale.set(3, 3, 3);
  impact.position.x = 0;
  g.add(impact);

  g.userData = { beam, shield, impact };
  return g;
}

/* hash chain: N cubes in a row, linked by light lines */
function buildChain(N = 7) {
  const g = new THREE.Group();
  const blocks = [];
  const links = [];

  const blockGeo = new THREE.BoxGeometry(1.1, 1.1, 1.1);
  const faceColors = [C.ok, C.ok, C.ok, C.ok, C.ok, C.ok, C.danger]; // last block tampered

  for (let i = 0; i < N; i++) {
    const isTampered = i === N - 1;
    const mat = new THREE.MeshStandardMaterial({
      color: isTampered ? C.danger : C.coreDim,
      emissive: new THREE.Color(isTampered ? C.danger : C.core),
      emissiveIntensity: isTampered ? 0.85 : 0.3,
      metalness:  0.6,
      roughness: 0.35,
      transparent: true,
      opacity: 0.95,
    });
    const b = new THREE.Mesh(blockGeo, mat);
    b.position.set((i - (N - 1) / 2) * 2.2, 0, 0);
    b.userData = { original: b.position.clone(), tampered: isTampered };
    blocks.push(b);
    g.add(b);

    if (i > 0) {
      const prev = blocks[i - 1];
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([prev.position.clone(), b.position.clone()]),
        new THREE.LineBasicMaterial({ color: C.wire, transparent: true, opacity: 0.55 })
        );
      links.push(line);
      g.add(line);
    }
  }

  g.userData = { blocks, links, N };
  return g;
}

/* six architecture nodes — harness/broker/target/runtime/ledger/report */
function buildArchNodes() {
  const defs = [
    { id: 'harness',  label: 'RED HARNESS',      color: C.danger },
    { id: 'broker',   label: 'POLICY BROKER',    color: C.amber },
    { id: 'target',   label: 'AI TARGET',        color: C.core },
    {  id: 'runtime', label: 'RUNTIME',          color: C.core },
    { id: 'ledger',   label: 'HASH LEDGER',     color: C.ok },
    { id: 'report',   label: 'SIGNED REPORT',    color: C.ok },
  ];
  const g = new THREE.Group();
  const nodes = defs.map((d, i) => {
    const angle = (i / defs.length) * Math.PI * 2 - Math.PI / 2;
    const R = 4.6;
    const m = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.55, 0),
      new THREE.MeshStandardMaterial({
        color: d.color,
        emissive: new THREE.Color(d.color),
        emissiveIntensity:  0.7,
        metalness: 0.5,
        roughness: 0.3,
      })
    );
    m.position.set(Math.cos(angle) * R, 0, Math.sin(angle) * R);
    m.userData = d;
    g.add(m);
    return m;
  });

  // connecting lines hub-spoke + ring
  const ringGeo = new THREE.BufferGeometry();
  const ringPts = nodes.map((n) => n.position.clone());
  ringGeo.setFromPoints([...ringPts, ringPts[0]]);
  const ring = new THREE.Line(ringGeo, new THREE.LineBasicMaterial({ color: C.wire, transparent: true, opacity: 0.4 }));
  g.add(ring);
  g.userData = { nodes, ring, defs };
  return g;
}

/* faint grid floor for spatial anchoring */
function buildGrid() {
  const grid = new THREE.GridHelper(60, 30, 0x0e1626, 0x0a0f1c);
  grid.position.y = -6;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  return grid;
}

/* ------------------------------------------------------------------ */
/* Scene choreography (camera + object states per scene)               */
/* ------------------------------------------------------------------ */
export const CAM = {
  hero:   { pos: [0, 1.2, 9.5],  look: [0, 0, 0] },
  attack: { pos: [1.5, 2.5, 12],  look: [0, 0, 0] },
  chain:  { pos: [0, 2.2, 11],    look: [0, 0, 0] },
  reveal: { pos: [0, 7.5, 13],   look: [0, 0, 0] },
};

export function applyScene(world, name, t) {
  // every object keeps animating with t (global time); scene switches
  // lerp object positions/opacities toward their target states.
  const k = 0.04; // lerp factor

  // core visible in hero + reveal
  const coreT = name === 'hero' || name === 'reveal' ? 1 : 0;
  world.core.userData.prism.material.opacity = lerp(world.core.userData.prism.material.opacity, 0.92 * coreT + 0.0, k);
  world.core.userData.halo.material.opacity = lerp(world.core.userData.halo.material.opacity, 0.6 * coreT, k);
  world.core.userData.heart.material.color.setHex(coreT ? C.white : C.coreDim);
  world.core.position.y = name === 'reveal' ? 0 : 0;
  world.core.rotation.y += 0.004;

  // attack group active during 'attack' scene only
  const atkT = name === 'attack' ? 1 : 0;
  const { beam, shield, impact } = world.attackGroup.userData;
  beam.material.opacity = lerp(beam.material.opacity, 0.85 * atkT, k);
  shield.material.opacity = lerp(shield.material.opacity, 0.9 * atkF(beam.material.opacity), k);
  impact.material.opacity = lerp(impact.material.opacity, (0.55 + 0.25 * Math.sin(t * 9)) * atkT, k);
  beam.position.x = -15 + 15 * Math.abs(Math.sin(t * 0.7)) - 7.5 * atkT;
  // beam pulsing toward shield
  world.attackGroup.rotation.z = 0;

  // chain visible in 'chain' scene
  const chT = name === 'chain' ? 1 : 0;
  world.chain.userData.blocks.forEach((b, i) => {
    const visible = lerp(b.material.opacity, 0.95 * chT, k);
    b.material.opacity = visible;
    b.rotation.x += 0.006;
    b.rotation.y += 0.008;
    if (b.userData.tampered) {
      // glitch: jitter position + emissive pulse
      b.position.x = b.userData.original.x + (Math.random() - 0.5) * 0.12 * chT;
      b.position.y = b.userData.original.y + (Math.random() - 0.5) * 0.12 * chT;
      b.material.emissiveIntensity = 0.65 + 0.35 * Math.sin(t * 6.0);
    }
  });
  world.chain.userData.links.forEach((ln) => {
    ln.material.opacity = lerp(ln.material.opacity, 0.55 * chT, k);
  });

  // architecture nodes visible in 'reveal' scene
  const rvT = name === 'reveal' ? 1 : 0;
  world.nodes.userData.nodes.forEach((n) => {
    n.material.opacity = lerp(n.material.opacity || 1, rvT, k);
    n.visible = true;
    n.rotation.y += 0.01;
  });
  world.nodes.userData.ring.material.opacity = lerp(world.nodes.userData.ring.material.opacity, 0.4 * rvT, 0.04);

  // motes always visible
  world.motes.material.uniforms.uTime.value = t;

  // grid fades out in reveal (city view)
  world.grid.material.opacity = lerp(world.grid.material.opacity, name === 'reveal' ? 0.12 : 0.35, k);
}

function atkF(x) { return x > 0.05 ? 1 : 0; }
function lerp(a, b, k) { return a + (b - a) * k; }
