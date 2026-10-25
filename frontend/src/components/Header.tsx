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
  activeView = 'editorial',
}: HeaderProps) {
  const [isDarkTheme, setIsDarkTheme] = useState(activeView === 'cinematic' || activeView === 'secops');
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    if (activeView === 'cinematic' || activeView === 'secops') {
      setIsDarkTheme(true);
      return;
    }

    const onScroll = () => {
      const threshold = 4200;
      setIsDarkTheme(window.scrollY > threshold);
      setIsScrolled(window.scrollY > 20);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [activeView]);

  const isSecOps = activeView === 'secops';

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-40 px-6 md:px-14 py-4 md:py-5 flex items-center justify-between pointer-events-auto transition-all duration-300 select-none ${
        isScrolled
          ? isSecOps
            ? 'bg-[#0c0d10]/85 border-b border-[#2a2e37]/40'
            : isDarkTheme
            ? 'bg-[#050507]/80 border-b border-white/10'
            : 'bg-[#f4f5fa]/80 border-b border-black/5 shadow-sm'
          : 'bg-transparent'
      }`}
    >
      {/* Upper Left Wordmark & Identity Tag */}
      <div className="flex items-center space-x-3">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            onScrollToTop();
            sound.playClick();
          }}
          className={`font-black tracking-tight text-xl md:text-2xl transition-colors duration-300 ${
            isSecOps ? 'text-[#e8e6e1]' : isDarkTheme ? 'text-white' : 'text-[#0a0a0e]'
          }`}
        >
          BAYORA
        </a>
        <span
          className={`hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-md text-[9px] font-mono tracking-widest uppercase transition-colors duration-300 ${
            isSecOps
              ? 'bg-[#0c0d10]/70 text-[#d97706] border border-[#3a3f4a]/60'
              : isDarkTheme
              ? 'bg-white/10 text-neutral-300 border border-white/15'
              : 'bg-black/5 text-neutral-600 border border-black/10'
          }`}
        >
          {isSecOps ? 'SECOPS EVIDENCE SUITE' : 'ZERO-TRUST AI DEFENSE'}
        </span>
      </div>

      {/* Upper Right Action Controls */}
      <div className="flex items-center space-x-2 md:space-x-3 font-mono">
        {/* Page Navigation Capsule: "SECURITY SANDBOX •" */}
        <button
          onClick={() => {
            onOpenConsole();
            sound.playClick();
          }}
          onMouseEnter={() => sound.playHover()}
          className={`px-4 md:px-5 py-2 rounded-md text-[11px] font-bold tracking-wider uppercase transition-all flex items-center space-x-2 cursor-pointer ${
            isSecOps
              ? 'bg-[#2b0818] border border-[#3a3f4a]/50 text-[#e8e6e1] hover:border-[#ef4444]'
              : isDarkTheme
              ? 'bg-[#151922] border border-cyan-500/30 text-white hover:border-cyan-400 hover:shadow-[0_0_15px_rgba(0,229,255,0.2)]'
              : 'bg-[#12131a] text-white hover:bg-black shadow-md'
          }`}
        >
          <span>QUICK SANDBOX</span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#22d3ee] animate-pulse" />
        </button>
      </div>
    </header>
  );
}
