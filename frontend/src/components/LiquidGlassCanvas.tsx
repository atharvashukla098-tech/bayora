import { useEffect, useRef } from 'react';

export function LiquidGlassCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false, // Smoke is volumetric; disabling MSAA saves substantial fill-rate
      depth: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) return;

    // Vertex Shader
    const vsSource = `
      attribute vec2 a_pos;
      void main() {
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;

    // Ultra-Optimized Fragment Shader:
    // 1. Anchors the luminous smoke folds directly behind the marquee text lines from frame 0.
    // 2. Pre-warmed mature time offset (t_0 = 50.0) so there is ZERO delay or slow drift waiting for smoke to appear.
    // 3. Compile-time rotation matrices and reduced octaves for silky 60-120 FPS performance.
    const fsSource = `
      precision mediump float;
      uniform float u_time;
      uniform vec2 u_resolution;
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

      // Compile-time rotation matrix to eliminate trigonometric ops in loops
      const mat2 ROT = mat2(0.87758, 0.47942, -0.47942, 0.87758);

      float fbm2(vec2 p) {
        float v = 0.60 * noise(p);
        p = ROT * p * 2.04 + vec2(5.2, 1.3);
        v += 0.40 * noise(p);
        return v;
      }

      float fbm3(vec2 p) {
        float v = 0.50 * noise(p);
        p = ROT * p * 2.02 + vec2(1.7, 9.2);
        v += 0.32 * noise(p);
        p = ROT * p * 2.04 + vec2(8.3, 2.8);
        v += 0.18 * noise(p);
        return v;
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution.xy;
        vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.x, u_resolution.y);

        // Subtle mouse parallax
        vec2 m = u_mouse * 0.20;
        p -= m;

        // Instant mature smoke phase: Starts immediately at t_0 = 50.0 (mature billowing state from Picture 2)
        // Gentle living fluid speed (0.12)
        float t = (u_time + 50.0) * 0.12;

        // Domain warping creating organic glossy liquid smoke ribbons
        vec2 q = vec2(fbm2(p + vec2(0.0, 0.0) + t * 0.15), fbm2(p + vec2(5.2, 1.3) + t * 0.12));
        vec2 r = vec2(fbm2(p + 2.8 * q + vec2(1.7, 9.2) + t * 0.22), fbm2(p + 2.8 * q + vec2(8.3, 2.8) + t * 0.18));

        float f = fbm3(p + 3.2 * r);

        // Targeted vertical and horizontal anchor:
        // Centers the main smoke plume volume directly behind the 3 marquee text rows (p.y ~ -0.15 to -0.35)
        // and arches up into the central particle head
        vec2 textAnchorP = p * vec2(0.88, 1.18) + vec2(0.0, 0.16);
        float dist = length(textAnchorP) - 0.65;
        float shape = smoothstep(0.48, -0.28, dist + f * 0.38);

        // Fast surface normal from warped coordinate derivatives (zero extra fbm passes!)
        vec2 normalGrad = (r - q * 0.5) * 1.8 + vec2(f * 0.8, -f * 0.8);
        vec3 normal = normalize(vec3(-normalGrad.x * 2.2, -normalGrad.y * 2.2, 1.0));

        // Specular reflections on smoke folds
        vec3 lightDir = vec3(0.408, 0.653, 0.638); // normalize(vec3(0.5, 0.8, 1.0))
        vec3 viewDir = vec3(0.0, 0.0, 1.0);
        vec3 halfVec = vec3(0.247, 0.395, 0.885); // normalize(lightDir + viewDir)
        float spec = pow(max(0.0, dot(normal, halfVec)), 22.0) * 1.6;

        // Iridescent chromatic edge sheen (cyan, violet, molten highlight)
        float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 2.2);
        vec3 rainbow = 0.5 + 0.5 * cos(vec3(0.0, 2.0, 4.0) + normal.x * 4.2 + normal.y * 3.1 + t * 0.4);
        vec3 iridescence = rainbow * fresnel * 0.85;

        // Luminous liquid smoke body with high-contrast crests directly illuminating text
        vec3 smokeGlow = vec3(0.92, 0.95, 1.0) * pow(f, 2.0) * 0.65;
        vec3 body = vec3(0.015, 0.02, 0.035) + smokeGlow;

        // Soft wide horizontal fade to encompass the full marquee runway edge-to-edge
        float radialFade = smoothstep(1.20, 0.20, length(p / vec2(2.1, 1.15)));
        float verticalFade = smoothstep(0.0, 0.12, uv.y) * smoothstep(1.0, 0.85, uv.y);
        float mask = clamp(shape * radialFade * verticalFade, 0.0, 1.0);

        vec3 col = body + iridescence + vec3(spec * 1.1);

        gl_FragColor = vec4(col, mask * 0.92);
      }
    `;

    function createShader(glCtx: WebGLRenderingContext, type: number, source: string) {
      const shader = glCtx.createShader(type);
      if (!shader) return null;
      glCtx.shaderSource(shader, source);
      glCtx.compileShader(shader);
      if (!glCtx.getShaderParameter(shader, glCtx.COMPILE_STATUS)) {
        console.error('Shader compile error:', glCtx.getShaderInfoLog(shader));
        glCtx.deleteShader(shader);
        return null;
      }
      return shader;
    }

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vertexShader || !fragmentShader) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);

    // Quad geometry: two triangles covering -1 to 1
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
        -1,  1,
         1, -1,
         1,  1,
      ]),
      gl.STATIC_DRAW
    );

    const aPosLoc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(aPosLoc);
    gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);

    // Pre-cache uniforms
    const uTimeLoc = gl.getUniformLocation(program, 'u_time');
    const uResLoc = gl.getUniformLocation(program, 'u_resolution');
    const uMouseLoc = gl.getUniformLocation(program, 'u_mouse');

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    let width = 0;
    let height = 0;
    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.0);
      const newW = Math.max(1, Math.floor(parent.clientWidth * dpr));
      const newH = Math.max(1, Math.floor(parent.clientHeight * dpr));
      if (newW !== width || newH !== height) {
        width = newW;
        height = newH;
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    };
    resize();
    window.addEventListener('resize', resize, { passive: true });

    let mouseX = 0;
    let mouseY = 0;
    let targetMouseX = 0;
    let targetMouseY = 0;

    const handlePointerMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      targetMouseX = x;
      targetMouseY = y;
    };
    window.addEventListener('pointermove', handlePointerMove, { passive: true });

    let isVisible = true;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          isVisible = entry.isIntersecting;
        });
      },
      { threshold: 0.05 }
    );
    observer.observe(canvas);

    let animId = 0;
    const startTime = performance.now();

    const render = (now: number) => {
      animId = requestAnimationFrame(render);
      if (!isVisible || document.hidden) return;

      const elapsed = (now - startTime) * 0.001;
      mouseX += (targetMouseX - mouseX) * 0.05;
      mouseY += (targetMouseY - mouseY) * 0.05;

      gl.useProgram(program);
      gl.uniform1f(uTimeLoc, elapsed);
      gl.uniform2f(uResLoc, width, height);
      gl.uniform2f(uMouseLoc, mouseX, mouseY);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', handlePointerMove);
      observer.disconnect();
      if (gl) {
        gl.deleteProgram(program);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        gl.deleteBuffer(positionBuffer);
      }
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none z-0"
      style={{ willChange: 'transform', transform: 'translateZ(0)' }}
    />
  );
}
