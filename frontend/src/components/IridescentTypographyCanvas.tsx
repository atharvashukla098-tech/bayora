import { useEffect, useRef } from 'react';



interface IridescentTypographyCanvasProps {

  onPointerMove?: (e: React.PointerEvent) => void;

}



export function IridescentTypographyCanvas({ onPointerMove: _externalPointerMove }: IridescentTypographyCanvasProps) {

  const containerRef = useRef<HTMLDivElement>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);



  useEffect(() => {

    const canvas = canvasRef.current;

    const container = containerRef.current;

    if (!canvas || !container) return;



    const gl = canvas.getContext('webgl', {

      alpha: false,

      antialias: true,

      depth: false,

      stencil: false,

      powerPreference: 'high-performance',

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



    // Lusion-Style Chromatic Typography Shader:

    // Strictly masks refraction to the letter geometry (ZERO background bulb glow)

    // Low velocity -> delicate, light prismatic spark (Photo 1)

    // High velocity -> sweeping liquid chrome reflections across letters (Photo 2)

    const fsSource = `

      precision highp float;

      varying vec2 v_uv;

      uniform sampler2D u_trailTex;

      uniform sampler2D u_maskTex;

      uniform vec2 u_resolution;

      uniform float u_time;

      uniform vec2 u_mouse;



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



      float fbm(vec2 p) {

        float v = 0.0;

        float a = 0.5;

        mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));

        for (int i = 0; i < 3; ++i) {

          v += a * noise(p);

          p = rot * p * 2.1 + vec2(10.0);

          a *= 0.5;

        }

        return v;

      }



      void main() {

        vec2 uv = v_uv;

        vec2 texel = 1.0 / u_resolution;



        // Base typography mask:

        // r = letter fill, g = architectural outline, b = bevel contour

        vec4 maskBase = texture2D(u_maskTex, uv);

        // Pitch dark obsidian canvas base (#06070a)
        vec3 bg = vec3(0.024, 0.027, 0.038);

        // Inactive resting typography: very less visible normally (barely perceptible ghost outline)
        vec3 idleOutline = vec3(0.038, 0.044, 0.058); // Extremely subtle ghost stroke (~1-2% above background)
        vec3 idleFill = bg;
        vec3 idleBevel = vec3(0.030, 0.035, 0.046);

        // Resting canvas state: text is very faint normally so foreground is unobstructed
        vec3 restingColor = bg;
        restingColor = mix(restingColor, idleFill, maskBase.r * 0.05);
        restingColor = mix(restingColor, idleOutline, maskBase.g * 0.28);
        restingColor = mix(restingColor, idleBevel, maskBase.b * 0.08);

        // Sample Trail Intensity
        float t = texture2D(u_trailTex, uv).r;

        // STRICT TEXT CONTAINMENT: If this pixel is not on text, return pure resting background!
        // This completely eliminates any lingering glow in the empty background.
        float textCoverage = clamp(maskBase.r + maskBase.g * 1.5, 0.0, 1.0);
        if (t < 0.003 || textCoverage < 0.003) {
          gl_FragColor = vec4(restingColor, 1.0);
          return;
        }

        // Local gradient of fluid trail for 3D liquid surface normal
        float tR = texture2D(u_trailTex, uv + vec2(texel.x * 3.5, 0.0)).r;
        float tL = texture2D(u_trailTex, uv - vec2(texel.x * 3.5, 0.0)).r;
        float tU = texture2D(u_trailTex, uv + vec2(0.0, texel.y * 3.5)).r;
        float tD = texture2D(u_trailTex, uv - vec2(0.0, texel.y * 3.5)).r;
        vec2 trailGrad = vec2(tR - tL, tU - tD);

        // Subtle living fluid turbulence
        float turb = fbm(uv * 7.5 + u_time * 0.2) * 0.12;
        vec2 fluidNormal = trailGrad * 24.0 + vec2(turb, -turb) * (0.12 + t * 0.88);

        // True chromatic dispersion (split R, G, B refractive indices like real glass)
        float disp = 0.015 * clamp(t * 1.3, 0.0, 1.0);
        float maskRefractR = texture2D(u_maskTex, uv - fluidNormal * (disp * 1.25)).r;
        float maskRefractG = texture2D(u_maskTex, uv - fluidNormal * disp).r;
        float maskRefractB = texture2D(u_maskTex, uv - fluidNormal * (disp * 0.75)).r;

        // 3D Liquid Surface Normal & Specular Highlights
        vec3 N = normalize(vec3(-fluidNormal.x, -fluidNormal.y, 1.0));
        vec3 lightDir = normalize(vec3(0.4, 0.75, 0.9));
        vec3 viewDir = vec3(0.0, 0.0, 1.0);
        vec3 H = normalize(lightDir + viewDir);

        float NdotH = max(0.0, dot(N, H));
        float spec = pow(NdotH, 26.0) * 3.2 * t;
        float fresnel = pow(1.0 - max(0.0, dot(N, viewDir)), 2.4);

        // Lusion authentic thin-film chromatic spectrum:
        // Electric Cyan -> Deep Cobalt -> Prismatic Violet -> Sunset Cadmium Ruby -> Molten Gold
        float phase = dot(N.xy, vec2(3.2, 4.0)) + u_time * 0.35 + t * 2.2;
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
        float reveal = smoothstep(0.015, 0.40, t);

        // Cursor Reveal Dynamics: As cursor drags on text, reveal the architectural text structure
        float cursorReveal = clamp(t * 2.4, 0.0, 1.0);
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



    // Quad buffer

    const quadBuf = gl.createBuffer();

    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);

    gl.bufferData(

      gl.ARRAY_BUFFER,

      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),

      gl.STATIC_DRAW

    );



    // Trail Canvas & Texture (512 x 256 for silky 60FPS fluid simulation)

    const trailCanvas = document.createElement('canvas');

    trailCanvas.width = 512;

    trailCanvas.height = 256;

    const trailCtx = trailCanvas.getContext('2d');

    if (trailCtx) {

      trailCtx.fillStyle = '#000000';

      trailCtx.fillRect(0, 0, 512, 256);

    }



    const trailTex = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, trailTex);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);



    // Typography Mask Canvas & Texture

    const maskCanvas = document.createElement('canvas');

    const maskCtx = maskCanvas.getContext('2d');

    const maskTex = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, maskTex);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);



    function updateTypographyMask(width: number, height: number) {

      if (!maskCtx) return;

      const TIER = (window as unknown as { __BAYORA_TIER?: string }).__BAYORA_TIER || 'mid';
      const dpr = Math.min(window.devicePixelRatio || 1, TIER === 'low' ? 0.75 : TIER === 'mid' ? 1 : 1.5);

      maskCanvas.width = Math.floor(width * dpr);

      maskCanvas.height = Math.floor(height * dpr);



      const mw = maskCanvas.width;

      const mh = maskCanvas.height;



      // Clear with pitch black

      maskCtx.fillStyle = '#000000';

      maskCtx.fillRect(0, 0, mw, mh);



      // All 4 Giant Typography Lines: Big, edge-to-edge typography with cohesive leading
      const lines = [
        'VERIFY EVERY PROMPT.',
        'CONTAIN AT THE ROOT.',
        'ENFORCE ZERO TRUST.',
        'PROVE ZERO TAMPER.',
      ];

      // Measure baseline width to calculate the large font size that stretches across the page width
      maskCtx.font = `900 100px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif`;
      const targetWidth = mw * 0.94; // Spans 94% of the section width
      const startX = Math.max(mw * 0.03, 16 * dpr);

      const maxMeasuredWidth = Math.max(...lines.map(line => maskCtx.measureText(line).width));
      const fittedFontSize = Math.floor((targetWidth / maxMeasuredWidth) * 100);

      // Big font size: preserves monumental presence across all 4 lines
      const targetFontSize = Math.min(fittedFontSize, Math.floor(mh / 4.8));
      maskCtx.font = `900 ${targetFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif`;
      maskCtx.textAlign = 'left';
      maskCtx.textBaseline = 'top';

      const y0 = Math.max(Math.floor(mh * 0.02), 16 * dpr);
      const line0Bottom = y0 + targetFontSize;

      // Tightened space between Line 0 and Line 1 (retaining safe 30px+ clearance so it never crashes into the upper dock)
      const gap01 = Math.max(Math.floor(mh * 0.20), 180 * dpr);
      const y1 = line0Bottom + gap01;
      const line1Bottom = y1 + targetFontSize;

      // Reduced cohesive space between Line 1, Line 2, and Line 3
      const gapBetween = Math.max(Math.floor(mh * 0.045), 38 * dpr);
      const y2 = line1Bottom + gapBetween;
      const line2Bottom = y2 + targetFontSize;

      const y3 = line2Bottom + gapBetween;

      const linePositions = [y0, y1, y2, y3];

      // Export slot coordinates to parent section via CSS custom properties for 100% responsive alignment
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

      // 3. Channel Green: Architectural Outlines (crisp hairline stroke with enhanced legibility)
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



    if (document.fonts && document.fonts.ready) {

      document.fonts.ready.then(() => {

        if (container) {

          updateTypographyMask(container.clientWidth, container.clientHeight);

        }

      });

    }



    // Pointer dynamics & continuous stroke tracking

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

      const y = Math.max(0, Math.min(1, 1.0 - (e.clientY - rect.top) / rect.height)); // WebGL Y inverted



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

    };



    window.addEventListener('pointermove', handleGlobalPointerMove, { passive: true });



    // Resize handling

    let animationFrameId: number;

    let isVisible = true;



    function resize() {

      const width = container!.clientWidth;

      const height = container!.clientHeight;

      if (width === 0 || height === 0) return;



      const TIER = (window as unknown as { __BAYORA_TIER?: string }).__BAYORA_TIER || 'mid';
      const dpr = Math.min(window.devicePixelRatio || 1, TIER === 'low' ? 0.75 : TIER === 'mid' ? 1 : 1.5);

      canvas!.width = Math.floor(width * dpr);

      canvas!.height = Math.floor(height * dpr);

      canvas!.style.width = `${width}px`;

      canvas!.style.height = `${height}px`;



      updateTypographyMask(width, height);

    }



    const resizeObserver = new ResizeObserver(() => {

      resize();

    });

    resizeObserver.observe(container);

    resize();



    // Intersection Observer to avoid GPU rendering when off-screen

    const intersectionObserver = new IntersectionObserver(([entry]) => {

      isVisible = entry.isIntersecting;

    });

    intersectionObserver.observe(container);



    // Main Render Loop

    let lastTime = performance.now();

    const posLoc = gl.getAttribLocation(prog, 'a_pos');



    function render(now: number) {
      animationFrameId = requestAnimationFrame(render);
      if (!isVisible || document.hidden) return;



      const dt = Math.min((now - lastTime) / 1000, 0.1);

      lastTime = now;



      // 1. UPDATE DYNAMIC TRAIL BUFFER ON TRAILCANVAS

      if (trailCtx) {

        // Fast, smooth decay (~0.6s-0.8s): energetic sweeps stay temporarily, then quickly settle

        trailCtx.fillStyle = 'rgba(0, 0, 0, 0.085)';

        trailCtx.fillRect(0, 0, 512, 256);



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



          const vx = (posX - pointer.prevX) * 512;

          const vy = (posY - pointer.prevY) * 256;

          const speed = Math.hypot(vx, vy); // Movement velocity in canvas pixels



          const cw = 512;

          const ch = 256;

          const ptX = posX * cw;

          const ptY = (1.0 - posY) * ch;

          const prevPtX = pointer.prevX * cw;

          const prevPtY = (1.0 - pointer.prevY) * ch;



          // Normalized velocity factor (0 = stationary/slow, 1 = fast sweep)

          const speedFactor = Math.min(speed / 16.0, 1.0);



          // VELOCITY-DRIVEN RADIUS & INTENSITY (LUSION BEHAVIOR):

          // Slow movement (Photo 1): tiny, delicate spark (radius ~10-12px, subtle alpha)

          // Fast movement (Photo 2): sweeping iridescent fluid (radius ~36-42px max, full vivid opacity)

          const radius = 10 + speedFactor * 32; // strictly capped at 42px (never an out-of-control bulb!)

          const stampAlpha = 0.30 + speedFactor * 0.67; // 0.30 to 0.97



          // Draw localized radial stamp at cursor position

          const grad = trailCtx.createRadialGradient(ptX, ptY, 1, ptX, ptY, radius);

          grad.addColorStop(0, `rgba(255, 255, 255, ${stampAlpha})`);

          grad.addColorStop(0.40, `rgba(255, 255, 255, ${stampAlpha * 0.6})`);

          grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');



          trailCtx.fillStyle = grad;

          trailCtx.beginPath();

          trailCtx.arc(ptX, ptY, radius, 0, Math.PI * 2);

          trailCtx.fill();



          // Stroke connecting line segment between frames for smooth continuous fluid path

          if (speed > 0.35) {

            trailCtx.beginPath();

            trailCtx.moveTo(prevPtX, prevPtY);

            trailCtx.lineTo(ptX, ptY);

            trailCtx.strokeStyle = `rgba(255, 255, 255, ${stampAlpha * 0.75})`;

            trailCtx.lineWidth = radius * 0.85;

            trailCtx.lineCap = 'round';

            trailCtx.stroke();

          }

        } else {

          // IDLE / AWAY: Zero phantom drawing! The canvas decays cleanly to pure dark state.

        }



        // Upload updated trailCanvas to WebGL texture unit 0

        gl!.bindTexture(gl!.TEXTURE_2D, trailTex);

        gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, 1);

        gl!.texImage2D(

          gl!.TEXTURE_2D,

          0,

          gl!.RGBA,

          gl!.RGBA,

          gl!.UNSIGNED_BYTE,

          trailCanvas

        );

      }



      // 2. RENDER COMPOSITE SHADER TO CANVAS

      gl!.viewport(0, 0, canvas!.width, canvas!.height);

      gl!.useProgram(prog);



      gl!.activeTexture(gl!.TEXTURE0);

      gl!.bindTexture(gl!.TEXTURE_2D, trailTex);

      gl!.uniform1i(gl!.getUniformLocation(prog, 'u_trailTex'), 0);



      gl!.activeTexture(gl!.TEXTURE1);

      gl!.bindTexture(gl!.TEXTURE_2D, maskTex);

      gl!.uniform1i(gl!.getUniformLocation(prog, 'u_maskTex'), 1);



      gl!.uniform2f(gl!.getUniformLocation(prog, 'u_resolution'), canvas!.width, canvas!.height);

      gl!.uniform1f(gl!.getUniformLocation(prog, 'u_time'), now * 0.001);

      gl!.uniform2f(gl!.getUniformLocation(prog, 'u_mouse'), pointer.currentX, pointer.currentY);



      gl!.bindBuffer(gl!.ARRAY_BUFFER, quadBuf);

      gl!.enableVertexAttribArray(posLoc);

      gl!.vertexAttribPointer(posLoc, 2, gl!.FLOAT, false, 0, 0);

      gl!.drawArrays(gl!.TRIANGLES, 0, 6);

    }



    animationFrameId = requestAnimationFrame(render);



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

    >

      <canvas

        ref={canvasRef}

        className="w-full h-full block"

        style={{ background: '#06070a' }}

      />

    </div>

  );

}

