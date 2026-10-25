import React, { useEffect, useRef, useState, useMemo } from 'react';
import { sound } from '../utils/audio';

// ---------------------------------------------------------------------------
// 4 Architectural Service Pillars of Bayora (Exact Prompt Specification)
// ---------------------------------------------------------------------------
export interface ServiceCardData {
  id: string;
  category: string;
  iconType: 'attack' | 'broker' | 'guardrail' | 'ledger';
  isCream: boolean;
  items: string[];
}

const SERVICE_CARDS: ServiceCardData[] = [
  {
    id: 'red-harness',
    category: 'RED HARNESS',
    iconType: 'attack',
    isCream: true, // Card 1: Warm Cream
    items: [
      'Adversarial input generation',
      'Prompt-injection testing',
      'Boundary probing',
      'Scenario replay',
      'Attack orchestration',
    ],
  },
  {
    id: 'policy-broker',
    category: 'POLICY BROKER',
    iconType: 'broker',
    isCream: false, // Card 2: Muted Wine
    items: [
      'Schema validation',
      'Request policy enforcement',
      'Canary token scrubbing',
      'Input normalisation',
      'Policy event logging',
    ],
  },
  {
    id: 'blue-guardrail',
    category: 'BLUE GUARDRAIL',
    iconType: 'guardrail',
    isCream: true, // Card 3: Warm Cream
    items: [
      'Canary leakage detection',
      'Output boundary inspection',
      'Containment events',
      'Guardrail evaluation',
      'Violation reporting',
    ],
  },
  {
    id: 'audit-ledger',
    category: 'AUDIT LEDGER',
    iconType: 'ledger',
    isCream: false, // Card 4: Muted Wine
    items: [
      'Event hashing',
      'Hash-chain verification',
      'Tamper detection',
      'Audit evidence recording',
      'Integrity verification',
    ],
  },
];

// ---------------------------------------------------------------------------
// Custom Geometric SVGs for Card Fronts
// ---------------------------------------------------------------------------
function ServiceIcon({ type, className = 'w-5 h-5' }: { type: ServiceCardData['iconType']; className?: string }) {
  switch (type) {
    case 'attack':
      // Angular Ingress Chevron & Penetration Vector
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <polygon points="12 2 2 12 12 22 22 12" />
          <line x1="2" y1="12" x2="22" y2="12" strokeWidth="2.5" />
          <polyline points="15 5 22 12 15 19" strokeWidth="2.5" />
        </svg>
      );
    case 'broker':
      // Multi-layer Architectural Gate & Policy Filter
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <path d="M4 6h16M4 12h16M4 18h16" />
          <circle cx="8" cy="6" r="2.5" fill="currentColor" />
          <circle cx="16" cy="12" r="2.5" fill="currentColor" />
          <circle cx="10" cy="18" r="2.5" fill="currentColor" />
        </svg>
      );
    case 'guardrail':
      // Perimeter Boundary Shield & Checkpoint
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <polyline points="9 12 11 14 15 10" strokeWidth="2.5" />
        </svg>
      );
    case 'ledger':
      // Cryptographic Hash Blocks & Linked Integrity Ledger
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          <line x1="12" y1="8" x2="12" y2="15" strokeDasharray="2 2" strokeWidth="2" />
        </svg>
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Illustrated Card Back: Symmetrical Luxury Geometric Line-Art
// ---------------------------------------------------------------------------
function CardBackArtwork({ isCreamCard: _isCreamCard = false }: { isCreamCard?: boolean }) {
  const strokeColor = '#e8e6e1'; // Warm Cream linework
  const accentColor = '#b8b4ac'; // Dusty Rose accents

  return (
    <div className="relative w-full h-full rounded-[14px] overflow-hidden bg-gradient-to-br from-[#1E0613] via-[#16181d] to-[#3A0D23] border border-[#3a3f4a]/50 flex flex-col items-center justify-between p-5 select-none shadow-[0_12px_36px_rgba(0,0,0,0.55)]">
      {/* Top Header Label */}
      <div className="relative z-10 w-full flex items-center justify-between text-[9px] font-mono tracking-[0.25em] text-[#b8b4ac]/70 uppercase">
        <span>BAYORA</span>
        <span>ZERO-TRUST</span>
      </div>

      {/* Central Geometric Line-Art Composition */}
      <div className="relative z-10 w-full flex-1 flex items-center justify-center py-2">
        <svg viewBox="0 0 200 240" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full max-h-[220px]">
          {/* Outer notched diamond border */}
          <rect x="15" y="15" width="170" height="210" rx="8" stroke={strokeColor} strokeWidth="1.2" strokeOpacity="0.35" />
          <rect x="22" y="22" width="156" height="196" rx="4" stroke={accentColor} strokeWidth="0.8" strokeOpacity="0.45" strokeDasharray="4 4" />

          {/* Corner brackets */}
          <path d="M 28 40 L 28 28 L 40 28" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M 172 40 L 172 28 L 160 28" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M 28 200 L 28 212 L 40 212" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M 172 200 L 172 212 L 160 212" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" />

          {/* Symmetrical radiating diamond grid */}
          <polygon points="100 35, 165 120, 100 205, 35 120" stroke={strokeColor} strokeWidth="1.2" strokeOpacity="0.65" />
          <polygon points="100 50, 150 120, 100 190, 50 120" stroke={accentColor} strokeWidth="0.9" strokeOpacity="0.5" />
          <polygon points="100 68, 135 120, 100 172, 65 120" stroke={strokeColor} strokeWidth="0.8" strokeOpacity="0.4" strokeDasharray="2 3" />

          {/* Central circular cryptographic seal */}
          <circle cx="100" cy="120" r="32" stroke={strokeColor} strokeWidth="1.5" strokeOpacity="0.85" />
          <circle cx="100" cy="120" r="26" stroke={accentColor} strokeWidth="0.8" strokeOpacity="0.6" strokeDasharray="3 3" />
          <circle cx="100" cy="120" r="18" stroke={strokeColor} strokeWidth="1.2" strokeOpacity="0.5" />
          <circle cx="100" cy="120" r="5" fill={strokeColor} />

          {/* Symmetrical Cardinal Crosshairs */}
          <line x1="100" y1="28" x2="100" y2="88" stroke={strokeColor} strokeWidth="1.2" strokeOpacity="0.5" />
          <line x1="100" y1="152" x2="100" y2="212" stroke={strokeColor} strokeWidth="1.2" strokeOpacity="0.5" />
          <line x1="28" y1="120" x2="68" y2="120" stroke={strokeColor} strokeWidth="1.2" strokeOpacity="0.5" />
          <line x1="132" y1="120" x2="172" y2="120" stroke={strokeColor} strokeWidth="1.2" strokeOpacity="0.5" />

          {/* 4 Cardinal Diamond Nodes */}
          <polygon points="100 38, 103 41, 100 44, 97 41" fill={accentColor} />
          <polygon points="100 196, 103 199, 100 202, 97 199" fill={accentColor} />
          <polygon points="38 120, 41 123, 44 120, 41 117" fill={accentColor} />
          <polygon points="156 120, 159 123, 162 120, 159 117" fill={accentColor} />

          {/* Diagonal star bursts */}
          <line x1="60" y1="80" x2="74" y2="94" stroke={strokeColor} strokeWidth="1" strokeOpacity="0.4" />
          <line x1="140" y1="80" x2="126" y2="94" stroke={strokeColor} strokeWidth="1" strokeOpacity="0.4" />
          <line x1="60" y1="160" x2="74" y2="146" stroke={strokeColor} strokeWidth="1" strokeOpacity="0.4" />
          <line x1="140" y1="160" x2="126" y2="146" stroke={strokeColor} strokeWidth="1" strokeOpacity="0.4" />
        </svg>
      </div>

      {/* Bottom Footer Label & Cryptographic Hash */}
      <div className="relative z-10 w-full flex items-center justify-between text-[9px] font-mono tracking-[0.25em] text-[#b8b4ac]/70 uppercase">
        <span>SECURITY CORE</span>
        <span>ED25519</span>
      </div>


    </div>
  );
}

// ---------------------------------------------------------------------------
// Main 3D Card Animation & Scroll Scene
// ---------------------------------------------------------------------------
export function ServiceCardGallery() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [hasFlipped, setHasFlipped] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);

  // Check reduced motion preference
  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // IntersectionObserver to trigger the cascading 3D flip once when scrolled into view
  useEffect(() => {
    if (prefersReducedMotion) {
      setHasFlipped(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasFlipped) {
          setHasFlipped(true);
          // Play subtle cascading audio chimes in sequence with the cards
          setTimeout(() => sound.playHover(), 50);
          setTimeout(() => sound.playHover(), 200);
          setTimeout(() => sound.playHover(), 360);
          setTimeout(() => sound.playHover(), 520);
        }
      },
      { threshold: 0.22 }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, [hasFlipped, prefersReducedMotion]);

  // Track scroll position through the section for ribbon parallax, particle reveal & right-edge indicator
  useEffect(() => {
    const handleScroll = () => {
      if (!sectionRef.current) return;
      const rect = sectionRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;

      // Calculate progress from 0 (section enters bottom) to 1 (section leaves top)
      const totalDist = rect.height + windowHeight;
      const currentDist = windowHeight - rect.top;
      const progress = Math.max(0, Math.min(1, currentDist / totalDist));
      setScrollProgress(progress);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Trigger manual replay of the 3D flip sequence
  const handleReplay = (e: React.MouseEvent) => {
    e.stopPropagation();
    sound.playClick();
    setHasFlipped(false);
    setTimeout(() => {
      setHasFlipped(true);
      setTimeout(() => sound.playHover(), 50);
      setTimeout(() => sound.playHover(), 200);
      setTimeout(() => sound.playHover(), 360);
      setTimeout(() => sound.playHover(), 520);
    }, 120);
  };

  // Settled perspective angles for the 4 cards:
  // Card 0 (Leftmost): angles slightly rightward into the center (+6.5°)
  // Card 1 (Center-Left): nearly flat (+1.8°)
  // Card 2 (Center-Right): nearly flat (-1.8°)
  // Card 3 (Rightmost): angles slightly leftward into the center (-6.5°)
  const settledAngles = [6.5, 1.8, -1.8, -6.5];
  const initialBackAngles = [187, 182, 178, 173];

  return (
    <div
      ref={sectionRef}
      className="relative w-full overflow-hidden py-16 md:py-24 bg-[#16181d] select-none rounded-3xl border border-[#3a3f4a]/40"
    >
      {/* =========================================================================
          ANIMATION D & E: OVERSIZED CONTINUOUS BACKGROUND RIBBON (SVG Path Parallax)
          ========================================================================= */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        <svg
          viewBox="0 0 1600 900"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="absolute -top-12 left-1/2 -translate-x-1/2 w-[130%] min-w-[1300px] h-[115%] will-change-transform opacity-40 transition-transform duration-300 ease-out"
          style={{
            transform: `translate3d(-50%, ${scrollProgress * 45 - 20}px, 0)`,
          }}
          preserveAspectRatio="none"
        >
                  </svg>

        {/* Ambient Warm Wine glow beneath the cards */}
      </div>

      {/* =========================================================================
          ANIMATION F: GEOMETRIC PARTICLE CLUSTERS (Lower Atmosphere Reveal)
          ========================================================================= */}
      <div
        className="absolute inset-x-0 bottom-0 h-64 pointer-events-none z-0 transition-opacity duration-700 ease-out"
        style={{
          opacity: Math.max(0.15, Math.min(1, (scrollProgress - 0.25) * 2.2)),
        }}
      >
        {/* Cluster A: Lower-Left spatial cluster */}
        <div className="absolute bottom-10 left-[8%] flex flex-col gap-1.5 font-mono text-xs text-[#e8e6e1]/50">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#b8b4ac]/50" />
            <span className="text-[10px] text-[#b8b4ac]/50 tracking-widest">INGRESS_POINT</span>
          </div>
          <div className="text-[9px] text-[#b8b4ac]/40 tracking-wider">NODE // 01 / ACTIVE</div>
        </div>

        {/* Cluster B: Lower-Center spatial constellation along the ribbon dip */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 font-mono text-xs text-[#e8e6e1]/45">
          <span className="text-[10px] tracking-[0.25em] uppercase text-[#b8b4ac]/60">
            PIPELINE ATTESTATION MATRIX / ED25519 VERIFIED
          </span>
        </div>

        {/* Cluster C: Lower-Right edge spatial cluster */}
        <div className="absolute bottom-12 right-[8%] flex flex-col items-end gap-1.5 font-mono text-xs text-[#e8e6e1]/50">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#b8b4ac]/50 tracking-widest">AUDIT_BLOCK</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#b8b4ac]/50" />
          </div>
          <div className="text-[9px] text-[#b8b4ac]/40 tracking-wider">SHA256: 0x8F4D...2009</div>
        </div>
      </div>

      {/* =========================================================================
          ANIMATION G: SLIM RIGHT-EDGE SCROLL INDICATOR
          ========================================================================= */}
      <div className="absolute right-3.5 sm:right-6 top-28 bottom-28 w-1 flex flex-col items-center pointer-events-none z-20">
        {/* Track Line */}
        <div className="relative w-[2px] h-full bg-[#3a3f4a]/40 rounded-full overflow-hidden">
          {/* High-contrast moving cream indicator segment */}
          <div
            className="absolute top-0 left-0 w-full rounded-full bg-gradient-to-b from-[#e8e6e1] via-[#e8e6e1] to-[#b8b4ac] shadow-[0_0_8px_rgba(244,235,221,0.7)] transition-all duration-150 ease-out"
            style={{
              height: '36px',
              transform: `translateY(${scrollProgress * 260}px)`,
            }}
          />
        </div>
        {/* Micro tag indicating position */}
        <div className="absolute -left-9 top-1/2 -translate-y-1/2 -rotate-90 text-[8px] font-mono tracking-widest text-[#b8b4ac]/50 uppercase">
          SCENE
        </div>
      </div>

      {/* =========================================================================
          SECTION HEADER & CONTROLS
          ========================================================================= */}
      <div className="relative z-10 max-w-7xl mx-auto px-6 md:px-12 mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center space-x-2 text-[11px] font-mono tracking-[0.25em] text-[#b8b4ac] uppercase font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#e8e6e1]" />
            <span>SERVICE CAPABILITY GALLERY</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight text-[#e8e6e1] leading-tight">
            RUNTIME SECURITY <span className="text-[#e8e6e1]">ARCHITECTURE.</span>
          </h2>
          <p className="text-xs sm:text-sm font-sans text-[#b8b4ac] max-w-xl leading-relaxed">
            The four execution engines of the runtime: red harness, policy broker, blue guardrail, audit ledger. 
          </p>
        </div>

        {/* Replay Sequence Button */}
        <div className="flex items-center space-x-3 text-xs font-mono">
          <button
            type="button"
            onClick={handleReplay}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-md border border-[#b8b4ac]/30 bg-[#16181d]/70 hover:bg-[#3a3f4a]/40 text-[#e8e6e1] font-mono text-[11px] tracking-wider uppercase transition-all duration-200 shadow-md cursor-pointer"
            title="Replay the staggered 3D card flip animation sequence"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#e8e6e1]" />
            <span>⟳ REPLAY FLIP SEQUENCE</span>
          </button>
        </div>
      </div>

      {/* =========================================================================
          ANIMATION B & C: 4-CARD STAGGERED 3D FLIP & PERSPECTIVE ROW COMPOSITION
          ========================================================================= */}
      <div
        className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 md:px-10 py-6"
        style={{ perspective: '1400px' }}
      >
        {/* 4 Cards Arranged in a Centered, Balanced Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-6 md:gap-6 justify-items-center">
          {SERVICE_CARDS.map((card, idx) => {
            const isCream = card.isCream;
            const settledAngle = settledAngles[idx];
            const backAngle = initialBackAngles[idx];

            // Staggered cascade: 135ms gap per card
            const delayMs = idx * 135;
            const currentAngle = hasFlipped ? settledAngle : backAngle;

            return (
              <div
                key={card.id}
                onClick={() => sound.playClick()}
                onMouseEnter={() => sound.playHover()}
                className="w-full max-w-[270px] sm:max-w-[280px] h-[395px] sm:h-[405px] md:h-[415px] cursor-pointer group"
                style={{
                  perspective: '1200px',
                }}
              >
                {/* 3D Flipping Card Body (with preserve-3d) */}
                <div
                  className="relative w-full h-full transform-gpu will-change-transform"
                  style={{
                    transformStyle: 'preserve-3d',
                    transform: `rotateY(${currentAngle}deg)`,
                    transition: prefersReducedMotion
                      ? 'none'
                      : `transform 750ms cubic-bezier(0.2, 0.85, 0.25, 1) ${delayMs}ms`,
                  }}
                >
                  {/* ===============================================================
                      FRONT FACE: Information-Bearing Capability Card
                      =============================================================== */}
                  <div
                    className={`absolute inset-0 w-full h-full rounded-[14px] p-5 flex flex-col justify-between select-none shadow-[0_12px_36px_rgba(0,0,0,0.45)] group-hover:shadow-[0_16px_44px_rgba(0,0,0,0.6)] transition-all duration-300 backface-hidden ${
                      isCream
                        ? 'bg-[#e8e6e1] text-[#16181d]'
                        : 'bg-[#3a3f4a] text-[#e8e6e1] border border-[#b8b4ac]/25'
                    }`}
                    style={{
                      backfaceVisibility: 'hidden',
                      transform: 'rotateY(0deg)', // Front face at 0 deg relative to card body
                    }}
                  >
                    {/* Upper Area: Category Title & Bold Geometric Icon */}
                    <div>
                      <div
                        className="flex items-center justify-between pb-3.5 border-b border-dotted"
                        style={{
                          borderColor: isCream ? 'rgba(116, 51, 79, 0.28)' : 'rgba(244, 235, 221, 0.28)',
                        }}
                      >
                        <span className="text-[11px] font-mono font-bold tracking-widest uppercase">
                          {card.category}
                        </span>
                        <ServiceIcon
                          type={card.iconType}
                          className={`w-5 h-5 ${isCream ? 'text-[#16181d]' : 'text-[#e8e6e1]'}`}
                        />
                      </div>

                      {/* Middle Area: Short Capability List with Dotted Dividers */}
                      <div className="pt-3.5 space-y-2.5">
                        {card.items.map((item, itemIdx) => (
                          <div
                            key={itemIdx}
                            className={`text-[11px] font-sans font-medium tracking-tight leading-snug pb-2.5 ${
                              itemIdx < card.items.length - 1 ? 'border-b border-dotted' : ''
                            }`}
                            style={{
                              borderColor: isCream ? 'rgba(116, 51, 79, 0.22)' : 'rgba(244, 235, 221, 0.22)',
                              color: isCream ? '#16181d' : '#e8e6e1',
                              opacity: isCream ? 0.95 : 0.92,
                            }}
                          >
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Lower Area: Clean Editorial Pillar Index (Non-Repeating) */}
                    <div
                      className="pt-3 pb-0.5 border-t border-dotted flex items-center justify-between text-[10px] font-mono tracking-widest uppercase"
                      style={{
                        borderColor: isCream ? 'rgba(116, 51, 79, 0.22)' : 'rgba(244, 235, 221, 0.22)',
                        color: isCream ? '#3a3f4a' : '#b8b4ac',
                        opacity: 0.85,
                      }}
                    >
                      <span className="font-semibold">PILLAR 0{idx + 1}</span>
                      <span className="flex items-center gap-1.5 text-[9px] font-mono opacity-80">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/80" />
                        <span>ACTIVE</span>
                      </span>
                    </div>
                  </div>

                  {/* ===============================================================
                      BACK FACE: Symmetrical Illustrated Geometric Artwork
                      =============================================================== */}
                  <div
                    className="absolute inset-0 w-full h-full rounded-[14px] overflow-hidden"
                    style={{
                      backfaceVisibility: 'hidden',
                      transform: 'rotateY(180deg)', // Back face at 180 deg relative to card body
                    }}
                  >
                    <CardBackArtwork isCreamCard={isCream} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
