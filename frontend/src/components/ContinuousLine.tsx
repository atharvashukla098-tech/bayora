import { useEffect, useRef } from 'react';

interface PointSample {
  len: number;
  y: number;
}

export function ContinuousLine({ paused = false }: { paused?: boolean }) {
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const pathRef = useRef<SVGPathElement>(null);
  const totalLengthRef = useRef<number>(0);
  const samplesRef = useRef<PointSample[]>([]);

  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;

    // Measure total path length accurately
    const totalLength = path.getTotalLength();
    totalLengthRef.current = totalLength;

    // Pre-sample points along path to establish an exact monotonic mapping from SVG-Y to Path Length
    const samples: PointSample[] = [];
    const numSamples = 300;
    for (let i = 0; i <= numSamples; i++) {
      const len = (i / numSamples) * totalLength;
      const pt = path.getPointAtLength(len);
      samples.push({ len, y: pt.y });
    }
    samplesRef.current = samples;

    path.style.strokeDasharray = `${totalLength}`;

    // Binary search lookup: given a target SVG Y coordinate, finds the exact length along path
    const getLengthForSvgY = (targetSvgY: number): number => {
      const s = samplesRef.current;
      if (s.length === 0) return 0;
      if (targetSvgY <= s[0].y) return s[0].len;
      if (targetSvgY >= s[s.length - 1].y) return totalLength;

      let low = 0;
      let high = s.length - 1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (s[mid].y < targetSvgY) {
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      const i0 = Math.max(0, high);
      const i1 = Math.min(s.length - 1, low);
      const p0 = s[i0];
      const p1 = s[i1];
      if (p0.y === p1.y || i0 === i1) return p0.len;
      const t = (targetSvgY - p0.y) / (p1.y - p0.y);
      return p0.len + t * (p1.len - p0.len);
    };

    let introProgress = 0;
    let hasCompletedIntro = false;

    // Calculates the target drawn length such that the line tip tracks right around the middle of the laptop screen
    const calculateTargetLength = () => {
      const pageHeight = document.documentElement.scrollHeight;
      const viewportH = window.innerHeight;
      const scrollY = window.scrollY;

      // Target position in page pixels: exactly at 52% of the user's laptop screen height
      // As the user scrolls, targetPageY travels down with their screen
      let targetPageY = scrollY + viewportH * 0.52;

      // When near the very bottom of the page, smoothly draw all the way to 100%
      const maxScroll = pageHeight - viewportH;
      if (maxScroll > 0 && scrollY >= maxScroll - 60) {
        const bottomFactor = Math.min(Math.max((scrollY - (maxScroll - 60)) / 60, 0), 1);
        targetPageY = (scrollY + viewportH * 0.52) * (1 - bottomFactor) + pageHeight * bottomFactor;
      }

      // Convert page pixels to SVG viewBox Y (viewBox height is 6400)
      const targetSvgY = (targetPageY / Math.max(pageHeight, 1)) * 6400;
      return getLengthForSvgY(targetSvgY);
    };

    const updateLine = () => {
      if (!path || totalLengthRef.current === 0) return;

      const targetLen = calculateTargetLength();
      const currentDrawnLength = hasCompletedIntro
        ? targetLen
        : Math.max(targetLen * introProgress, targetLen);

      const offset = Math.max(0, totalLengthRef.current - currentDrawnLength);
      path.style.strokeDashoffset = `${offset}`;
    };

    // Initial Entrance Animation: Draws smoothly to the middle of the opening laptop screen over 850ms
    const startTime = performance.now();
    const duration = 850;
    let animId: number;

    const animateIn = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      // easeOutCubic
      introProgress = 1 - Math.pow(1 - t, 3);
      updateLine();

      if (t < 1) {
        animId = requestAnimationFrame(animateIn);
      } else {
        hasCompletedIntro = true;
        updateLine();
      }
    };
    animId = requestAnimationFrame(animateIn);

    // Throttled RAF scroll handler for locked 60/120FPS tracking with zero latency
    let ticking = false;
    const handleScroll = () => {
      if (pausedRef.current) return;
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          updateLine();
          ticking = false;
        });
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', updateLine);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', updateLine);
    };
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden w-full h-full select-none">
      <svg
        className="w-full h-full"
        viewBox="0 0 1440 6400"
        fill="none"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ transform: 'translateZ(0)', willChange: 'contents' }}
      >
        <defs>
          {/* Bold, vibrant Electric Royal Blue into Luminous Cyan Gradient */}
          <linearGradient id="bayoraBoldGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            {/* Hero Section - Deep Electric Royal Blue */}
            <stop offset="0%" stopColor="#1e3a8a" stopOpacity="1" />
            <stop offset="8%" stopColor="#2563eb" stopOpacity="1" />
            <stop offset="20%" stopColor="#3b82f6" stopOpacity="1" />
            {/* Transition into vivid Cyan / Electric Turquoise */}
            <stop offset="35%" stopColor="#0284c7" stopOpacity="1" />
            <stop offset="48%" stopColor="#00d2d3" stopOpacity="1" />
            <stop offset="68%" stopColor="#00e5ff" stopOpacity="1" />
            {/* Cosmic descent */}
            <stop offset="85%" stopColor="#38bdf8" stopOpacity="1" />
            <stop offset="100%" stopColor="#60a5fa" stopOpacity="1" />
          </linearGradient>

          {/* Subtle luminous glow filter */}
          <filter id="boldLineGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* 
            Refined Technical Bézier Path (strokeWidth 3.5px)
            Accurately tracks user scroll to stay around the middle of the laptop screen.
            Routes elegantly down the right column and behind cards, NEVER colliding with hero text or buttons.
        */}
        <path
          ref={pathRef}
          d="
            M 820 80
            C 980 90, 1160 120, 1260 200
            C 1340 280, 1350 400, 1290 520
            C 1230 640, 1100 700, 960 760
            C 820 820, 740 920, 780 1040
            C 820 1160, 980 1220, 1180 1280
            C 1340 1340, 1390 1480, 1340 1620
            C 1280 1760, 1120 1820, 940 1870
            C 760 1920, 620 2020, 580 2160
            C 540 2300, 640 2440, 860 2520
            C 1080 2600, 1280 2680, 1320 2860
            C 1360 3040, 1220 3240, 1020 3420
            C 820 3600, 680 3780, 640 3980
            C 600 4180, 720 4360, 960 4540
            C 1180 4720, 1320 4940, 1260 5220
            C 1200 5500, 980 5780, 820 6300
          "
          stroke="url(#bayoraBoldGradient)"
          strokeWidth="28"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#boldLineGlow)"
          style={{
            willChange: 'stroke-dashoffset',
            transition: 'none',
          }}
        />

        {/* Technical Anchor Nodes (AegisAI Style) */}
        <circle cx="820" cy="80" r="16" fill="#1e3a8a" stroke="#ffffff" strokeWidth="4.5" />
        <circle cx="1260" cy="200" r="15" fill="#2563eb" stroke="#ffffff" strokeWidth="4" />
        <circle cx="960" cy="760" r="15" fill="#0284c7" stroke="#ffffff" strokeWidth="4" />
        <circle cx="1180" cy="1280" r="15" fill="#00e5ff" stroke="#ffffff" strokeWidth="4" />
      </svg>
    </div>
  );
}
