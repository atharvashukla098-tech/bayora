

// Hardware tier detection (runs before any canvas boots; potato-proofing).
// FORCE_TIER=low|mid|high in localStorage overrides detection (demo/QA tool).
(() => {
  const forced = (localStorage.getItem('FORCE_TIER') || '').trim();
  if (forced === 'low' || forced === 'mid' || forced === 'high') {
    (window as unknown as { __BAYORA_TIER: string }).__BAYORA_TIER = forced;
    return;
  }
  const nav = navigator as Navigator & { deviceMemory?: number; hardwareConcurrency?: number };
  const cores = nav.hardwareConcurrency || 4;
  const dm = (nav as unknown as { deviceMemory?: number }).deviceMemory;
  let weak = false;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
      weak = /Intel|HD Graphics|UHD|GMA|Mali|Adreno|PowerVR|SwiftShader|Software|VMware|Basic Render|llvmpipe/i.test(name);
    } else {
      weak = true;
    }
  } catch { weak = true; }
  const lowEnd = weak || cores <= 4 || (dm !== undefined && dm <= 4);
  (window as unknown as { __BAYORA_TIER: string }).__BAYORA_TIER =
    lowEnd ? 'low' : (cores <= 8 ? 'mid' : 'high');
})();

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
