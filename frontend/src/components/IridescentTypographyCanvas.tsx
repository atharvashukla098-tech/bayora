import { useEffect, useRef } from 'react';

interface IridescentTypographyCanvasProps {
  onPointerMove?: (e: React.PointerEvent) => void;
}

export function IridescentTypographyCanvas({ onPointerMove: _externalPointerMove, paused = false }: IridescentTypographyCanvasProps & { paused?: boolean }) {
  const pausedRef = useRef(paused);
  pausedRef.current = paused; // live value for the render loop

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Zero-lag WebGL context: disables MSAA overhead and depth/stencil buffers
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) return;

    function createShader(type: number, src: string) {
      const shader = gl!.createShader(type);
      if (!shader) return null;
      gl!.shaderSource(shader, src);
      gl!.compileShader(shader);
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl!.getShaderInfoLog(shader));
        gl!.deleteShader(shader);
        return null;
      }
      return shader;
    }

    function createProgram(vsSrc: string, fsSrc: string) {
      const vs = createShader(gl!.VERTEX_SHADER, vsSrc);
      const fs = createShader(gl!.FRAGMENT_SHADER, fsSrc);
      if (!vs || !fs) return null;
      const prog = gl!.createProgram();
      if (!prog) return null;
      gl!.attachShader(prog, vs);
      gl!.attachShader(prog, fs);
      gl!.linkProgram(prog);
      if (!gl!.getProgramParameter(prog, gl!.LINK_STATUS)) {
        console.error('Program link error:', gl!.getProgramInfoLog(prog));
        return null;
      }
      return prog;
    }

    const vsSource = `
      attribute vec2 a_pos;
      varying vec2 v_uv;
      void main() {
        v_uv = (a_pos + 1.0) * 0.5;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;

    // Ultra-optimized Lusion-Style Chromatic Typography Shader:
    // Strictly masks refraction to letter geometry (zero background glow)
    // Avoids dynamic trigonometric loops; uses compile-time rotation matrices and guarded texture reads.
    const fsSource = `
      precision mediump float;
      varying vec2 v_uv;
      uniform sampler2D u_trailTex;
      uniform sampler2D u_maskTex;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform vec2 u_mouse;
      uniform float u_glance;

      // Fast, lightweight pseudo-random hash
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }

      // Compile-time rotation matrix to eliminate runtime trigonometry in turbulence
      const mat2 ROT2D = mat2(0.87758, 0.47942, -0.47942, 0.87758);
      float fastTurbulence(vec2 p) {
        float v = 0.5 * noise(p);
        p = ROT2D * p * 2.05 + vec2(7.2, 3.4);
        v += 0.25 * noise(p);
        return v * 1.333;
      }

      void main() {
        vec2 uv = v_uv;
        vec2 texel = 1.0 / u_resolution;

        // Base typography mask:
        // r = letter fill, g = architectural outline, b = bevel contour
        vec4 maskBase = texture2D(u_maskTex, uv);

        // Pitch dark obsidian canvas base (#06070a)
        vec3 bg = vec3(0.024, 0.027, 0.038);

        // Inactive resting typography: subtle ghost outline
        vec3 idleOutline = vec3(0.038, 0.044, 0.058);
        vec3 idleFill = bg;
        vec3 idleBevel = vec3(0.030, 0.035, 0.046);

        // Resting canvas state: text is very faint normally so foreground is unobstructed
        vec3 restingColor = bg;
        restingColor = mix(restingColor, idleFill, maskBase.r * 0.05);
        restingColor = mix(restingColor, idleOutline, maskBase.g * 0.28);
        restingColor = mix(restingColor, idleBevel, maskBase.b * 0.08);

        // Sample Trail Intensity
        float t = texture2D(u_trailTex, uv).r;

        // Refresh-Activated Diagonal Glance Sheen:
        float glanceBeam = 0.0;
        vec2 glanceNormal = vec2(0.0);
        if (u_glance >= 0.0 && u_glance <= 1.0) {
          // Quintic ease: zero initial/final jerk for buttery-smooth motion
          float g = u_glance;
          float smoothP = g * g * g * (g * (g * 6.0 - 15.0) + 10.0);
          float diagCoord = uv.x * 0.75 + (1.0 - uv.y) * 0.45;
          float sweepCenter = mix(-0.25, 1.45, smoothP);
          float dist = abs(diagCoord - sweepCenter);

          // Wide luminous sweep beam
          float beam = smoothstep(0.32, 0.0, dist);
          // Crisp radiant core gleam in the center of the beam
          float core = smoothstep(0.10, 0.0, dist);
          
          glanceBeam = beam * 0.75 + core * 0.55;
          
          // Introduce light wave normal deflection for crystalline refraction
          float slope = (diagCoord - sweepCenter) / 0.32;
          if (abs(slope) <= 1.0) {
            glanceNormal = vec2(-slope * 0.5, slope * 0.5) * beam;
          }
        }

        // Combine cursor fluid trail 't' with the glance beam
        float effectiveT = max(t, glanceBeam);

        // STRICT TEXT CONTAINMENT: Early return if pixel is not on text or has no light!
        float textCoverage = clamp(maskBase.r + maskBase.g * 1.5, 0.0, 1.0);
        if (effectiveT < 0.003 || textCoverage < 0.003) {
          gl_FragColor = vec4(restingColor, 1.0);
          return;
        }

        // Local gradient of fluid trail for 3D liquid surface normal (only sampled when trail is present)
        vec2 trailGrad = vec2(0.0);
        if (t > 0.003) {
          float tR = texture2D(u_trailTex, uv + vec2(texel.x * 3.5, 0.0)).r;
          float tL = texture2D(u_trailTex, uv - vec2(texel.x * 3.5, 0.0)).r;
          float tU = texture2D(u_trailTex, uv + vec2(0.0, texel.y * 3.5)).r;
          float tD = texture2D(u_trailTex, uv - vec2(0.0, texel.y * 3.5)).r;
          trailGrad = vec2(tR - tL, tU - tD);
        }

        // Combine trail gradient with glance normal
        vec2 combinedGrad = trailGrad + glanceNormal * 0.35;

        // Subtle living fluid turbulence with ultra-fast 2-octave generator
        float turb = fastTurbulence(uv * 7.5 + u_time * 0.2) * 0.12;
        vec2 fluidNormal = combinedGrad * 24.0 + vec2(turb, -turb) * (0.12 + effectiveT * 0.88);

        // True chromatic dispersion (split R, G, B refractive indices like real glass)
        float disp = 0.015 * clamp(effectiveT * 1.3, 0.0, 1.0);
        float maskRefractR = texture2D(u_maskTex, uv - fluidNormal * (disp * 1.25)).r;
        float maskRefractG = texture2D(u_maskTex, uv - fluidNormal * disp).r;
        float maskRefractB = texture2D(u_maskTex, uv - fluidNormal * (disp * 0.75)).r;

        // 3D Liquid Surface Normal & Specular Highlights
        vec3 N = normalize(vec3(-fluidNormal.x, -fluidNormal.y, 1.0));
        vec3 lightDir = vec3(0.334, 0.627, 0.752); // Pre-normalized (0.4, 0.75, 0.9)
        vec3 viewDir = vec3(0.0, 0.0, 1.0);
        vec3 H = vec3(0.187, 0.350, 0.978); // Pre-normalized (lightDir + viewDir)

        float NdotH = max(0.0, dot(N, H));
        float spec = pow(NdotH, 24.0) * 3.2 * effectiveT;
        float fresnel = pow(1.0 - max(0.0, dot(N, viewDir)), 2.4);

        // Lusion authentic thin-film chromatic spectrum:
        float phase = dot(N.xy, vec2(3.2, 4.0)) + u_time * 0.35 + effectiveT * 2.2;
        vec3 cCyan   = vec3(0.00, 0.92, 1.00); // Electric Cyan
        vec3 cBlue   = vec3(0.08, 0.28, 0.98); // Deep Cobalt
        vec3 cViolet = vec3(0.78, 0.10, 0.95); // Prismatic Violet
        vec3 cRuby   = vec3(0.98, 0.12, 0.30); // Molten Ruby
        vec3 cGold   = vec3(1.00, 0.65, 0.08); // Liquid Gold

        float p = fract(phase * 0.20);
        vec3 irid;
        if (p < 0.25) irid = mix(cCyan, cBlue, p * 4.0);
        else if (p < 0.5) irid = mix(cBlue, cViolet, (p - 0.25) * 4.0);
        else if (p < 0.75) irid = mix(cViolet, cRuby, (p - 0.5) * 4.0);
        else irid = mix(cRuby, cGold, (p - 0.75) * 4.0);

        // Prismatic liquid color with specular shine & fresnel edge glow
        vec3 liquidColor = irid * (0.85 + 1.15 * fresnel) + vec3(spec * 1.8);

        // Apply chromatic dispersion to color channels
        vec3 dispersedColor = vec3(
          liquidColor.r * (0.4 + maskRefractR * 0.6),
          liquidColor.g * (0.4 + maskRefractG * 0.6),
          liquidColor.b * (0.4 + maskRefractB * 0.6)
        );

        // Level of color revelation based on trail intensity 't':
        float reveal = smoothstep(0.015, 0.40, effectiveT);

        // Cursor Reveal Dynamics
        float cursorReveal = clamp(effectiveT * 2.4, 0.0, 1.0);
        vec3 activeStroke = mix(vec3(0.58, 0.68, 0.82), vec3(0.95, 0.98, 1.0), cursorReveal);
        vec3 activeFill   = mix(vec3(0.04, 0.05, 0.08), vec3(0.12, 0.15, 0.22), cursorReveal);
        vec3 activeBevel  = mix(vec3(0.45, 0.55, 0.70), vec3(0.90, 0.95, 1.0), cursorReveal);

        vec3 revealedLetter = restingColor;
        revealedLetter = mix(revealedLetter, activeFill, maskBase.r * cursorReveal);
        revealedLetter = mix(revealedLetter, activeStroke, maskBase.g * (cursorReveal * 1.2));
        revealedLetter = mix(revealedLetter, activeBevel, maskBase.b * (cursorReveal * 0.6));

        // Combine refracted liquid fill + crystalline stroke edge highlights
        vec3 activeText = dispersedColor * 1.5;
        activeText += liquidColor * maskBase.g * (1.2 + spec * 2.2);

        // Composite revealed text structure with vivid liquid chromatic sparks
        vec3 finalColor = mix(revealedLetter, activeText, reveal * textCoverage);

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `;

    const progRaw = createProgram(vsSource, fsSource);
    if (!progRaw) return;
    const prog: WebGLProgram = progRaw;

    // Cache ALL uniform locations upfront: Zero getUniformLocation lookups inside render() loop!
    const uniforms = {
      trailTex: gl.getUniformLocation(prog, 'u_trailTex'),
      maskTex: gl.getUniformLocation(prog, 'u_maskTex'),
      resolution: gl.getUniformLocation(prog, 'u_resolution'),
      time: gl.getUniformLocation(prog, 'u_time'),
      mouse: gl.getUniformLocation(prog, 'u_mouse'),
      glance: gl.getUniformLocation(prog, 'u_glance'),
    };
    const posLoc = gl.getAttribLocation(prog, 'a_pos');

    // Quad buffer
    const quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    // High-performance 256x128 trail canvas (75% less pixel overhead, silky fluid simulation)
    const TRAIL_W = 256;
    const TRAIL_H = 128;
    const trailCanvas = document.createElement('canvas');
    trailCanvas.width = TRAIL_W;
    trailCanvas.height = TRAIL_H;
    const trailCtx = trailCanvas.getContext('2d');
    if (trailCtx) {
      trailCtx.fillStyle = '#000000';
      trailCtx.fillRect(0, 0, TRAIL_W, TRAIL_H);
    }

    const trailTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, trailTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      trailCanvas
    );

    // Typography Mask Texture
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = 16;
    maskCanvas.height = 16;
    const maskCtx = maskCanvas.getContext('2d');
    if (maskCtx) {
      maskCtx.fillStyle = '#000000';
      maskCtx.fillRect(0, 0, 16, 16);
    }
    const maskTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      maskCanvas
    );

    // Pre-set static texture sampler units once
    gl.useProgram(prog);
    gl.uniform1i(uniforms.trailTex, 0);
    gl.uniform1i(uniforms.maskTex, 1);

    // Pre-warm the GPU pipeline: triggers driver shader compilation upfront to eliminate first-frame branch stutter
    gl.uniform2f(uniforms.resolution, 128, 128);
    gl.uniform1f(uniforms.time, 0.0);
    gl.uniform2f(uniforms.mouse, 0.5, 0.5);
    gl.uniform1f(uniforms.glance, 0.5);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.finish();

    // Loop & Animation State
    let isGlancing = false;
    let glanceStartTime = -1;
    const GLANCE_DURATION = 1200; // ms (~1.2 seconds)
    let animationFrameId = 0;
    let isVisible = false;
    let isLoopRunning = false;
    let lastTime = performance.now();
    let trailFadingFrames = 0; // Only upload trail texture while cursor moves or trail decays!
    let hasSeenGlance = false;

    // Pointer dynamics
    const pointer = {
      targetX: 0.5,
      targetY: 0.5,
      currentX: 0.5,
      currentY: 0.5,
      prevX: 0.5,
      prevY: 0.5,
      active: false,
      lastMoveTime: 0,
    };

        let resumePending = false;
function render(now: number) {
      if (pausedRef.current) { resumePending = true; requestAnimationFrame(render); return; } // paused: keep the loop ALIVE, skip the work
      if (resumePending) { resumePending = false; requestAnimationFrame(render); return; } // staggered resume: skip 1 frame
      if (!isVisible || document.hidden) {
        isLoopRunning = false;
        return;
      }

      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      // 1. UPDATE DYNAMIC TRAIL BUFFER ONLY WHEN DIRTY / FADING (0 CPU/GPU waste during glance/idle)
      if (trailCtx && trailFadingFrames > 0) {
        trailFadingFrames--;
        trailCtx.fillStyle = 'rgba(0, 0, 0, 0.085)';
        trailCtx.fillRect(0, 0, TRAIL_W, TRAIL_H);

        pointer.prevX = pointer.currentX;
        pointer.prevY = pointer.currentY;

        const timeSinceMove = now - pointer.lastMoveTime;
        const isUserActive = pointer.active && timeSinceMove < 750;

        if (isUserActive) {
          const lerpSpeed = 26.0;
          pointer.currentX += (pointer.targetX - pointer.currentX) * Math.min(lerpSpeed * dt, 1.0);
          pointer.currentY += (pointer.targetY - pointer.currentY) * Math.min(lerpSpeed * dt, 1.0);

          const posX = pointer.currentX;
          const posY = pointer.currentY;

          const vx = (posX - pointer.prevX) * TRAIL_W;
          const vy = (posY - pointer.prevY) * TRAIL_H;
          const speed = Math.hypot(vx, vy);

          const ptX = posX * TRAIL_W;
          const ptY = (1.0 - posY) * TRAIL_H;
          const prevPtX = pointer.prevX * TRAIL_W;
          const prevPtY = (1.0 - pointer.prevY) * TRAIL_H;

          const speedFactor = Math.min(speed / 14.0, 1.0);
          const radius = 6 + speedFactor * 24;
          const stampAlpha = 0.30 + speedFactor * 0.67;

          const grad = trailCtx.createRadialGradient(ptX, ptY, 1, ptX, ptY, radius);
          grad.addColorStop(0, `rgba(255, 255, 255, ${stampAlpha})`);
          grad.addColorStop(0.40, `rgba(255, 255, 255, ${stampAlpha * 0.6})`);
          grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');

          trailCtx.fillStyle = grad;
          trailCtx.beginPath();
          trailCtx.arc(ptX, ptY, radius, 0, Math.PI * 2);
          trailCtx.fill();

          if (speed > 0.35) {
            trailCtx.beginPath();
            trailCtx.moveTo(prevPtX, prevPtY);
            trailCtx.lineTo(ptX, ptY);
            trailCtx.strokeStyle = `rgba(255, 255, 255, ${stampAlpha * 0.75})`;
            trailCtx.lineWidth = radius * 0.85;
            trailCtx.lineCap = 'round';
            trailCtx.stroke();
          }
        }

        // Fast in-place sub-image upload: avoids allocating new GPU texture memory
        gl!.bindTexture(gl!.TEXTURE_2D, trailTex);
        gl!.texSubImage2D(
          gl!.TEXTURE_2D,
          0,
          0,
          0,
          gl!.RGBA,
          gl!.UNSIGNED_BYTE,
          trailCanvas
        );
      }

      // 2. RENDER COMPOSITE SHADER
      gl!.viewport(0, 0, canvas!.width, canvas!.height);
      gl!.useProgram(prog);

      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(gl!.TEXTURE_2D, trailTex);

      gl!.activeTexture(gl!.TEXTURE1);
      gl!.bindTexture(gl!.TEXTURE_2D, maskTex);

      gl!.uniform2f(uniforms.resolution, canvas!.width, canvas!.height);
      gl!.uniform1f(uniforms.time, now * 0.001);
      gl!.uniform2f(uniforms.mouse, pointer.currentX, pointer.currentY);

      let glanceVal = -1.0;
      if (isGlancing && glanceStartTime > 0) {
        const elapsed = now - glanceStartTime;
        if (elapsed >= 0) {
          glanceVal = Math.min(elapsed / GLANCE_DURATION, 1.0);
          if (elapsed >= GLANCE_DURATION) {
            isGlancing = false;
            glanceVal = -1.0;
          }
        }
      }
      gl!.uniform1f(uniforms.glance, glanceVal);

      gl!.bindBuffer(gl!.ARRAY_BUFFER, quadBuf);
      gl!.enableVertexAttribArray(posLoc);
      gl!.vertexAttribPointer(posLoc, 2, gl!.FLOAT, false, 0, 0);
      gl!.drawArrays(gl!.TRIANGLES, 0, 6);

      // Adaptive Sleep/Wake: continue looping while glance is active, trail is decaying, or cursor is active
      const timeSinceMove = now - pointer.lastMoveTime;
      const isUserActive = pointer.active && timeSinceMove < 750;
      const shouldKeepLooping = isGlancing || trailFadingFrames > 0 || isUserActive;

      if (shouldKeepLooping) {
        animationFrameId = requestAnimationFrame(render);
      } else {
        isLoopRunning = false;
      }
    }

    function ensureLoopRunning() {
      if (!isLoopRunning && isVisible) {
        isLoopRunning = true;
        lastTime = performance.now();
        animationFrameId = requestAnimationFrame(render);
      }
    }

    const triggerGlance = () => {
      glanceStartTime = performance.now();
      isGlancing = true;
      ensureLoopRunning();
    };

    (window as unknown as { __triggerTextGlance?: () => void }).__triggerTextGlance = () => {
      triggerGlance();
    };

    function updateTypographyMask(width: number, height: number) {
      if (!maskCtx || width <= 0 || height <= 0) return;

      // Clamp DPR to max 1.25: preserves razor-sharp 120px typography while saving up to 75% fill-rate
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      const targetW = Math.max(1, Math.floor(width * dpr));
      const targetH = Math.max(1, Math.floor(height * dpr));

      maskCanvas.width = targetW;
      maskCanvas.height = targetH;

      const mw = maskCanvas.width;
      const mh = maskCanvas.height;

      // Clear with pitch black
      maskCtx.fillStyle = '#000000';
      maskCtx.fillRect(0, 0, mw, mh);

      // All 4 Giant Typography Lines
      const lines = [
        'VERIFY EVERY PROMPT.',
        'CONTAIN AT THE ROOT.',
        'ENFORCE ZERO TRUST.',
        'PROVE ZERO TAMPER.',
      ];

      maskCtx.font = `900 100px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif`;
      const targetWidth = mw * 0.94;
      const startX = Math.max(mw * 0.03, 16 * dpr);

      const maxMeasuredWidth = Math.max(...lines.map(line => maskCtx.measureText(line).width));
      const fittedFontSize = Math.floor((targetWidth / maxMeasuredWidth) * 100);

      const targetFontSize = Math.min(fittedFontSize, Math.floor(mh / 5.2));
      maskCtx.font = `900 ${targetFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif`;
      maskCtx.textAlign = 'left';
      maskCtx.textBaseline = 'top';

      const y0 = Math.max(Math.floor(mh * 0.02), 16 * dpr);
      const line0Bottom = y0 + targetFontSize;

      // Safe clearance between Line 0 and Line 1 for foreground headline, dock, and explanation cards
      const gap01 = Math.max(Math.floor(mh * 0.38), 440 * dpr);
      const y1 = line0Bottom + gap01;
      const line1Bottom = y1 + targetFontSize;

      // Tight cohesive leading between Line 1, 2, and 3
      const gapBetween = Math.max(Math.floor(mh * 0.04), 36 * dpr);
      const y2 = line1Bottom + gapBetween;
      const line2Bottom = y2 + targetFontSize;
      const y3 = line2Bottom + gapBetween;

      const linePositions = [y0, y1, y2, y3];

      if (container && container.parentElement) {
        container.parentElement.style.setProperty('--dock-slot-top', `${Math.round(line0Bottom / dpr)}px`);
        container.parentElement.style.setProperty('--dock-slot-height', `${Math.round(gap01 / dpr)}px`);
      }

      // 1. Channel Blue: Crisp Refractive Bevel Fringe
      maskCtx.save();
      maskCtx.strokeStyle = '#0000ff';
      maskCtx.lineWidth = 4.5 * dpr;
      maskCtx.lineJoin = 'round';
      lines.forEach((line, i) => {
        maskCtx.strokeText(line, startX, linePositions[i]);
      });
      maskCtx.restore();

      // 2. Channel Red: Solid Interior Fill Mask
      maskCtx.save();
      maskCtx.globalCompositeOperation = 'source-over';
      maskCtx.fillStyle = '#ff0000';
      lines.forEach((line, i) => {
        maskCtx.fillText(line, startX, linePositions[i]);
      });
      maskCtx.restore();

      // 3. Channel Green: Architectural Outlines
      maskCtx.save();
      maskCtx.globalCompositeOperation = 'screen';
      maskCtx.strokeStyle = '#00ff00';
      maskCtx.lineWidth = 2.6 * dpr;
      maskCtx.lineJoin = 'round';
      lines.forEach((line, i) => {
        maskCtx.strokeText(line, startX, linePositions[i]);
      });
      maskCtx.restore();

      // Upload to WebGL texture
      gl!.bindTexture(gl!.TEXTURE_2D, maskTex);
      gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, 1);
      gl!.texImage2D(
        gl!.TEXTURE_2D,
        0,
        gl!.RGBA,
        gl!.RGBA,
        gl!.UNSIGNED_BYTE,
        maskCanvas
      );
    }

    // Defer font reload mask upload if glance is currently active
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (container) {
          if (isGlancing) {
            setTimeout(() => {
              if (container) updateTypographyMask(container.clientWidth, container.clientHeight);
            }, GLANCE_DURATION + 100);
          } else {
            updateTypographyMask(container.clientWidth, container.clientHeight);
          }
        }
      });
    }

    const handleGlobalPointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const isInside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;

      if (!isInside) {
        pointer.active = false;
        return;
      }

      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, 1.0 - (e.clientY - rect.top) / rect.height));

      if (!pointer.active) {
        pointer.currentX = x;
        pointer.currentY = y;
        pointer.prevX = x;
        pointer.prevY = y;
      }

      pointer.targetX = x;
      pointer.targetY = y;
      pointer.active = true;
      pointer.lastMoveTime = performance.now();
      trailFadingFrames = 42; // Keep updating trail texture while active + decay
      ensureLoopRunning();
    };

    window.addEventListener('pointermove', handleGlobalPointerMove, { passive: true });

    function resize() {
      const width = container!.clientWidth;
      const height = container!.clientHeight;
      if (width === 0 || height === 0) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      canvas!.width = Math.floor(width * dpr);
      canvas!.height = Math.floor(height * dpr);
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;

      updateTypographyMask(width, height);
      ensureLoopRunning();
    }

    const resizeObserver = new ResizeObserver(() => {
      resize();
    });
    resizeObserver.observe(container);
    resize();

    // Intersection Observer: start glance when entering viewport
    let initialIntersectionFired = false;
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting;
      if (entry.isIntersecting) {
        ensureLoopRunning();
        if (!initialIntersectionFired) {
          initialIntersectionFired = true;
          if (!hasSeenGlance) {
            hasSeenGlance = true;
            setTimeout(() => {
              triggerGlance();
            }, 80);
          }
        }
      }
    }, { threshold: 0.1 });
    intersectionObserver.observe(container);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('pointermove', handleGlobalPointerMove);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();

      if (gl) {
        gl.deleteProgram(prog);
        gl.deleteBuffer(quadBuf);
        gl.deleteTexture(trailTex);
        gl.deleteTexture(maskTex);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      id="iridescent-spec"
      className="absolute inset-0 w-full h-full pointer-events-none select-none overflow-hidden"
      style={{ willChange: 'transform', transform: 'translateZ(0)' }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ background: '#06070a', willChange: 'transform', transform: 'translateZ(0)' }}
      />
    </div>
  );
}
