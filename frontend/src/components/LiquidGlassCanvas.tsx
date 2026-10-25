import { useEffect, useRef } from 'react';

export function LiquidGlassCanvas({ paused = false }: { paused?: boolean }) {
  const pausedRef = useRef(paused);
  pausedRef.current = paused; // live value for the render loop

  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      depth: false,
      powerPreference: 'high-performance',
    });
    if (!gl) return;

    // Vertex Shader
    const vsSource = `
      attribute vec2 a_pos;
      void main() {
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;

    // Fragment Shader: Original Procedural Domain-Warped Obsidian Fluid with Chromatic Iridescence
    const fsSource = `
      precision highp float;
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
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        vec2 shift = vec2(100.0);
        mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
        for (int i = 0; i < 4; ++i) {
          v += a * noise(p);
          p = rot * p * 2.0 + shift;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution.xy;
        vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.x, u_resolution.y);

        // Smooth damped mouse parallax
        vec2 m = u_mouse * 0.25;
        p -= m;

        // Slow living fluid time: initialized at 51.0s so the smoke is directly behind the text from the start (as in Picture 2)
        float t = (u_time + 51.0) * 0.20;

        // Domain warping creating organic glossy liquid ribbon folds
        vec2 q = vec2(fbm(p + vec2(0.0, 0.0) + t * 0.15), fbm(p + vec2(5.2, 1.3) + t * 0.12));
        vec2 r = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + t * 0.25), fbm(p + 3.0 * q + vec2(8.3, 2.8) + t * 0.20));

        float f = fbm(p + 3.5 * r);

        // Central organic arched shape with deep volume
        float dist = length(p * vec2(1.15, 1.45) + vec2(0.0, 0.08)) - 0.55;
        float shape = smoothstep(0.40, -0.32, dist + f * 0.32);

        // Finite differences for surface normals and refraction
        vec2 eps = vec2(0.008, 0.0);
        float fX = fbm(p + eps.xy + 3.5 * r) - f;
        float fY = fbm(p + eps.yx + 3.5 * r) - f;
        vec3 normal = normalize(vec3(-fX * 36.0, -fY * 36.0, 1.0));

        // Specular reflections on fluid crests
        vec3 lightDir = normalize(vec3(0.5, 0.8, 1.0));
        vec3 viewDir = vec3(0.0, 0.0, 1.0);
        vec3 halfVec = normalize(lightDir + viewDir);
        float spec = pow(max(0.0, dot(normal, halfVec)), 24.0) * 1.3;

        // Iridescent chromatic edge sheen (subtle spectrum: cyan, violet, green, copper)
        float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 2.2);
        vec3 rainbow = 0.5 + 0.5 * cos(vec3(0.0, 2.0, 4.0) + normal.x * 4.2 + normal.y * 3.1 + t * 0.4);
        vec3 iridescence = rainbow * fresnel * 0.80;

        // Deep obsidian/charcoal liquid body
        vec3 body = vec3(0.015, 0.02, 0.035);

        // Soft dual radial + vertical fade: MATHEMATICALLY ZERO HARD EDGES
        float radialFade = smoothstep(0.95, 0.15, length(p / vec2(1.65, 0.95)));
        float verticalFade = smoothstep(0.0, 0.18, uv.y) * smoothstep(1.0, 0.82, uv.y);
        float mask = shape * radialFade * verticalFade;

        vec3 col = body + iridescence + vec3(spec * 0.9);

        gl_FragColor = vec4(col, mask * 0.88);
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
      const TIER = (window as unknown as { __BAYORA_TIER?: string }).__BAYORA_TIER || 'mid';
      const dpr = Math.min(window.devicePixelRatio || 1, TIER === 'low' ? 0.6 : TIER === 'mid' ? 0.85 : 1.25);
      const newW = Math.floor(parent.clientWidth * dpr);
      const newH = Math.floor(parent.clientHeight * dpr);
      if (newW !== width || newH !== height) {
        width = newW;
        height = newH;
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    };
    resize();
    window.addEventListener('resize', resize);

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

        let resumePending = false;
const render = (now: number) => {
      if (pausedRef.current) { resumePending = true; requestAnimationFrame(render); return; } // paused: keep the loop ALIVE, skip the work
      if (resumePending) { resumePending = false; requestAnimationFrame(render); return; } // staggered resume: skip 1 frame
      animId = requestAnimationFrame(render);
      if (!isVisible || document.hidden) return;

      const elapsed = (now - startTime) * 0.001;
      // Damped smooth mouse interpolation
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
      style={{ willChange: 'contents' }}
    />
  );
}
