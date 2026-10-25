import { useEffect, useState, useRef } from 'react';
import { sound } from '../utils/audio';

interface PageTransitionStripProps {
  onNavigateToPage3: () => void;
}

export function PageTransitionStrip({ onNavigateToPage3 }: PageTransitionStripProps) {
  const containerRef = useRef<HTMLElement>(null);
  const [stripProgress, setStripProgress] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const totalDistance = rect.height + windowHeight * 0.4;
      const currentDistance = windowHeight - rect.top;
      const p = Math.min(Math.max(currentDistance / totalDistance, 0), 1);
      setStripProgress(p);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <section
      ref={containerRef}
      id="page-transition-strip"
      className="relative z-20 w-full bg-[#07080c] border-t border-white/10 overflow-hidden text-white"
    >
      {/* Subtle Atmospheric Wine Color Bleed Leading Into Page 3 */}
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-transparent via-[#07080c]/70 via-35% via-[#101216]/85 to-[#131418]" />
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[85vw] max-w-5xl h-36 bg-gradient-to-t from-[#2a2e37]/25 via-[#23262e]/15 to-transparent blur-3xl pointer-events-none" />

      {/* Main Content Composition */}
      <div className="relative z-10 max-w-7xl mx-auto px-6 md:px-14 py-20 md:py-28 flex flex-col justify-between min-h-[42vh]">
        {/* Upper Left Guidance Text */}
        <div className="flex items-center space-x-2 text-[11px] font-mono tracking-[0.25em] text-neutral-400 uppercase">
          <span className="w-1.5 h-1.5 rounded-full bg-[#00e5ff] shadow-[0_0_8px_#00e5ff] animate-pulse" />
          <span>KEEP SCROLLING TO EXPLORE</span>
        </div>

        {/* Destination Title & Next Page Action Row */}
        <div className="mt-12 md:mt-16 flex flex-col lg:flex-row lg:items-end justify-between gap-8 pb-10">
          {/* Destination Title */}
          <div className="space-y-2">
            <span className="text-xs font-mono text-neutral-500 uppercase tracking-widest block">
              DESTINATION // PAGE 03
            </span>
            <h2 className="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-extralight tracking-tight text-white uppercase leading-[1.05]">
              BAYORA <span className="font-normal text-[#fdfbf7]">EVIDENCE CONSOLE</span>
            </h2>
          </div>

          {/* Next Page Interactive Control */}
          <button
            onClick={() => {
              sound.playClick();
              onNavigateToPage3();
            }}
            onMouseEnter={() => {
              setIsHovered(true);
              sound.playHover();
            }}
            onMouseLeave={() => setIsHovered(false)}
            className="group flex flex-col items-start lg:items-end space-y-2.5 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-[#00e5ff] rounded-lg p-1 transition-all"
            aria-label="Scroll to Page 3 : Bayora Evidence Console"
          >
            <div className="flex items-center space-x-3 text-xs md:text-sm font-mono tracking-wider uppercase text-neutral-300 group-hover:text-white transition-colors">
              <span className="font-medium">NEXT PAGE</span>
              <span className="text-[#00e5ff] font-mono tracking-tighter">[──►]</span>
            </div>

            {/* Thin Horizontal Progress Indicator */}
            <div className="w-36 md:w-52 h-[1.5px] bg-white/15 relative overflow-hidden rounded-full">
              <div
                className="h-full bg-white/70 transition-all duration-300 ease-out"
                style={{
                  width: isHovered ? '100%' : `${Math.min(Math.max(stripProgress * 100, 16), 100)}%`,
                }}
              />
            </div>
          </button>
        </div>

        {/* Decorative Plus-Sign Baseline */}
        <div className="pt-8 border-t border-white/10 flex items-center justify-between text-white/20 font-mono text-[11px] select-none tracking-widest overflow-hidden">
          <span>+</span>
          <span className="hidden sm:inline">+</span>
          <span>+</span>
          <span className="hidden sm:inline">+</span>
          <span>+</span>
          <span className="hidden sm:inline">+</span>
          <span>+</span>
          <span className="hidden sm:inline">+</span>
          <span>+</span>
          <span className="hidden sm:inline">+</span>
          <span>+</span>
          <span className="hidden sm:inline">+</span>
          <span>+</span>
        </div>
      </div>
    </section>
  );
}
