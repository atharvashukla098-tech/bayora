// BAYORA — 3D scenario cards for the Quick Sandbox.
// CSS-3D only (no WebGL): mouse-tracked perspective tilt, depth-layered
// content planes, and a true 3D flip that reveals the outcome face.
// Potato-safe: transforms are GPU-composited; disabled on reduce-motion.

import React, { useRef, useCallback, useState } from 'react';

export type CardOutcome = 'QUARANTINED' | 'BLOCKED' | 'REDACTED' | 'DENIED' | 'REJECTED' | 'ALLOWED';

interface TiltCard3DProps {
  id: string;
  name: string;
  pillar: string;
  prompt: string;
  outcome: string;
  httpCode: number;
  rule: string;
  selected: boolean;
  onSelect: () => void;
}

const OUTCOME_COLOR: Record<string, string> = {
  QUARANTINED: 'text-amber-300 border-amber-400/40 bg-amber-400/10',
  BLOCKED: 'text-red-400 border-red-400/40 bg-red-400/10',
  DENIED: 'text-red-400 border-red-400/40 bg-red-400/10',
  REJECTED: 'text-red-400 border-red-400/40 bg-red-400/10',
  REDACTED: 'text-cyan-300 border-cyan-400/40 bg-cyan-400/10',
  ALLOWED: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10',
};

export function TiltCard3D({
  id, name, pillar, prompt, outcome, httpCode, rule, selected, onSelect,
}: TiltCard3DProps) {
  const cardRef = useRef<HTMLButtonElement>(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0, gx: 50, gy: 50 });
  const [flipped, setFlipped] = useState(false);
  const rafRef = useRef(0);

  const onMove = useCallback((e: React.MouseEvent) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;   // 0..1
    const py = (e.clientY - rect.top) / rect.height;   // 0..1
    // queue at most one state update per frame
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setTilt({
        rx: (0.5 - py) * 18,           // ±9deg — clearly visible
        ry: (px - 0.5) * 22,           // ±11deg
        gx: px * 100,
        gy: py * 100,
      });
    });
  }, []);

  const onLeave = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setTilt({ rx: 0, ry: 0, gx: 50, gy: 50 });
    setFlipped(false);
  }, []);

  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const t = reduceMotion ? { rx: 0, ry: 0, gx: 50, gy: 50 } : tilt;

  return (
    <button
      ref={cardRef}
      type="button"
      onClick={onSelect}
      onMouseMove={onMove}
      onMouseEnter={() => setFlipped(true)}
      onMouseLeave={onLeave}
      className="group relative text-left rounded-xl border transition-[border-color,box-shadow] duration-200 cursor-pointer"
      style={{ perspective: '900px', borderColor: selected ? 'rgba(34,211,238,0.7)' : 'rgba(255,255,255,0.1)' }}
      aria-pressed={selected}
    >
      {/* sheen follows the cursor */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{
          background: `radial-gradient(220px circle at ${t.gx}% ${t.gy}%, rgba(34,211,238,0.08), transparent 60%)`,
        }}
      />

      {/* the 3D inner: tilts with the mouse, lifts on hover,
          and flips 180° to reveal the verdict.
          NOTE: no `filter` here — filters flatten preserve-3d in Chromium. */}
      <span
        className="block relative rounded-xl transition-transform duration-500 ease-out will-change-transform"
        style={{
          transformStyle: 'preserve-3d',
          transform: `rotateX(${t.rx}deg) rotateY(${t.ry + (flipped ? 180 : 0)}deg) translateZ(${flipped ? 26 : 0}px)`,
        }}
      >
        {/* FRONT FACE: scenario info */}
        <span
          className="block p-3.5 rounded-xl"
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            background: selected ? 'rgba(8, 51, 68, 0.35)' : 'rgba(255,255,255,0.04)',
          }}
        >
          <span className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-cyan-400 font-bold tracking-wide">{id}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold ${OUTCOME_COLOR[outcome.split(' ')[0]] || 'text-neutral-300 border-white/10 bg-white/5'}`}>
              {outcome.split(' ')[0]}
            </span>
          </span>
          <span className="block text-xs font-semibold text-white mb-1">{name}</span>
          <span className="block text-[9px] text-neutral-500 mb-1.5">{pillar}</span>
          <span
            className="block text-[10px] text-neutral-400 font-mono truncate"
            style={{ transform: 'translateZ(14px)' }}
          >
            {prompt}
          </span>
          <span className="block text-[8px] text-neutral-600 mt-2 tracking-widest uppercase">
            hover to inspect verdict
          </span>
        </span>

        {/* BACK FACE (mirrored): the verdict detail */}
        <span
          aria-hidden={!flipped}
          className="absolute inset-0 p-3.5 rounded-xl flex flex-col justify-between"
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            background: selected ? 'rgba(8, 51, 68, 0.35)' : 'rgba(255,255,255,0.04)',
          }}
        >
          <span className={`text-[13px] font-black tracking-tight ${OUTCOME_COLOR[outcome.split(' ')[0]]?.split(' ')[0] || 'text-white'}`}>
            {outcome.split(' ')[0]}.
          </span>
          <span className="block space-y-1">
            <span className="block text-[9px] text-neutral-500 uppercase tracking-wider">enforcement rule</span>
            <span className="block text-[10px] text-cyan-300 font-mono leading-snug">{rule}</span>
            <span className="block text-[9px] text-neutral-500 mt-1">HTTP {httpCode} / returned by the live broker</span>
          </span>
        </span>
      </span>
    </button>
  );
}
