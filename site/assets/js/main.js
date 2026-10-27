/* Bayora site — boot + scroll controller.
 *
 * Scroll position maps onto a continuous chapter index; the 3D rig
 * interpolates between chapter keyframes, and copy reveals as each
 * chapter enters the viewport.
 */

import { applyBundle, loadBundle, state } from "./data.js";

const sections = Array.from(document.querySelectorAll(".chapter"));

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext &&
      (c.getContext("webgl2") || c.getContext("webgl")));
  } catch (_) {
    return false;
  }
}

function chapterProgress() {
  /* the chapter whose middle is closest to the viewport centre, with a
   * fractional blend so the camera glides instead of jumping */
  const mid = window.innerHeight / 2;
  const centres = sections.map((s) => {
    const r = s.getBoundingClientRect();
    return r.top + r.height / 2;
  });
  let idx = 0;
  let best = Infinity;
  centres.forEach((c, i) => {
    const d = Math.abs(c - mid);
    if (d < best) { best = d; idx = i; }
  });

  /* blend with the next chapter as the current one leaves the frame */
  const frac = Math.max(0, Math.min(1,
    (mid - centres[idx]) / Math.max(1, window.innerHeight * 0.75) + 0.5));
  const forward = (centres[idx] - mid) > 0;
  const p = forward ? idx + frac : idx - (1 - frac);
  return Math.max(0, Math.min(sections.length - 1, p));
}

function revealActive() {
  sections.forEach((s) => {
    const r = s.getBoundingClientRect();
    const visible = r.top < window.innerHeight * 0.75 &&
      r.bottom > window.innerHeight * 0.25;
    s.classList.toggle("is-active", visible);
  });
  document.body.classList.toggle("deep", window.scrollY > window.innerHeight * 0.6);
}

async function boot() {
  document.documentElement.classList.add("js");

  const bundle = await loadBundle();
  if (bundle) {
    applyBundle(bundle);
  } else {
    console.warn("[bayora] no evidence bundle available");
  }

  revealActive();

  let scene = null;
  const canvas = document.getElementById("scene");
  if (canvas && webglAvailable()) {
    try {
      const mod = await import("./scene.js");
      scene = mod.createScene(canvas, bundle);
    } catch (err) {
      console.error("[bayora] 3D scene failed to start", err);
      document.body.classList.add("no-webgl");
    }
  } else {
    document.body.classList.add("no-webgl");
  }

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const p = chapterProgress();
      if (scene) scene.setProgress(p);
      revealActive();
      ticking = false;
    });
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });

  if (scene) scene.setProgress(chapterProgress());

  /* deep link / focus mode: ?ch=3 isolates one chapter (review, sharing,
   * single-beat demos) */
  const params = new URLSearchParams(location.search);
  const ch = parseInt(params.get("ch") || "", 10);
  if (!Number.isNaN(ch) && sections[ch]) {
    const target = sections[ch];
    document.body.classList.add("focus-chapter");
    sections.forEach((s, i) => {
      if (i !== ch) s.style.display = "none";
    });
    target.classList.add("is-active");
    if (scene) scene.setProgress(ch);
    requestAnimationFrame(() => revealActive());
  }

  /* a quiet console line for the operator: where the page read its data */
  console.info("[bayora] evidence source:", state.source || "none");
}

boot();
