import { useEffect, useRef } from 'react';

import * as THREE from 'three';

import { sound } from '../utils/audio';



interface CinematicCanvasProps {

  scrollProgress: number; // 0 to 1 across the full page

  tamperActive: boolean;

  isActive?: boolean;

}



export function CinematicCanvas({

  scrollProgress,

  tamperActive,

  isActive = true,

}: CinematicCanvasProps) {

  const containerRef = useRef<HTMLDivElement>(null);



  const isActiveRef = useRef(isActive);

  const stateRef = useRef({

    scrollProgress: 0,

    tamperActive: false,

    mouse: { x: 0, y: 0, targetX: 0, targetY: 0 },

  });



  // Sync props to ref for the animation loop

  useEffect(() => {

    isActiveRef.current = isActive;

    stateRef.current.scrollProgress = scrollProgress;

    stateRef.current.tamperActive = tamperActive;

  }, [scrollProgress, tamperActive, isActive]);



  useEffect(() => {

    const container = containerRef.current;

    if (!container) return;



    // 1. Scene, Camera, Renderer

    const scene = new THREE.Scene();

    scene.fog = new THREE.FogExp2(0x050507, 0.018);



    const camera = new THREE.PerspectiveCamera(

      45,

      container.clientWidth / container.clientHeight,

      0.1,

      200

    );

    camera.position.set(0, 4, 38);



    // Potato-proofing: quality scales with the detected hardware tier.
    const TIER = (window as unknown as { __BAYORA_TIER?: string }).__BAYORA_TIER || 'mid';
    const PR_CAP = TIER === 'low' ? 0.75 : TIER === 'mid' ? 1 : 1.5;
    const pr = Math.min(window.devicePixelRatio, PR_CAP);

    const renderer = new THREE.WebGLRenderer({

      antialias: TIER !== 'low',

      powerPreference: 'high-performance',

      alpha: true,

    });

    renderer.setSize(container.clientWidth, container.clientHeight);

    renderer.setPixelRatio(pr);

    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    renderer.toneMappingExposure = 1.1;

    container.appendChild(renderer.domElement);



    // RenderTarget for Background Refraction Pass (Real-Time Liquid Glass Distortion)

    const renderTarget = new THREE.WebGLRenderTarget(

      container.clientWidth * pr,

      container.clientHeight * pr,

      {

        minFilter: THREE.LinearFilter,

        magFilter: THREE.LinearFilter,

        format: THREE.RGBAFormat,

      }

    );



    // 2. Lighting

    const ambientLight = new THREE.AmbientLight(0x0a0c14, 1.2);

    scene.add(ambientLight);



    const keyLight = new THREE.DirectionalLight(0xffffff, 3.5);

    keyLight.position.set(5, 30, 10);

    scene.add(keyLight);



    const blueRimLight = new THREE.PointLight(0x00f0ff, 2.5, 50);

    blueRimLight.position.set(-15, 8, 5);

    scene.add(blueRimLight);



    const beamLight = new THREE.SpotLight(0xffffff, 15, 60, Math.PI / 8, 0.8, 1);

    beamLight.position.set(0, 26, 0);

    beamLight.target.position.set(0, 0, 0);

    scene.add(beamLight);

    scene.add(beamLight.target);



    // 3. Procedural Mountain Ridge Terrain

    const terrainGeo = new THREE.PlaneGeometry(120, 120, 120, 120);

    terrainGeo.rotateX(-Math.PI / 2);

    const pos = terrainGeo.attributes.position;



    // Fractal noise for mountain ridges with a central canyon/pathway

    for (let i = 0; i < pos.count; i++) {

      const x = pos.getX(i);

      const z = pos.getZ(i);

      const distFromCenter = Math.abs(x);



      // Ridge elevation increases as |x| grows

      let y = 0;

      if (distFromCenter > 4) {

        const factor = Math.min((distFromCenter - 4) * 0.45, 12);

        const noise1 = Math.sin(x * 0.15) * Math.cos(z * 0.18) * 4.5;

        const noise2 = Math.sin(x * 0.35 + z * 0.25) * 2.2;

        const noise3 = Math.cos(x * 0.8 - z * 0.6) * 0.8;

        y = factor + noise1 + noise2 + noise3;

      } else {

        // Flat central road where human silhouette stands

        y = Math.sin(z * 0.2) * 0.2;

      }

      pos.setY(i, y);

    }

    terrainGeo.computeVertexNormals();



    const terrainMat = new THREE.MeshStandardMaterial({

      color: 0x0c0d12,

      roughness: 0.85,

      metalness: 0.2,

      flatShading: true,

    });

    const terrain = new THREE.Mesh(terrainGeo, terrainMat);

    terrain.position.set(0, -1, 0);

    scene.add(terrain);



    // Wireframe overlay on terrain ridges for high-tech aesthetic

    const terrainWireMat = new THREE.MeshBasicMaterial({

      color: 0x222633,

      wireframe: true,

      transparent: true,

      opacity: 0.15,

    });

    const terrainWire = new THREE.Mesh(terrainGeo, terrainWireMat);

    terrainWire.position.set(0, -0.98, 0);

    scene.add(terrainWire);



    // 4. Central Figure Silhouette (Lone human standing in the valley)

    const figureGroup = new THREE.Group();

    // Body / Coat

    const coatGeo = new THREE.ConeGeometry(0.24, 1.1, 8);

    const darkMat = new THREE.MeshBasicMaterial({ color: 0x020204 });

    const coat = new THREE.Mesh(coatGeo, darkMat);

    coat.position.y = 0.55;

    figureGroup.add(coat);

    // Head / Helmet

    const headGeo = new THREE.SphereGeometry(0.12, 12, 12);

    const head = new THREE.Mesh(headGeo, darkMat);

    head.position.y = 1.18;

    figureGroup.add(head);

    // Silhouette rim highlight from the beam

    const helmetVisor = new THREE.Mesh(

      new THREE.SphereGeometry(0.08, 8, 8),

      new THREE.MeshBasicMaterial({ color: 0xffffff })

    );

    helmetVisor.position.set(0, 1.18, 0.08);

    helmetVisor.scale.set(1, 0.6, 0.5);

    figureGroup.add(helmetVisor);



    figureGroup.position.set(0, -0.9, 0);

    scene.add(figureGroup);



    // 5. Volumetric Light Beam (connecting cloud to ground)

    const beamGeo = new THREE.CylinderGeometry(0.3, 3.8, 25, 32, 1, true);

    beamGeo.translate(0, 12.5, 0);



    const beamMat = new THREE.ShaderMaterial({

      uniforms: {

        uColor: { value: new THREE.Color(0xffffff) },

        uIntensity: { value: 1.0 },

      },

      vertexShader: `

        varying vec2 vUv;

        varying vec3 vNormal;

        void main() {

          vUv = uv;

          vNormal = normalize(normalMatrix * normal);

          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

        }

      `,

      fragmentShader: `

        uniform vec3 uColor;

        uniform float uIntensity;

        varying vec2 vUv;

        varying vec3 vNormal;

        void main() {

          // Fade from bright top to soft bottom

          float verticalFade = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.6, vUv.y);

          float rim = pow(1.0 - abs(vNormal.z), 2.0);

          float alpha = verticalFade * (0.35 + rim * 0.65) * uIntensity;

          gl_FragColor = vec4(uColor, alpha);

        }

      `,

      transparent: true,

      blending: THREE.AdditiveBlending,

      side: THREE.DoubleSide,

      depthWrite: false,

    });

    const beam = new THREE.Mesh(beamGeo, beamMat);

    beam.position.set(0, -0.9, 0);

    scene.add(beam);



    // 6. Floating Luminous Particle Cloud (7,500 GPU particles)

    const particleCount = 7500;

    const particleGeo = new THREE.BufferGeometry();

    const particlePositions = new Float32Array(particleCount * 3);

    const particleVelocities = new Float32Array(particleCount * 3);

    const particleScales = new Float32Array(particleCount);

    const particlePhases = new Float32Array(particleCount);



    for (let i = 0; i < particleCount; i++) {

      const theta = Math.random() * Math.PI * 2;

      const radius = Math.pow(Math.random(), 1.6) * 12;

      const x = Math.cos(theta) * radius;

      const z = Math.sin(theta) * radius + (Math.random() - 0.5) * 6;

      const y = 14 + Math.random() * 12 - radius * 0.35;



      particlePositions[i * 3] = x;

      particlePositions[i * 3 + 1] = y;

      particlePositions[i * 3 + 2] = z;



      particleVelocities[i * 3] = (Math.random() - 0.5) * 0.015;

      particleVelocities[i * 3 + 1] = Math.random() * 0.01 + 0.005;

      particleVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.015;



      particleScales[i] = Math.random() * 2.5 + 0.8;

      particlePhases[i] = Math.random() * Math.PI * 2;

    }



    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));

    particleGeo.setAttribute('scale', new THREE.BufferAttribute(particleScales, 1));



    const canvas = document.createElement('canvas');

    canvas.width = 32;

    canvas.height = 32;

    const ctx = canvas.getContext('2d')!;

    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);

    grad.addColorStop(0, 'rgba(255,255,255,1)');

    grad.addColorStop(0.3, 'rgba(255,255,255,0.7)');

    grad.addColorStop(1, 'rgba(255,255,255,0)');

    ctx.fillStyle = grad;

    ctx.fillRect(0, 0, 32, 32);

    const particleTex = new THREE.CanvasTexture(canvas);



    const particleMat = new THREE.PointsMaterial({

      color: 0xffffff,

      size: 0.32,

      map: particleTex,

      transparent: true,

      blending: THREE.AdditiveBlending,

      depthWrite: false,

    });

    const particles = new THREE.Points(particleGeo, particleMat);

    scene.add(particles);



    // =========================================================================

    // 7. CURSOR-REACTIVE LIQUID-GLASS ORGANIC MEMBRANE (Lusion Signature Effect)

    // =========================================================================

    // High-resolution subdivided organic plane placed between camera (z=38) and landscape

    const membraneGeo = new THREE.PlaneGeometry(36, 24, 128, 128);



    const membraneMat = new THREE.ShaderMaterial({

      uniforms: {

        uSceneTexture: { value: renderTarget.texture },

        uResolution: {

          value: new THREE.Vector2(container.clientWidth * pr, container.clientHeight * pr),

        },

        uPointer: { value: new THREE.Vector2(0, 4.0) },

        uPointerVel: { value: new THREE.Vector2(0, 0) },

        uTime: { value: 0 },

        uScrollProgress: { value: 0 },

      },

      vertexShader: `

        uniform float uTime;

        uniform vec2 uPointer;

        uniform vec2 uPointerVel;

        uniform float uScrollProgress;



        varying vec2 vUv;

        varying vec3 vWorldPos;

        varying vec3 vNormal;

        varying vec3 vLocalPos;

        varying float vDistToPointer;



        float fluidNoise(vec2 p) {

          return sin(p.x * 0.42 + uTime * 0.65) * cos(p.y * 0.42 + uTime * 0.55) * 1.15

               + sin(p.x * 1.05 - uTime * 1.0) * sin(p.y * 0.90 + uTime * 0.75) * 0.52

               + cos(p.x * 2.1 + p.y * 1.7 + uTime * 1.3) * 0.22;

        }



        void main() {

          vUv = uv;

          vec3 pos = position;

          vLocalPos = position;



          // 1. Organic living breathing folds

          float wave = fluidNoise(pos.xy * 0.26);



          // 2. Cursor pull and stretch deformation

          float d = length(pos.xy - uPointer);

          vDistToPointer = d;



          // Smooth exponential pull envelope

          float pull = exp(-pow(d / 6.2, 2.0));



          // Pull vertices toward cursor on XY

          vec2 pullDir = (uPointer - pos.xy);

          pos.xy += pullDir * pull * 0.40;



          // Stretch forward on Z toward camera

          pos.z += (wave * 0.55 + pull * 3.2);



          // 3. Fluid inertia ripples lagging behind pointer

          float ripple = sin(d * 3.0 - uTime * 4.2) * exp(-d / 4.8) * length(uPointerVel) * 1.2;

          pos.z += ripple;



          // Compute surface normal via finite differences

          float eps = 0.16;

          float waveX = fluidNoise((pos.xy + vec2(eps, 0.0)) * 0.26);

          float waveY = fluidNoise((pos.xy + vec2(0.0, eps)) * 0.26);

          vec3 dX = vec3(eps, 0.0, (waveX - wave));

          vec3 dY = vec3(0.0, eps, (waveY - wave));

          vec3 computedNormal = normalize(cross(dX, dY));



          vNormal = normalize(normalMatrix * computedNormal);

          vec4 worldPos = modelMatrix * vec4(pos, 1.0);

          vWorldPos = worldPos.xyz;

          gl_Position = projectionMatrix * viewMatrix * worldPos;

        }

      `,

      fragmentShader: `

        uniform sampler2D uSceneTexture;

        uniform vec2 uResolution;

        uniform float uTime;

        uniform vec2 uPointer;

        uniform float uScrollProgress;



        varying vec2 vUv;

        varying vec3 vWorldPos;

        varying vec3 vNormal;

        varying vec3 vLocalPos;

        varying float vDistToPointer;



        void main() {

          vec2 screenUV = gl_FragCoord.xy / uResolution;



          // 1. Organic irregular silhouette (NOT a circle or rectangle)

          float dCenter = length(vLocalPos.xy / vec2(15.5, 10.2));

          float noiseLobe = sin(vLocalPos.x * 0.30 + uTime * 0.45) * cos(vLocalPos.y * 0.40 - uTime * 0.35) * 0.26

                          + sin(vLocalPos.x * 0.72 - uTime * 0.55) * 0.13;

          float cursorAttract = exp(-pow(vDistToPointer / 6.2, 2.0)) * 0.30;

          float boundary = dCenter - noiseLobe - cursorAttract;

          float alpha = smoothstep(1.08, 0.62, boundary);



          if (alpha < 0.005) discard;



          // 2. Refraction of the background landscape with subtle chromatic aberration

          vec2 refractOffset = vNormal.xy * 0.045;

          float r = texture2D(uSceneTexture, screenUV + refractOffset * 1.025).r;

          float g = texture2D(uSceneTexture, screenUV + refractOffset * 1.000).g;

          float b = texture2D(uSceneTexture, screenUV + refractOffset * 0.975).b;

          vec3 refractedEnv = vec3(r, g, b);



          // 3. Deep glossy obsidian / charcoal liquid glass body

          vec3 liquidBody = vec3(0.02, 0.025, 0.035);

          float foldThickness = clamp(abs(vNormal.x) + abs(vNormal.y), 0.0, 1.0);

          vec3 baseLiquid = mix(refractedEnv * 0.74, liquidBody, 0.42 + foldThickness * 0.38);



          // 4. Specular reflections from scene lights & moving pointer

          vec3 viewDir = normalize(cameraPosition - vWorldPos);



          // Key light specular highlight

          vec3 keyLightDir = normalize(vec3(5.0, 30.0, 10.0) - vWorldPos);

          vec3 keyHalf = normalize(keyLightDir + viewDir);

          float keySpec = pow(max(0.0, dot(vNormal, keyHalf)), 48.0) * 1.6;



          // Dynamic light following cursor (makes stretched folds gleam with silver reflections)

          vec3 cursorLightDir = normalize(vec3(uPointer.x, uPointer.y + 4.0, 16.0) - vWorldPos);

          vec3 cursorHalf = normalize(cursorLightDir + viewDir);

          float cursorSpec = pow(max(0.0, dot(vNormal, cursorHalf)), 28.0) * 1.3;



          // 5. Silvery Fresnel rim highlight

          float fresnel = pow(1.0 - max(0.0, dot(vNormal, viewDir)), 3.2);

          vec3 silverRim = vec3(0.85, 0.92, 1.0) * fresnel * 0.75;



          // 6. Deep fold crevice shading

          float cavity = pow(1.0 - clamp(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 2.2);

          baseLiquid *= (1.0 - cavity * 0.40);



          vec3 finalColor = baseLiquid 

                          + vec3(keySpec) * 1.0 

                          + vec3(cursorSpec) * vec3(0.9, 0.95, 1.0) 

                          + silverRim;



          // Fade out gracefully as user scrolls deeper into Scene 2/3

          float scrollFade = clamp(1.0 - uScrollProgress * 2.5, 0.0, 1.0);



          gl_FragColor = vec4(finalColor, alpha * 0.90 * scrollFade);

        }

      `,

      transparent: true,

      depthWrite: false,

    });



    const membraneMesh = new THREE.Mesh(membraneGeo, membraneMat);

    membraneMesh.position.set(0, 4.0, 18.0);

    scene.add(membraneMesh);



    // 8. Cybernetic Stardust Constellation (8,000 Interactive Star Particles)

    const entityCount = 8000;

    const entityGeo = new THREE.BufferGeometry();

    const entityPositions = new Float32Array(entityCount * 3);

    const entityOriginal = new Float32Array(entityCount * 3);

    const entityBlastDest = new Float32Array(entityCount * 3);

    const entityVelocity = new Float32Array(entityCount * 3);

    const entityColors = new Float32Array(entityCount * 3);

    const entityBaseColors = new Float32Array(entityCount * 3);

    const entityTwinkleSpeed = new Float32Array(entityCount);

    const entityTwinklePhases = new Float32Array(entityCount);



    // High-definition star flare texture with sparkling core & 4-point diffraction spike

    const starCanvas = document.createElement('canvas');

    starCanvas.width = 64;

    starCanvas.height = 64;

    const sCtx = starCanvas.getContext('2d')!;

    const sGrad = sCtx.createRadialGradient(32, 32, 0, 32, 32, 32);

    sGrad.addColorStop(0, 'rgba(255,255,255,1)');

    sGrad.addColorStop(0.2, 'rgba(180,240,255,0.9)');

    sGrad.addColorStop(0.55, 'rgba(0,210,255,0.35)');

    sGrad.addColorStop(1, 'rgba(0,0,0,0)');

    sCtx.fillStyle = sGrad;

    sCtx.fillRect(0, 0, 64, 64);

    sCtx.strokeStyle = 'rgba(255,255,255,0.75)';

    sCtx.lineWidth = 1.5;

    sCtx.beginPath();

    sCtx.moveTo(32, 10);

    sCtx.lineTo(32, 54);

    sCtx.moveTo(10, 32);

    sCtx.lineTo(54, 32);

    sCtx.stroke();

    const starTex = new THREE.CanvasTexture(starCanvas);



    for (let i = 0; i < entityCount; i++) {

      const u = Math.random() * Math.PI * 2;

      const v = Math.random() * Math.PI;



      // 1. Initial Spherical / Ellipsoid Constellation

      const r = 3.3 + (Math.random() - 0.5) * 0.5;

      const x = r * Math.sin(v) * Math.cos(u);

      const y = r * Math.cos(v) * 1.35;

      const z = r * Math.sin(v) * Math.sin(u) * 0.85;



      entityPositions[i * 3] = x;

      entityPositions[i * 3 + 1] = y;

      entityPositions[i * 3 + 2] = z;



      entityOriginal[i * 3] = x;

      entityOriginal[i * 3 + 1] = y;

      entityOriginal[i * 3 + 2] = z;



      // 2. Blast Destination: Wide field covering the entire screen in the background

      entityBlastDest[i * 3] = (Math.random() - 0.5) * 85;

      entityBlastDest[i * 3 + 1] = (Math.random() - 0.5) * 50;

      entityBlastDest[i * 3 + 2] = -Math.random() * 45;



      entityVelocity[i * 3] = 0;

      entityVelocity[i * 3 + 1] = 0;

      entityVelocity[i * 3 + 2] = 0;



      // Celestial Palette: Cyan, pure white, and azure

      const isWhite = Math.random() > 0.65;

      const cyanFactor = Math.sin(u * 2) * 0.5 + 0.5;

      const rCol = isWhite ? 0.95 : cyanFactor * 0.15;

      const gCol = isWhite ? 0.98 : 0.85 + cyanFactor * 0.15;

      const bCol = 1.0;



      entityColors[i * 3] = rCol;

      entityColors[i * 3 + 1] = gCol;

      entityColors[i * 3 + 2] = bCol;



      entityBaseColors[i * 3] = rCol;

      entityBaseColors[i * 3 + 1] = gCol;

      entityBaseColors[i * 3 + 2] = bCol;



      entityTwinkleSpeed[i] = 1.5 + Math.random() * 3.5;

      entityTwinklePhases[i] = Math.random() * Math.PI * 2;

    }



    entityGeo.setAttribute('position', new THREE.BufferAttribute(entityPositions, 3));

    entityGeo.setAttribute('color', new THREE.BufferAttribute(entityColors, 3));



    const entityMat = new THREE.PointsMaterial({

      size: 0.32,

      map: starTex,

      vertexColors: true,

      transparent: true,

      opacity: 0,

      blending: THREE.AdditiveBlending,

      depthWrite: false,

    });

    const cyberEntity = new THREE.Points(entityGeo, entityMat);

    cyberEntity.position.set(0, 3.8, -20);

    scene.add(cyberEntity);



    // Digital vertical rain strands

    const lineCount = 180;

    const lineGeo = new THREE.BufferGeometry();

    const linePositions = new Float32Array(lineCount * 6);

    for (let i = 0; i < lineCount; i++) {

      const lx = (Math.random() - 0.5) * 24;

      const lz = -20 + (Math.random() - 0.5) * 12;

      const ly = Math.random() * 25 - 5;

      const len = Math.random() * 3 + 1;



      linePositions[i * 6] = lx;

      linePositions[i * 6 + 1] = ly;

      linePositions[i * 6 + 2] = lz;



      linePositions[i * 6 + 3] = lx;

      linePositions[i * 6 + 4] = ly - len;

      linePositions[i * 6 + 5] = lz;

    }

    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));

    const lineMat = new THREE.LineBasicMaterial({

      color: 0x00f0ff,

      transparent: true,

      opacity: 0,

      blending: THREE.AdditiveBlending,

    });

    const digitalRain = new THREE.LineSegments(lineGeo, lineMat);

    scene.add(digitalRain);



    // 9. Scene 5: Cryptographic 3D Blockchain Blocks (SHA-256 Chain)

    const blockGroup = new THREE.Group();

    const blocks: THREE.Mesh[] = [];

    const blockCount = 4;



    for (let i = 0; i < blockCount; i++) {

      const bGeo = new THREE.BoxGeometry(2.4, 2.4, 2.4);

      const bMat = new THREE.MeshPhysicalMaterial({

        color: 0x0a1020,

        metalness: 0.9,

        roughness: 0.1,

        transmission: 0.85,

        thickness: 1.5,

        transparent: true,

        opacity: 0.85,

      });

      const bMesh = new THREE.Mesh(bGeo, bMat);

      bMesh.position.set((i - 1.5) * 4.5, 0, 0);



      const wire = new THREE.LineSegments(

        new THREE.EdgesGeometry(bGeo),

        new THREE.LineBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.7 })

      );

      bMesh.add(wire);



      blocks.push(bMesh);

      blockGroup.add(bMesh);

    }

    blockGroup.position.set(0, 2, -60);

    scene.add(blockGroup);



    // Connecting laser line between blocks

    const chainLineGeo = new THREE.BufferGeometry();

    const chainPoints = new Float32Array(blockCount * 3);

    for (let i = 0; i < blockCount; i++) {

      chainPoints[i * 3] = (i - 1.5) * 4.5;

      chainPoints[i * 3 + 1] = 0;

      chainPoints[i * 3 + 2] = 0;

    }

    chainLineGeo.setAttribute('position', new THREE.BufferAttribute(chainPoints, 3));

    const chainLine = new THREE.Line(

      chainLineGeo,

      new THREE.LineBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.6 })

    );

    blockGroup.add(chainLine);



    // 10. Pointer Physics & Auto-Scroll Stardust Detonation Engine

    let targetWorldX = 0;

    let targetWorldY = 4.0;

    let currentWorldX = 0;

    let currentWorldY = 4.0;

    let springVx = 0;

    let springVy = 0;

    let isMouseActive = false;



    // Auto-Scroll Detonation State

    let shakeEnergy = 0;

    let isBlasted = false;

    let scrollAccumulatedTime = 0; // accumulated seconds of active scrolling after section ends

    let lastScrollTime = 0;

    let lastScrollY = typeof window !== 'undefined' ? window.scrollY : 0;


    let lastFrameTime = performance.now();



    const detonateBlast = () => {

      if (isBlasted) return;

      isBlasted = true;

      shakeEnergy = 100;

      sound.playCosmicBlast();



      // Assign explosive radial blast velocities across 3D space

      for (let i = 0; i < entityCount; i++) {

        const i3 = i * 3;

        const ox = entityOriginal[i3];

        const oy = entityOriginal[i3 + 1];

        const oz = entityOriginal[i3 + 2];

        const dist = Math.hypot(ox, oy, oz) || 1;



        const blastSpeed = 1.6 + Math.random() * 3.4;

        entityVelocity[i3] = (ox / dist + (Math.random() - 0.5) * 1.6) * blastSpeed;

        entityVelocity[i3 + 1] = (oy / dist + (Math.random() - 0.5) * 1.6) * blastSpeed;

        entityVelocity[i3 + 2] = (oz / dist + (Math.random() - 0.5) * 1.6) * blastSpeed;

      }

    };



    const collapseBack = () => {

      if (!isBlasted) return;

      isBlasted = false;

      shakeEnergy = 0;

      scrollAccumulatedTime = 0;

      sound.stopBlastRiser();

      sound.playImplosion();

    };



    const onScroll = () => {

      lastScrollTime = performance.now();

    };

    const onWheel = () => {

      lastScrollTime = performance.now();

    };

    const onTouchMove = () => {

      lastScrollTime = performance.now();

    };



    const onMouseMove = (e: MouseEvent) => {

      isMouseActive = true;

      const nx = (e.clientX / window.innerWidth) * 2 - 1;

      const ny = -(e.clientY / window.innerHeight) * 2 + 1;

      stateRef.current.mouse.targetX = nx * 1.5;

      stateRef.current.mouse.targetY = ny * 1.2;



      const aspect = container.clientWidth / container.clientHeight;

      targetWorldX = nx * 9.0 * aspect;

      targetWorldY = 4.0 + ny * 6.5;

    };



    const onMouseLeave = () => {

      isMouseActive = false;

    };



    window.addEventListener('scroll', onScroll, { passive: true });

    window.addEventListener('wheel', onWheel, { passive: true });

    window.addEventListener('touchmove', onTouchMove, { passive: true });

    const handleCustomBlast = () => {
      if (isBlasted) {
        collapseBack();
        setTimeout(() => {
          detonateBlast();
        }, 220);
      } else {
        detonateBlast();
      }
    };
    window.addEventListener('bayora:trigger-blast', handleCustomBlast);

    window.addEventListener('mousemove', onMouseMove, { passive: true });

    document.addEventListener('mouseleave', onMouseLeave);



    // Resize handler

    const onResize = () => {

      if (!container) return;

      const w = container.clientWidth;

      const h = container.clientHeight;

      camera.aspect = w / h;

      camera.updateProjectionMatrix();

      renderer.setSize(w, h);

      renderTarget.setSize(w * pr, h * pr);

      membraneMat.uniforms.uResolution.value.set(w * pr, h * pr);

    };

    window.addEventListener('resize', onResize);



    // 11. Render Loop

    let animId = 0;

    let clockStart = performance.now();
    const LOW_TIER = ((window as unknown as { __BAYORA_TIER?: string }).__BAYORA_TIER || 'mid') === 'low';
    let lowFrameSkip = false;

    const animate = () => {
      animId = requestAnimationFrame(animate);

      // 60FPS IDLE OPTIMIZATION: When Page 1 (Editorial) is active, pause 3D calculations & rendering
      if (!isActiveRef.current || document.hidden) {
        return;
      }

      // Potato mode: cap to ~30fps on low-tier hardware (skip odd frames)
      if (LOW_TIER) {
        lowFrameSkip = !lowFrameSkip;
        if (lowFrameSkip) return;
      }

      // performance.now()-based elapsed time (THREE.Clock is deprecated in r180+)
      const elapsedTime = (performance.now() - clockStart) / 1000;

      const sp = stateRef.current.scrollProgress;

      const isTampered = stateRef.current.tamperActive;



      const now = performance.now();

      const dt = Math.min((now - lastFrameTime) / 1000, 0.1);

      lastFrameTime = now;



      // Active scroll detection

      const currentScrollY = window.scrollY;

      const scrollDelta = Math.abs(currentScrollY - lastScrollY);

      if (scrollDelta > 0.5) {

        lastScrollTime = now;

      }

      lastScrollY = currentScrollY;



      // 450ms window allows natural discrete mouse wheel ticks without resetting state
      const isActivelyScrolling = (now - lastScrollTime < 450) || scrollDelta > 0.5;

      // Determine if user has reached / passed the Architecture section into Scene 4
      const archEl = document.getElementById('architecture');
      const coreEl = document.getElementById('core');
      let isAfterArchitecture = false;

      if (coreEl) {
        const coreRect = coreEl.getBoundingClientRect();
        isAfterArchitecture = coreRect.top <= window.innerHeight * 0.75;
      } else if (archEl) {
        const archRect = archEl.getBoundingClientRect();
        isAfterArchitecture = archRect.bottom <= window.innerHeight * 0.75;
      } else {
        isAfterArchitecture = sp >= 0.58;
      }

      // Auto-blast logic:
      // When entering Scene 4, progressive scroll builds shake energy and detonates with authentic WHOOM
      if (isAfterArchitecture) {
        if (!isBlasted) {
          // If user scrolled deeply past or jumped into Scene 4, detonate immediately
          if (sp >= 0.68) {
            detonateBlast();
          } else if (isActivelyScrolling) {
            scrollAccumulatedTime += dt;
            shakeEnergy = Math.min((scrollAccumulatedTime / 0.5) * 100, 100);

            // Start the cinematic whoosh swell from the user's audio file as user begins scrolling
            if (!sound.isBlastActive()) {
              sound.startBlastRiser();
            }

            // Exactly ~0.5s of active scrolling: DETONATE!
            if (scrollAccumulatedTime >= 0.5) {
              detonateBlast();
            }
          } else {
            // Paused scrolling: decay energy smoothly (not instantly)
            shakeEnergy = Math.max(0, shakeEnergy - dt * 35);
            scrollAccumulatedTime = (shakeEnergy / 100) * 0.5;
            if (shakeEnergy < 10 && sound.isBlastActive()) {
              sound.stopBlastRiser();
            }
          }
        }
      } else {
        // Scrolled back up before architecture section ends
        if (sound.isBlastActive() && !isBlasted) {
          sound.stopBlastRiser();
        }
        if (sp < 0.40) {
          if (isBlasted) {
            collapseBack();
          }
          scrollAccumulatedTime = 0;
          shakeEnergy = 0;
        } else if (!isBlasted) {
          shakeEnergy = Math.max(0, shakeEnergy - dt * 60);
          scrollAccumulatedTime = 0;
        }
      }



      // Mouse lerp for pointer tracking

      stateRef.current.mouse.x += (stateRef.current.mouse.targetX - stateRef.current.mouse.x) * 0.05;

      stateRef.current.mouse.y += (stateRef.current.mouse.targetY - stateRef.current.mouse.y) * 0.05;



      // ---- SPRING PHYSICS FOR FLUID INERTIA & ELASTIC RELAXATION ----

      if (!isMouseActive) {

        // Slow ambient organic wandering when mouse leaves window

        targetWorldX = Math.sin(elapsedTime * 0.4) * 2.5;

        targetWorldY = 4.0 + Math.cos(elapsedTime * 0.35) * 1.8;

      }



      const spring = 0.075;

      const damping = 0.86;

      springVx += (targetWorldX - currentWorldX) * spring;

      springVy += (targetWorldY - currentWorldY) * spring;

      springVx *= damping;

      springVy *= damping;

      currentWorldX += springVx;

      currentWorldY += springVy;



      membraneMat.uniforms.uPointer.value.set(currentWorldX, currentWorldY);

      membraneMat.uniforms.uPointerVel.value.set(springVx, springVy);

      membraneMat.uniforms.uTime.value = elapsedTime;

      membraneMat.uniforms.uScrollProgress.value = sp;



      // Visible during Scene 1 and smoothly dissolves on scroll down

      membraneMesh.visible = sp < 0.40;



      // ---- CAMERA CHOREOGRAPHY ACROSS SCROLL ----

      if (sp < 0.28) {

        // Hero opening

        const p = sp / 0.28;

        camera.position.z = 38 - p * 12;

        camera.position.y = 4 + p * 2;

        camera.position.x = 0;

        camera.lookAt(0, 3 + p * 2, 0);



        terrain.position.y = -1;

        figureGroup.visible = true;

        beam.visible = true;

        particles.visible = true;

        entityMat.opacity = 0;

        lineMat.opacity = 0;

        blockGroup.visible = false;



        beamMat.uniforms.uIntensity.value = 1.0 + Math.sin(elapsedTime * 2.5) * 0.2;

      } else if (sp < 0.60) {

        // Landscape reveal & editorial recession

        const p = (sp - 0.28) / 0.32;

        camera.position.z = 26 - p * 20;

        camera.position.y = 6 - p * 2.2;

        camera.position.x = 0;

        camera.lookAt(0, 5 - p * 1.2, -10);



        terrain.position.y = -1 - p * 15;

        figureGroup.position.y = -0.9 - p * 15;

        beamMat.uniforms.uIntensity.value = Math.max(0, 1.2 - p * 1.5);



        entityMat.opacity = Math.min(p * 1.5, 0.95);

        lineMat.opacity = Math.min(p * 1.2, 0.45);

        blockGroup.visible = false;

      } else if (sp < 0.85) {

        // Futuristic Cybernetic Entity scene (Centred in middle of screen)

        const p = (sp - 0.60) / 0.25;

        camera.position.z = 6 - p * 18;

        camera.position.y = 3.8;

        camera.position.x = 0;

        camera.lookAt(0, 3.8, -20);



        figureGroup.visible = false;

        beam.visible = false;

        particles.visible = true;

        entityMat.opacity = isBlasted ? 0.95 : 0.95 - p * 0.4;

        lineMat.opacity = 0.45;

        blockGroup.visible = p > 0.4;

      } else {

        // Cryptographic Blockchain inspection

        const p = (sp - 0.85) / 0.15;

        camera.position.z = -12 - p * 38;

        camera.position.y = 3.8 - p * 1.8;

        camera.position.x = 0;

        camera.lookAt(0, 2, -60);



        blockGroup.visible = true;

        entityMat.opacity = isBlasted ? 0.95 : Math.max(0, 0.55 - p * 1.5);

        lineMat.opacity = Math.max(0, 0.3 - p);

      }



      // ---- PARTICLE DYNAMICS ----

      const posArr = particleGeo.attributes.position.array as Float32Array;

      for (let i = 0; i < particleCount; i++) {

        posArr[i * 3 + 1] += particleVelocities[i * 3 + 1];

        posArr[i * 3] += Math.sin(elapsedTime * 0.8 + particlePhases[i]) * 0.012;

        posArr[i * 3 + 2] += Math.cos(elapsedTime * 0.8 + particlePhases[i]) * 0.012;



        if (posArr[i * 3 + 1] > 32) {

          posArr[i * 3 + 1] = 12;

        }

      }

      particleGeo.attributes.position.needsUpdate = true;

      particles.rotation.y = elapsedTime * 0.03;



      // ---- CYBER STARDUST ENTITY: HOLD-TO-SHAKE, BLAST & COSMIC BACKGROUND DRIFT ----

      // Handled by auto-scroll detonation engine above



      if (isBlasted) {

        // Dispersed starfield floating across the entire background

        cyberEntity.rotation.y = elapsedTime * 0.03;

        cyberEntity.rotation.x = 0;



        const ePos = entityGeo.attributes.position.array as Float32Array;

        const eCol = entityGeo.attributes.color.array as Float32Array;



        for (let i = 0; i < entityCount; i++) {

          const i3 = i * 3;

          // Apply supersonic explosion velocity

          ePos[i3] += entityVelocity[i3];

          ePos[i3 + 1] += entityVelocity[i3 + 1];

          ePos[i3 + 2] += entityVelocity[i3 + 2];



          // Air drag & deceleration

          entityVelocity[i3] *= 0.92;

          entityVelocity[i3 + 1] *= 0.92;

          entityVelocity[i3 + 2] *= 0.92;



          // Gravitate towards wide cosmic screen background coordinates

          ePos[i3] += (entityBlastDest[i3] - ePos[i3]) * 0.022;

          ePos[i3 + 1] += (entityBlastDest[i3 + 1] - ePos[i3 + 1]) * 0.022;

          ePos[i3 + 2] += (entityBlastDest[i3 + 2] - ePos[i3 + 2]) * 0.022;



          // Gentle cosmic orbital drift

          ePos[i3] += Math.sin(elapsedTime * 0.4 + entityTwinklePhases[i]) * 0.015;

          ePos[i3 + 1] += Math.cos(elapsedTime * 0.35 + entityTwinklePhases[i]) * 0.012;



          // Dynamic star twinkling & shimmering

          const tw = 0.4 + 0.6 * Math.sin(elapsedTime * entityTwinkleSpeed[i] + entityTwinklePhases[i]);

          eCol[i3] = entityBaseColors[i3] * tw;

          eCol[i3 + 1] = entityBaseColors[i3 + 1] * tw;

          eCol[i3 + 2] = entityBaseColors[i3 + 2] * (0.7 + tw * 0.3);

        }

        entityGeo.attributes.position.needsUpdate = true;

        entityGeo.attributes.color.needsUpdate = true;

      } else {

        // Spherical constellation with wave breathing & shake jitter (centered, zero lateral sway)

        cyberEntity.rotation.y = elapsedTime * 0.08;

        cyberEntity.rotation.x = 0;



        const ePos = entityGeo.attributes.position.array as Float32Array;

        const eCol = entityGeo.attributes.color.array as Float32Array;

        const charge = shakeEnergy / 100;



        for (let i = 0; i < entityCount; i++) {

          const i3 = i * 3;

          const ox = entityOriginal[i3];

          const oy = entityOriginal[i3 + 1];

          const oz = entityOriginal[i3 + 2];

          const wave = Math.sin(elapsedTime * 2.5 + oy * 1.5) * 0.04;

          const jitter = charge * 0.5 * (Math.random() - 0.5);



          const targetX = ox * (1 + wave) + jitter;

          const targetY = oy + jitter;

          const targetZ = oz * (1 + wave) + jitter;



          // Smooth pull back to core

          ePos[i3] += (targetX - ePos[i3]) * 0.12;

          ePos[i3 + 1] += (targetY - ePos[i3 + 1]) * 0.12;

          ePos[i3 + 2] += (targetZ - ePos[i3 + 2]) * 0.12;



          // White electric flash while charging up shake energy

          eCol[i3] = THREE.MathUtils.lerp(entityBaseColors[i3], 1.0, charge);

          eCol[i3 + 1] = THREE.MathUtils.lerp(entityBaseColors[i3 + 1], 1.0, charge);

          eCol[i3 + 2] = THREE.MathUtils.lerp(entityBaseColors[i3 + 2], 1.0, charge);

        }

        entityGeo.attributes.position.needsUpdate = true;

        entityGeo.attributes.color.needsUpdate = true;

      }



      // ---- DIGITAL RAIN ANIMATION ----

      const lPos = lineGeo.attributes.position.array as Float32Array;

      for (let i = 0; i < lineCount; i++) {

        lPos[i * 6 + 1] -= 0.15;

        lPos[i * 6 + 4] -= 0.15;

        if (lPos[i * 6 + 1] < -8) {

          lPos[i * 6 + 1] = 22;

          lPos[i * 6 + 4] = 20;

        }

      }

      lineGeo.attributes.position.needsUpdate = true;



      // ---- BLOCKCHAIN ROTATION & TAMPER ALERT ----

      if (blockGroup.visible) {

        blocks.forEach((b, idx) => {

          b.rotation.x = elapsedTime * 0.4 + idx;

          b.rotation.y = elapsedTime * 0.3 + idx;



          const mat = b.material as THREE.MeshPhysicalMaterial;

          const wireMat = (b.children[0] as THREE.LineSegments).material as THREE.LineBasicMaterial;



          if (isTampered && idx === 2) {

            const pulse = (Math.sin(elapsedTime * 8) + 1) * 0.5;

            mat.color.setHex(0xff1133);

            wireMat.color.setHex(0xff3344);

            mat.emissive = new THREE.Color(0xff1133);

            mat.emissiveIntensity = 0.6 + pulse * 0.8;

            b.position.y = Math.sin(elapsedTime * 6) * 0.3;

          } else {

            mat.color.setHex(0x0a1020);

            wireMat.color.setHex(0x00f0ff);

            mat.emissive = new THREE.Color(0x000000);

            mat.emissiveIntensity = 0;

            b.position.y = Math.sin(elapsedTime * 1.2 + idx * 0.8) * 0.15;

          }

        });

      }



      // ---- RENDER PIPELINE WITH REFRACTIVE LIQUID MEMBRANE PASS ----

      if (membraneMesh.visible) {

        // Pass 1: Render background landscape to RTT texture

        membraneMesh.visible = false;

        renderer.setRenderTarget(renderTarget);

        renderer.render(scene, camera);



        // Pass 2: Render composite with refracting liquid-glass membrane to screen

        membraneMesh.visible = true;

        renderer.setRenderTarget(null);

        renderer.render(scene, camera);

      } else {

        renderer.setRenderTarget(null);

        renderer.render(scene, camera);

      }

    };



    animate();



    // 12. Cleanup

    return () => {

      cancelAnimationFrame(animId);

      window.removeEventListener('scroll', onScroll);

      window.removeEventListener('wheel', onWheel);

      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('bayora:trigger-blast', handleCustomBlast);

      window.removeEventListener('mousemove', onMouseMove);

      document.removeEventListener('mouseleave', onMouseLeave);

      window.removeEventListener('resize', onResize);



      if (container.contains(renderer.domElement)) {

        container.removeChild(renderer.domElement);

      }

      renderer.dispose();

      renderTarget.dispose();

      membraneGeo.dispose();

      membraneMat.dispose();

      terrainGeo.dispose();

      terrainMat.dispose();

      terrainWireMat.dispose();

      particleGeo.dispose();

      particleMat.dispose();

      particleTex.dispose();

      starTex.dispose();

      entityGeo.dispose();

      entityMat.dispose();

      beamGeo.dispose();

      beamMat.dispose();

      lineGeo.dispose();

      lineMat.dispose();

      blocks.forEach((b) => {

        b.geometry.dispose();

        (b.material as THREE.Material).dispose();

      });

    };

  }, []);



  return (

    <div

      ref={containerRef}

      className="fixed inset-0 pointer-events-none z-0 overflow-hidden"

      style={{ opacity: 1 }}

    />

  );

}

