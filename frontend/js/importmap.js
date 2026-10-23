// Vendor map for the offline-first 3D site. All libraries are local files
// in vendor/ — zero CDN calls at runtime (Manali has no internet).
export const importmap = {
  "imports": {
    "three": "./vendor/three.module.js",
    "three/addons/": "./vendor/addons/",
    "gsap": "./vendor/gsap.min.js",
    "gsap/ScrollTrigger": "./vendor/ScrollTrigger.min.js",
    "lenis": "./vendor/lenis.min.js"
  }
};
