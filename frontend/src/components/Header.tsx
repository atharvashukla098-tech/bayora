import { useState, useEffect } from 'react';
import { sound } from '../utils/audio';

interface HeaderProps {
  onOpenConsole: () => void;
  onScrollToTop: () => void;
  activeView?: 'editorial' | 'cinematic' | 'secops';
  onSwitchView?: (view: 'editorial' | 'cinematic' | 'secops') => void;
}

export function Header({
  onOpenConsole,
  onScrollToTop,
  activeView: _activeView = 'editorial',
}: HeaderProps) {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-40 px-4 sm:px-8 lg:px-12 py-3.5 flex items-center justify-between pointer-events-auto transition-all duration-300 select-none ${
        isScrolled
          ? 'bg-[#060811]/90 backdrop-blur-md border-b border-white/10 shadow-2xl'
          : 'bg-[#060811]/60 backdrop-blur-sm border-b border-white/5'
      }`}
    >
      {/* Upper Left Wordmark & Identity Tag matching cockpit header */}
      <div className="flex items-center space-x-3.5">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            onScrollToTop();
            sound.playClick();
          }}
          className="flex items-center space-x-2.5 group cursor-pointer"
        >
          {/* Angular Shield Logo */}
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/40 flex items-center justify-center text-cyan-300 group-hover:border-cyan-400 group-hover:text-white transition-all shadow-[0_0_12px_rgba(34,211,238,0.25)]">
            <svg
              className="w-4.5 h-4.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </div>
          <span className="font-sans font-black tracking-wider text-xl sm:text-2xl text-white">
            BAYORA
          </span>
        </a>

        <span className="hidden md:inline text-neutral-600">|</span>

        <span className="hidden md:inline-flex items-center text-xs font-mono tracking-widest text-neutral-300 uppercase font-semibold">
          CANARY LEAK DETECTION ENGINE
        </span>
      </div>

      {/* Center Tagline */}
      <div className="hidden lg:flex items-center space-x-2 text-[11px] font-mono text-neutral-400 tracking-wider">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
        <span className="text-neutral-300 font-semibold">ZERO-TRUST</span>
        <span className="text-neutral-600">/</span>
        <span className="text-neutral-300 font-semibold">AIR-GAPPED</span>
        <span className="text-neutral-600">/</span>
        <span className="text-neutral-300 font-semibold">MATHEMATICALLY VERIFIED</span>
      </div>

      {/* Upper Right Action Controls */}
      <div className="flex items-center space-x-2.5 sm:space-x-3 font-mono">
        {/* Scenario Pill */}
        <div className="hidden sm:flex items-center space-x-2 px-2.5 py-1 rounded bg-white/5 border border-white/10 text-[10px]">
          <span className="text-cyan-400 font-bold">SC-02</span>
          <span className="text-neutral-400">CANARY SECRET LEAK</span>
        </div>

        {/* Action Button */}
        <button
          onClick={() => {
            onOpenConsole();
            sound.playClick();
          }}
          onMouseEnter={() => sound.playHover()}
          className="px-4 py-2 rounded-lg text-xs font-bold tracking-wider uppercase transition-all flex items-center space-x-2 cursor-pointer bg-gradient-to-r from-cyan-500/20 to-blue-600/20 border border-cyan-500/40 text-cyan-300 hover:border-cyan-400 hover:text-white hover:shadow-[0_0_15px_rgba(0,229,255,0.3)]"
        >
          <span>FULL EVIDENCE CONSOLE</span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#22d3ee] animate-pulse" />
        </button>
      </div>
    </header>
  );
}
