import { useEffect , memo } from 'react';

// Lucide icons replaced with industrial monospace affordances

import { CinematicCanvas } from '../components/CinematicCanvas';

import { LiquidGlassCanvas } from '../components/LiquidGlassCanvas';

import { sound } from '../utils/audio';



interface CinematicExperienceProps {

  scrollProgress: number;

  tamperActive: boolean;

  isActive?: boolean;

  onOpenConsole: (scenarioId?: string) => void;

  onSwitchToEditorial: () => void;

  onSwitchToSecOps?: () => void;

  scrollToSection: (id: string) => void;

}



function CinematicExperienceInner({

  scrollProgress,

  tamperActive,

  isActive = true,

  onOpenConsole,

  onSwitchToEditorial,

  onSwitchToSecOps: _onSwitchToSecOps,

  scrollToSection,

}: CinematicExperienceProps) {

  // When at the top of Page 2 (scrollY <= 5), scrolling UP transitions smoothly to Page 1 bottom

  useEffect(() => {

    if (!isActive) return;



    let upScrollAccumulator = 0;

    let isTriggering = false;

    let resetTimer: number | null = null;



    const onWheel = (e: WheelEvent) => {

      if (isTriggering) return;

      const currentY = window.scrollY;



      if (currentY <= 5 && e.deltaY < 0) {

        upScrollAccumulator += Math.abs(e.deltaY);



        if (resetTimer) clearTimeout(resetTimer);

        resetTimer = window.setTimeout(() => {

          upScrollAccumulator = 0;

        }, 300);



        if (upScrollAccumulator >= 40) {

          isTriggering = true;

          onSwitchToEditorial();

        }

      } else {

        upScrollAccumulator = 0;

      }

    };



    let touchStartY = 0;

    const onTouchStart = (e: TouchEvent) => {

      if (e.touches.length > 0) {

        touchStartY = e.touches[0].clientY;

      }

    };



    const onTouchMove = (e: TouchEvent) => {

      if (isTriggering || e.touches.length === 0) return;

      const currentY = window.scrollY;

      const deltaTouchY = e.touches[0].clientY - touchStartY;



      if (currentY <= 2 && deltaTouchY > 50) {

        isTriggering = true;

        onSwitchToEditorial();

      }

    };



    window.addEventListener('wheel', onWheel, { passive: true });

    window.addEventListener('touchstart', onTouchStart, { passive: true });

    window.addEventListener('touchmove', onTouchMove, { passive: true });



    return () => {

      window.removeEventListener('wheel', onWheel);

      window.removeEventListener('touchstart', onTouchStart);

      window.removeEventListener('touchmove', onTouchMove);

      if (resetTimer) clearTimeout(resetTimer);

    };

  }, [isActive, onSwitchToEditorial]);



  return (

    <div id="cinematic-experience" className="relative min-h-screen bg-[#050507] text-white selection:bg-white/20 selection:text-white font-sans overflow-x-hidden">

      {/* WebGL 3D Canvas in background */}

      <CinematicCanvas

        scrollProgress={scrollProgress}

        tamperActive={tamperActive}

        isActive={isActive}

      />



      {/* =========================================================================

          SCENE 1: SPATIAL SIMULATION OBSERVATORY (Clean 3D Cinema Framing)

          ========================================================================= */}

      <section

        id="hero"

        className="relative min-h-screen flex flex-col justify-between p-6 md:p-14 z-10 pointer-events-none select-none"

      >

        {/* Top HUD Status Bar */}

        <div className="pt-20 flex items-center justify-between">

          <div className="inline-flex items-center space-x-2.5 px-3.5 py-1.5 rounded-full border border-white/10 bg-black/40 backdrop-blur-xl">

            <span className="w-1.5 h-1.5 rounded-full bg-[#00e5ff] animate-pulse inline-block" />

            <span className="text-[10px] font-mono tracking-widest text-neutral-300 uppercase">

              SPATIAL SIMULATION CHAMBER · 3D ORBIT ACTIVE

            </span>

          </div>
        </div>



          



        {/* Minimalist Floating 3D Spatial Theater Title (Uncluttered, Cinema-First) */}

        <div className="my-auto max-w-4xl space-y-4">

          <div className="flex items-center space-x-2 text-xs font-mono tracking-[0.25em] text-[#00e5ff] uppercase">

            <span className="text-[#00e5ff] font-mono text-[10px]">[POS]</span>

            <span>BAYORA 3D OBSERVATORY // NODE MATRIX</span>

          </div>



          <h1 className="text-5xl sm:text-7xl md:text-8xl lg:text-9xl font-black tracking-tighter leading-none text-white uppercase drop-shadow-[0_20px_50px_rgba(0,0,0,0.9)]">

            SPATIAL <br />

            <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-cyan-200 to-[#00e5ff]">

              SIMULATION.

            </span>

          </h1>



          <p className="text-xs sm:text-sm font-mono tracking-wider text-neutral-400 max-w-xl leading-relaxed">

            Real-time WebGL traversal through zero-trust isolation boundaries, gravitational policy membranes, and cryptographic attractors. Scroll to navigate the 3D timeline.

          </p>



          {/* Quick Scene Jumps Strip */}

          <div className="flex flex-wrap items-center gap-2 pt-2 pointer-events-auto">

            <button

              onClick={() => {

                sound.playClick();

                scrollToSection('landscape');

              }}

              className="px-3 py-1 rounded-full border border-white/10 bg-white/5 hover:bg-white/15 font-mono text-[10px] text-neutral-300 transition-colors cursor-pointer"

            >

              01 · TOPOLOGY

            </button>

            <button

              onClick={() => {

                sound.playClick();

                scrollToSection('architecture');

              }}

              className="px-3 py-1 rounded-full border border-white/10 bg-white/5 hover:bg-white/15 font-mono text-[10px] text-neutral-300 transition-colors cursor-pointer"

            >

              02 · LIQUID OBSERVATORY

            </button>

            <button

              onClick={() => {

                sound.playClick();

                scrollToSection('core');

              }}

              className="px-3 py-1 rounded-full border border-white/10 bg-white/5 hover:bg-white/15 font-mono text-[10px] text-neutral-300 transition-colors cursor-pointer"

            >

              03 · KERNEL RUNTIME

            </button>

            <button

              onClick={() => {

                sound.playClick();

                scrollToSection('sandbox');

              }}

              className="px-3 py-1 rounded-full border border-white/10 bg-white/5 hover:bg-white/15 font-mono text-[10px] text-neutral-300 transition-colors cursor-pointer"

            >

              04 · SECOPS SUITE

            </button>

          </div>

        </div>



        {/* Bottom Telemetry HUD */}

        <div className="flex items-center justify-between border-t border-white/10 pt-4 font-mono text-[10px] tracking-widest text-neutral-400">

          <div className="flex items-center space-x-2">

            <span className="text-emerald-400 font-mono text-[10px]">[STATUS]</span>

            <span className="text-neutral-300">CAMERA: SCROLL-COORDINATED (0° - 180° AZIMUTH)</span>

          </div>



          <button

            onClick={() => {

              sound.playClick();

              scrollToSection('landscape');

            }}

            className="pointer-events-auto flex items-center space-x-2 text-neutral-400 hover:text-white transition-colors cursor-pointer"

          >

            <span>DESCEND TIMELINE</span>

            <span className="text-[#00e5ff] font-mono text-xs">[▼]</span>

          </button>

        </div>

      </section>



      {/* =========================================================================

          SCENE 2: TOPOLOGICAL PROBE & SPATIAL MEMBRANE TELEMETRY

          (Streamlined HUD overlay, zero chunky sales marketing cards)

          ========================================================================= */}

      <section

        id="landscape"

        className="relative min-h-screen flex items-center p-6 md:p-14 z-10 pointer-events-auto select-none"

      >

        <div className="w-full max-w-7xl mx-auto flex flex-col md:flex-row md:items-end justify-between gap-10">

          {/* Left Spatial Readout */}

          <div className="space-y-4 max-w-2xl">

            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full border border-cyan-500/30 bg-cyan-950/20 text-[#00e5ff] font-mono text-[10px] tracking-widest uppercase">

              <span className="text-[#00e5ff] font-mono text-[10px]">[PROBE]</span>

              <span>// 01 · TOPOLOGICAL FIELD PROBE</span>

            </div>



            <h2 className="text-4xl sm:text-6xl md:text-7xl font-black tracking-tight leading-[0.98] text-white uppercase drop-shadow-[0_10px_30px_rgba(0,0,0,0.9)]">

              ZERO-TRUST <br />

              <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-200 via-cyan-300 to-cyan-400">

                MEMBRANE.

              </span>

            </h2>



            <p className="text-xs sm:text-sm font-mono text-neutral-300 leading-relaxed max-w-lg">

              Synchronous deformation mapping 14 hostile attack vectors to topological curvature. Offline sandbox boundary prevents lateral payload migration.

            </p>

          </div>



          {/* Right Minimalist Floating Telemetry Strip */}

          <div className="grid grid-cols-2 gap-4 p-6 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl font-mono text-xs max-w-md shadow-2xl">

            <div className="space-y-1 p-3 rounded-xl bg-white/[0.02] border border-white/5">

              <span className="text-[10px] text-neutral-500 uppercase tracking-widest block">ATTACK SPACE</span>

              <span className="text-white font-bold text-lg">14 SCENARIOS</span>

            </div>

            <div className="space-y-1 p-3 rounded-xl bg-white/[0.02] border border-white/5">

              <span className="text-[10px] text-neutral-500 uppercase tracking-widest block">HASH CHAIN</span>

              <span className="text-[#00e5ff] font-bold text-lg">SHA-256</span>

            </div>

            <div className="space-y-1 p-3 rounded-xl bg-white/[0.02] border border-white/5">

              <span className="text-[10px] text-neutral-500 uppercase tracking-widest block">CONTAINMENT</span>

              <span className="text-emerald-400 font-bold text-lg">EROFS DOCKER</span>

            </div>

            <div className="space-y-1 p-3 rounded-xl bg-white/[0.02] border border-white/5">

              <span className="text-[10px] text-neutral-500 uppercase tracking-widest block">ATTESTATION</span>

              <span className="text-cyan-300 font-bold text-lg">Ed25519</span>

            </div>

          </div>

        </div>



        {/* Seamless Atmospheric Gradient Bridge into Scene 3 */}

        <div className="absolute bottom-0 left-0 right-0 h-40 pointer-events-none z-0 bg-gradient-to-b from-transparent via-[#050507]/60 to-[#030303]" />

      </section>



      {/* =========================================================================

          SCENE 3: THE LIQUID GLASS OBSERVATORY & CONTINUOUS TYPOGRAPHIC MARQUEE

          (Art-Directed Cinematic Installation)

          ========================================================================= */}

      <section

        id="architecture"

        className="relative py-20 md:py-28 px-6 md:px-14 z-10 pointer-events-auto text-white overflow-hidden select-none"

      >

        {/* Real-Time Procedural Liquid-Glass WebGL Canvas */}

        <LiquidGlassCanvas paused={!isActive} />



        {/* Ambient Chromatic Atmospheric Glow */}

        <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden flex items-center justify-center">

        </div>



        {/* Top Editorial Row: Asymmetrical Headline on Left, Supporting Statement on Right */}

        <div className="relative z-10 w-full max-w-7xl mx-auto flex flex-col md:flex-row md:items-end justify-between gap-8 md:gap-16 pt-4 pb-12 md:pb-16">

          {/* Left: Oversized Editorial Heading */}

          <div className="space-y-4 max-w-3xl">

            <span className="text-[11px] font-mono tracking-[0.25em] text-[#00e5ff] uppercase block font-semibold">

              // 02 · LIQUID OBSERVATORY · SPECULAR SURFACE

            </span>

            <h2 className="text-4xl sm:text-5xl md:text-6xl lg:text-[4.2vw] font-light tracking-[-0.03em] uppercase leading-[0.98] text-white">

              BUILT FOR VERIFIABLE <br />

              <span className="font-normal text-white">AI SECURITY</span>

            </h2>

          </div>



          {/* Right: Compact Multi-Line Supporting Statement */}

          <div className="max-w-sm sm:max-w-md md:text-right">

            <p className="text-xs sm:text-[13px] md:text-sm font-mono tracking-widest text-neutral-400 leading-relaxed uppercase">

              A CONTROLLED PIPELINE FOR ADVERSARIAL TESTING, POLICY ENFORCEMENT, CONTAINMENT, AND TAMPER-EVIDENT AUDIT.

            </p>

          </div>

        </div>



        {/* Three Continuous Horizontal Marquee Rows with Soft Edge Masking */}

        <div className="relative z-10 w-full space-y-7 md:space-y-10 py-6 md:py-8 overflow-hidden [mask-image:linear-gradient(to_right,transparent_0%,black_6%,black_94%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_right,transparent_0%,black_6%,black_94%,transparent_100%)]">

          {/* Track A: Moves Left */}

          <div className="overflow-hidden w-full py-1">

            <div className="animate-marquee-left hover:[animation-play-state:paused] flex items-center whitespace-nowrap cursor-default">

              {[0, 1].map((copyIndex) => (

                <div key={copyIndex} className="flex items-center shrink-0">

                  <span className="font-sans font-black tracking-tight text-xl sm:text-2xl md:text-3xl text-white uppercase">

                    RED HARNESS

                  </span>

                  <span className="text-neutral-600 px-6 sm:px-10 text-xl select-none">·</span>

                  <span className="font-mono font-medium tracking-[0.2em] text-lg sm:text-xl md:text-2xl text-neutral-300 uppercase">

                    POLICY BROKER

                  </span>

                  <span className="text-neutral-600 px-6 sm:px-10 text-xl select-none">·</span>

                  <span className="font-serif italic font-normal tracking-wide text-2xl sm:text-3xl md:text-4xl text-white">

                    TARGET MODEL

                  </span>

                  <span className="text-neutral-600 px-6 sm:px-10 text-xl select-none">·</span>

                  <span className="font-sans font-light tracking-[0.25em] text-lg sm:text-xl md:text-2xl text-neutral-200 uppercase">

                    BLUE GUARDRAIL

                  </span>

                  <span className="text-neutral-600 px-6 sm:px-10 text-xl select-none">·</span>

                  <span className="font-mono font-bold tracking-widest text-xl sm:text-2xl md:text-3xl text-cyan-300 uppercase">

                    AUDIT LEDGER

                  </span>

                  <span className="text-neutral-600 px-6 sm:px-10 text-xl select-none">·</span>

                </div>

              ))}

            </div>

          </div>



          {/* Track B: Moves Right */}

          <div className="overflow-hidden w-full py-1">

            <div className="animate-marquee-right hover:[animation-play-state:paused] flex items-center whitespace-nowrap cursor-default">

              {[0, 1].map((copyIndex) => (

                <div key={copyIndex} className="flex items-center shrink-0">

                  <span className="font-mono font-bold tracking-wider text-xl sm:text-2xl md:text-3xl text-white uppercase">

                    CANARY SCRUB

                  </span>

                  <span className="text-neutral-600 px-6 sm:px-10 text-xl select-none">·</span>

                  <span className="font-sans font-light tracking-[0.2em] text-lg sm:text-xl md:text-2xl text-neutral-300 uppercase">

                    SCHEMA VALIDATION

                  </span>

                  <span className="text-neutral-600 px-6 sm:px-10 text-xl select-none">·</span>

                  <span className="font-serif italic font-medium text-2xl sm:text-3xl md:text-4xl text-white">

                    EGRESS CONTROL

                  </span>

                  <span className="text-neutral-600 px-6 sm:px-10 text-xl select-none">·</span>

                  <span className="font-sans font-black tracking-normal text-xl sm:text-2xl md:text-3xl text-white uppercase">

                    ZERO TRUST

                  </span>

                  <span className="text-neutral-600 px-6 sm:px-10 text-xl select-none">·</span>

                  <span className="font-mono font-medium tracking-[0.25em] text-lg sm:text-xl md:text-2xl text-neutral-200 uppercase">

                    HASH VERIFICATION

                  </span>

                  <span className="text-neutral-600 px-6 sm:px-10 text-xl select-none">·</span>

                </div>

              ))}

            </div>

          </div>



          {/* Track C: Moves Left */}

          <div className="overflow-hidden w-full py-1">

            <div className="animate-marquee-left-fast hover:[animation-play-state:paused] flex items-center whitespace-nowrap cursor-default">

              {[0, 1].map((copyIndex) => (

                <div key={copyIndex} className="flex items-center shrink-0">

                  <span className="font-sans font-black tracking-wider text-xl sm:text-2xl md:text-3xl text-neutral-100 uppercase">

                    KERNEL CONTAINMENT

                  </span>

                  <span className="text-neutral-600 px-6 sm:px-10 text-xl select-none">·</span>

                  <span className="font-mono font-light tracking-[0.25em] text-lg sm:text-xl md:text-2xl text-neutral-300 uppercase">

                    OFFLINE MOCK MODE

                  </span>

                  <span className="text-neutral-600 px-6 sm:px-10 text-xl select-none">·</span>

                  <span className="font-serif italic font-normal text-2xl sm:text-3xl md:text-4xl text-white">

                    TAMPER DETECTION

                  </span>

                  <span className="text-neutral-600 px-6 sm:px-10 text-xl select-none">·</span>

                  <span className="font-sans font-bold tracking-tight text-xl sm:text-2xl md:text-3xl text-white uppercase">

                    SANDBOXED EXECUTION

                  </span>

                  <span className="text-neutral-600 px-6 sm:px-10 text-xl select-none">·</span>

                  <span className="font-mono font-medium tracking-[0.2em] text-lg sm:text-xl md:text-2xl text-neutral-200 uppercase">

                    NO LATERAL MOVEMENT

                  </span>

                  <span className="text-neutral-600 px-6 sm:px-10 text-xl select-none">·</span>

                </div>

              ))}

            </div>

          </div>

        </div>



        {/* Giant Outlined Low-Contrast Background Lettering */}

        <div className="absolute inset-x-0 bottom-2 md:bottom-4 pointer-events-none select-none z-0 overflow-hidden flex justify-center [mask-image:linear-gradient(to_bottom,black_30%,transparent_90%)] [-webkit-mask-image:linear-gradient(to_bottom,black_30%,transparent_90%)]">

          <span className="text-[18vw] md:text-[21vw] font-black uppercase tracking-tighter leading-none text-transparent [-webkit-text-stroke:1.2px_rgba(255,255,255,0.04)] opacity-40 whitespace-nowrap translate-y-1/4">

            DETERMINISTIC

          </span>

        </div>

      </section>



      {/* =========================================================================

          SCENE 4: KERNEL RUNTIME SPECIFICATIONS (Minimalist Telemetry Ribbon)

          ========================================================================= */}

      <section

        id="core"

        className="relative pt-12 md:pt-16 pb-24 md:pb-32 px-6 md:px-14 z-10 pointer-events-auto select-none"

      >

        <div className="w-full max-w-7xl mx-auto space-y-8">

          <div className="space-y-3 max-w-2xl">

            <span className="text-[11px] font-mono tracking-[0.25em] text-[#00e5ff] uppercase block font-semibold">

              // 03 · KERNEL RUNTIME SPECIFICATIONS

            </span>

            <h3 className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tight text-white uppercase leading-none">

              SYSTEM DIRECTIVES.

            </h3>

            <div className="pt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  sound.unlockAudio();
                  window.dispatchEvent(new CustomEvent('bayora:trigger-blast'));
                }}
                className="group inline-flex items-center gap-2.5 px-4 py-2 rounded-full border border-cyan-500/40 bg-cyan-950/40 hover:bg-cyan-500/20 text-cyan-300 font-mono text-[11px] tracking-wider uppercase transition-all duration-200  cursor-pointer pointer-events-auto"
                title="Detonate and hear the custom WHOOM blast sound effect"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00e5ff]" />
                </span>
                <span>[EXEC] TEST WHOOM AUDIO</span>
              </button>
              <span className="text-[10px] font-mono text-neutral-400">
                (OR SCROLL STEADILY INTO SCENE 4 TO AUTO-DETONATE)
              </span>
            </div>

          </div>



          {/* Architecture Specification Matrix (replaces generic 3-card grid & liquid glass) */}
          <div className="rounded-lg border border-white/15 bg-[#080b12] font-mono text-xs divide-y md:divide-y-0 md:divide-x divide-white/10 grid grid-cols-1 md:grid-cols-3">
            <div className="p-5 space-y-1.5">
              <span className="text-[10px] text-cyan-400 font-bold block uppercase tracking-widest">
                SPEC // DIR-01 : OFFLINE FIRST
              </span>
              <div className="text-white font-semibold text-xs tracking-wider">ZERO EXTERNAL EGRESS</div>
              <p className="text-neutral-400 text-[11px] leading-relaxed">
                Engineered for air-gapped critical AI infrastructure with zero live network sockets.
              </p>
            </div>

            <div className="p-5 space-y-1.5">
              <span className="text-[10px] text-amber-400 font-bold block uppercase tracking-widest">
                SPEC // DIR-02 : KERNEL FENCE
              </span>
              <div className="text-white font-semibold text-xs tracking-wider">DOCKER EROFS READ-ONLY</div>
              <p className="text-neutral-400 text-[11px] leading-relaxed">
                Container root is strictly read-only (errno 30), preventing filesystem persistence.
              </p>
            </div>

            <div className="p-5 space-y-1.5">
              <span className="text-[10px] text-emerald-400 font-bold block uppercase tracking-widest">
                SPEC // DIR-03 : CRYPTO ROOT
              </span>
              <div className="text-white font-semibold text-xs tracking-wider">ED25519 ASYMMETRIC SEAL</div>
              <p className="text-neutral-400 text-[11px] leading-relaxed">
                Mathematical attestation verifiable offline by independent third-party auditors.
              </p>
            </div>
          </div>
        </div>
      </section>



      {/* =========================================================================

          SCENE 5: SIMULATION COMMAND DECK & SECOPS GATEWAY

          ========================================================================= */}

      <section

        id="sandbox"

        className="relative min-h-screen flex flex-col items-center justify-center p-6 md:p-14 z-10 pointer-events-auto"

      >

        <div className="w-full max-w-4xl space-y-8 text-center">

          <div className="p-8 md:p-14 rounded-3xl border border-white/10 bg-black/40 backdrop-blur-xl space-y-6 shadow-2xl">

            <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full border border-cyan-500/30 bg-cyan-950/30 text-[#00e5ff] font-mono text-xs">

              <span className="font-mono text-[10px] text-[#00e5ff]">[SPEC]</span>

              <span>SIMULATION BENCHMARK COMPLETE</span>

            </div>



            <h3 className="text-3xl sm:text-5xl md:text-6xl font-black tracking-tight text-white uppercase leading-tight">

              PROVE ZERO TRUST <br />

              <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-cyan-200 to-[#00e5ff]">

                IN THE TERMINAL.

              </span>

            </h3>



            <p className="text-xs sm:text-sm md:text-base text-neutral-300 font-mono max-w-2xl mx-auto leading-relaxed">

              Dispatch live adversarial inputs, trigger synthetic canary disclosure traps, and test 1-byte ledger tampering directly.

            </p>



            <div className="flex flex-wrap items-center justify-center gap-4 pt-2">

              <button

                onClick={() => {

                  sound.playClick();

                  onOpenConsole('SC-02');

                }}

                onMouseEnter={() => sound.playHover()}

                className="px-7 py-3.5 rounded-full bg-white text-black font-mono font-bold text-xs tracking-wider hover:bg-neutral-200 transition-all flex items-center space-x-2.5 cursor-pointer"

              >

                <span className="font-mono font-bold text-xs">[TERM]</span>

                <span>OPEN PROOF TERMINAL</span>

              </button>



              

            </div>

          </div>





        </div>

      </section>



      {/* Minimalist 3D Simulation Status Footer */}

      <footer className="relative z-10 border-t border-white/10 px-6 md:px-14 py-6 flex flex-col sm:flex-row items-center justify-between text-[11px] font-mono text-neutral-500 gap-4">

        <div className="flex items-center space-x-2">

          <span className="w-2 h-2 rounded-full bg-[#00e5ff] shadow-[0_0_6px_#00e5ff]" />

          <span className="text-neutral-400 font-bold uppercase tracking-wider">BAYORA 3D OBSERVATORY</span>

          <span>· SPATIAL SIMULATION ENGINE v1.0</span>

        </div>

        <div className="flex items-center space-x-6">

          <button onClick={onSwitchToEditorial} className="hover:text-white transition-colors flex items-center gap-1 cursor-pointer">

            <span className="text-[#00e5ff] font-mono text-xs">[↑]</span>

            <span>RETURN TO EDITORIAL</span>

          </button>

          <span>60 FPS</span>

          <span>WEBGL 2.0</span>

        </div>

      </footer>

    </div>

  );

}



export const CinematicExperience = memo(CinematicExperienceInner);
