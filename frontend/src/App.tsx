import { useEffect, useState, useRef } from 'react';

import Lenis from 'lenis';

import { Header } from './components/Header';

import { InteractiveConsole } from './components/InteractiveConsole';

import { EditorialLanding } from './pages/EditorialLanding';

import { CinematicExperience } from './pages/CinematicExperience';

import { SecOpsConsole } from './pages/SecOpsConsole';

import { PageTransitionStrip } from './components/PageTransitionStrip';

import { sound } from './utils/audio';



export default function App() {

  const [activeView, setActiveView] = useState<'editorial' | 'cinematic' | 'secops'>(() => {

    if (typeof window !== 'undefined') {

      const hash = window.location.hash;

      if (hash === '#secops' || hash === '#console') return 'secops';

      if (hash === '#cinematic') return 'cinematic';

      return 'editorial';

    }

    return 'editorial';

  });

  const [scrollProgress, setScrollProgress] = useState(0);

  const [isTransitioning, setIsTransitioning] = useState(false);

  const [consoleOpen, setConsoleOpen] = useState(false);

  const [consoleScenario, setConsoleScenario] = useState('SC-02');

  const [tamperActive, setTamperActive] = useState(false);

  const lenisRef = useRef<Lenis | null>(null);

  const flipArmedRef = useRef(false);

  const activeViewRef = useRef(activeView);



  const handleOpenConsole = (scenarioId?: string) => {

    if (scenarioId) {

      setConsoleScenario(scenarioId);

    }

    setConsoleOpen(true);

  };



  useEffect(() => {
    activeViewRef.current = activeView;
    // On a deep-link load (#secops), land the user AT the secops section
    // instead of scrollY=0 with a mismatched header state.
    if (activeView === 'secops') {
      const t = window.setTimeout(() => {
        const el = document.getElementById('secops-console-section');
        if (el && window.scrollY < 10) {
          el.scrollIntoView({ behavior: 'instant' });
          if (lenisRef.current) {
            lenisRef.current.scrollTo(el, { immediate: true });
          }
        }
      }, 120);
      return () => window.clearTimeout(t);
    }
  }, [activeView]);


  useEffect(() => {

    if ('scrollRestoration' in history) {

      history.scrollRestoration = 'manual';

    }

    if (!window.location.hash || window.location.hash === '#editorial') {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }

    const onHashChange = () => {

      const hash = window.location.hash;

      if (hash === '#secops' || hash === '#console') {

        if (activeViewRef.current === 'editorial') {

          handleSwitchToSecOps();

        } else {

          handleScrollToSecOps();

        }

      } else if (hash === '#cinematic') {

        if (activeViewRef.current === 'editorial') {

          handleTransitionTo3D();

        } else {

          handleScrollToCinematicTop();

        }

      } else if (hash === '#editorial' || hash === '') {

        handleSwitchToEditorial('top');

      }

    };

    window.addEventListener('hashchange', onHashChange);

    return () => window.removeEventListener('hashchange', onHashChange);

  }, []);



  // Butter-Smooth Persistent Lenis Scroll Engine

  useEffect(() => {

    const lenis = new Lenis({
      duration: 0.8, // Ultra-responsive smooth scrolling with zero lag
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: 'vertical',
      smoothWheel: true,
      wheelMultiplier: 1.0,
      touchMultiplier: 1.2,
      prevent: (node) => node.closest?.('.world-scroll, .console-scroll, [data-hijack-scroll]') != null,
    });

    lenisRef.current = lenis;
    (window as any).__lenis = lenis;



    const onScroll = () => {

      if (activeViewRef.current === 'editorial') {
        // Editorial mode: the flip to the cinematic page is decided by the
        // dedicated wheel listener below (real user scroll intent), not here.
        // The secops element lives inside the hidden fixed cinematic wrapper,
        // so its rect is meaningless here — using it caused the view to flip
        // mid-editorial, making the footer unreachable.
        return;
      }



      // 1. Calculate Page 2 3D Choreography progress (0.0 -> 1.0)

      const cinematicEl = document.getElementById('cinematic-experience');

      if (cinematicEl) {

        const cinematicHeight = Math.max(cinematicEl.offsetHeight - window.innerHeight, 1);

        const progress = window.scrollY / cinematicHeight;

        // Quantized: 256 steps across the whole page — visually identical

        // for the ref-driven 3D choreography, ~100x fewer React re-renders.

        const q = Math.round(Math.min(Math.max(progress, 0), 1) * 256) / 256;

        setScrollProgress((prev) => (prev === q ? prev : q));

      }



      // 2. Continuous Natural Bridge: update activeView & hash as user scrolls into Page 3

      const secopsEl = document.getElementById('secops-console-section');

      if (secopsEl) {

        const secopsTop = secopsEl.getBoundingClientRect().top;

        if (secopsTop <= window.innerHeight * 0.45) {

          if (activeViewRef.current !== 'secops') {

            activeViewRef.current = 'secops';

            setActiveView('secops');

            history.replaceState(null, '', '#secops');

          }

        } else {

          if (activeViewRef.current !== 'cinematic') {

            activeViewRef.current = 'cinematic';

            setActiveView('cinematic');

            history.replaceState(null, '', '#cinematic');

          }

        }

      }

    };



    window.addEventListener('scroll', onScroll, { passive: true });

    // Wheel-intent bridge: while on the editorial page, flipping to the
    // cinematic page requires the user to be AT the bottom (footer visible)
    // and to keep scrolling DOWN with the wheel. This keeps the footer
    // readable and clickable instead of teleporting past it.
    const onWheel = (e: WheelEvent) => {
      if (activeViewRef.current !== 'editorial') return;
      const docH = document.documentElement.scrollHeight;
      const atBottom = window.innerHeight + window.scrollY >= docH - 40;
      if (!atBottom || e.deltaY <= 0) {
        flipArmedRef.current = false;
        return;
      }
      if (!flipArmedRef.current) {
        // first wheel at the bottom: arm, but hold the footer in place
        flipArmedRef.current = true;
        return;
      }
      // second consecutive downward wheel at the bottom: continue to page 2
      flipArmedRef.current = false;
      activeViewRef.current = 'cinematic';
      setActiveView('cinematic');
      history.replaceState(null, '', '#cinematic');
    };
    window.addEventListener('wheel', onWheel, { passive: true });



    let rafId = 0;

    function raf(time: number) {

      lenis.raf(time);

      rafId = requestAnimationFrame(raf);

    }

    rafId = requestAnimationFrame(raf);



    return () => {

      cancelAnimationFrame(rafId);

      delete (window as any).__lenis;

      lenis.destroy();

      window.removeEventListener('scroll', onScroll);

      window.removeEventListener('wheel', onWheel);

    };

  }, []);



  const scrollToSection = (id: string) => {

    const el = document.getElementById(id);

    if (el && lenisRef.current) {

      lenisRef.current.scrollTo(el, { duration: 1.2 });

    }

  };



  const handleScrollToTop = () => {

    if (lenisRef.current) {

      lenisRef.current.scrollTo(0, { duration: 1.1 });

    } else {

      window.scrollTo({ top: 0, behavior: 'smooth' });

    }

  };



  // Smooth scroll down to Page 3 (SecOps Console)

  const handleScrollToSecOps = () => {

    sound.playClick();

    const el = document.getElementById('secops-console-section');

    if (el && lenisRef.current) {

      lenisRef.current.scrollTo(el, { duration: 1.3, offset: 0 });

    } else if (el) {

      el.scrollIntoView({ behavior: 'smooth' });

    }

  };



  // Smooth scroll up to top of Page 2 (Cinematic Experience)

  const handleScrollToCinematicTop = () => {

    sound.playClick();

    if (lenisRef.current) {

      lenisRef.current.scrollTo(0, { duration: 1.2 });

    } else {

      window.scrollTo({ top: 0, behavior: 'smooth' });

    }

  };



  // Transition from Page 1 -> Page 2

  const handleTransitionTo3D = () => {

    if (isTransitioning) return;

    sound.playClick();

    setIsTransitioning(true);



    if (lenisRef.current) {

      lenisRef.current.stop();

    }



    setTimeout(() => {

      window.location.hash = 'cinematic';

      setActiveView('cinematic');

      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });

      document.documentElement.scrollTop = 0;

      document.body.scrollTop = 0;

      setScrollProgress(0);



      if (lenisRef.current) {

        lenisRef.current.scrollTo(0, { immediate: true });

        lenisRef.current.start();

      }



      setTimeout(() => {

        setIsTransitioning(false);

      }, 300);

    }, 250);

  };



  // Transition back to Editorial (Page 1)

  const handleSwitchToEditorial = (position: 'top' | 'bottom' = 'bottom') => {

    if (isTransitioning) return;

    sound.playClick();

    setIsTransitioning(true);



    if (lenisRef.current) {

      lenisRef.current.stop();

    }



    setTimeout(() => {

      window.location.hash = '';

      setActiveView('editorial');



      requestAnimationFrame(() => {

        const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;

        const targetY = position === 'bottom' ? Math.max(scrollHeight - 80, 0) : 0;



        window.scrollTo({ top: targetY, left: 0, behavior: 'instant' });

        document.documentElement.scrollTop = targetY;

        document.body.scrollTop = targetY;

        setScrollProgress(0);



        if (lenisRef.current) {

          lenisRef.current.scrollTo(targetY, { immediate: true });

          lenisRef.current.start();

        }



        setTimeout(() => {

          setIsTransitioning(false);

        }, 300);

      });

    }, 250);

  };



  // Transition to Page 3 from outside (or scroll if already inside)

  const handleSwitchToSecOps = () => {

    if (activeView === 'cinematic' || activeView === 'secops') {

      handleScrollToSecOps();

      return;

    }



    if (isTransitioning) return;

    sound.playClick();

    setIsTransitioning(true);



    if (lenisRef.current) {

      lenisRef.current.stop();

    }



    setTimeout(() => {

      window.location.hash = 'secops';

      setActiveView('secops');



      setTimeout(() => {

        const el = document.getElementById('secops-console-section');

        if (el) {

          el.scrollIntoView({ behavior: 'instant' });

        }

        if (lenisRef.current) {

          lenisRef.current.start();

        }

        setIsTransitioning(false);

      }, 60);

    }, 250);

  };



  const handleSwitchView = (view: 'editorial' | 'cinematic' | 'secops') => {

    if (view === 'editorial') handleSwitchToEditorial('top');

    else if (view === 'cinematic') handleTransitionTo3D();

    else if (view === 'secops') handleSwitchToSecOps();

  };



  return (

    <div className={`relative min-h-screen ${activeView === 'secops' ? 'bg-[#0c0d10]' : activeView === 'cinematic' ? 'bg-[#050507]' : 'bg-[#f4f5fa]'}`}>

      {/* Global Sleek Header */}

      <Header

        onOpenConsole={() => handleOpenConsole('SC-02')}

        onScrollToTop={handleScrollToTop}

        activeView={activeView}

        onSwitchView={handleSwitchView}

      />



      {/* Interactive Quick Sandbox Modal */}

      <InteractiveConsole

        isOpen={consoleOpen}

        onClose={() => setConsoleOpen(false)}

        onTamperToggle={(val) => setTamperActive(val)}

        tamperActive={tamperActive}

        initialScenario={consoleScenario}

      />



      {/* Seamless Cinematic Crossfade Curtain */}

      <div

        className={`fixed inset-0 z-50 pointer-events-none transition-opacity duration-300 ease-in-out ${

          activeView === 'secops' ? 'bg-[#131418]' : 'bg-[#050507]'

        } ${isTransitioning ? 'opacity-100' : 'opacity-0'}`}

      />



      {/* Page 1: Editorial Landing Showcase */}

      <div

        className={`w-full transition-opacity duration-300 ${

          activeView === 'editorial'

            ? 'relative opacity-100 pointer-events-auto z-10'

            : 'fixed inset-0 opacity-0 pointer-events-none -z-10 overflow-hidden'

        }`}

      >

        <EditorialLanding

          onOpenConsole={handleOpenConsole}

          onTransitionTo3D={handleTransitionTo3D}

          isActive={activeView === 'editorial' && !isTransitioning}

        />

      </div>



      {/* Page 2 & Page 3 Continuous Cinema & SecOps Experience */}

      <div

        className={`w-full transition-opacity duration-300 ${

          activeView === 'cinematic' || activeView === 'secops'

            ? 'relative opacity-100 pointer-events-auto z-10'

            : 'fixed inset-0 opacity-0 pointer-events-none -z-10 overflow-hidden'

        }`}

      >

        {/* Layer 1: Page 2 : 3D Spatial Simulation Chamber */}

        <CinematicExperience

          scrollProgress={scrollProgress}

          tamperActive={tamperActive}

          isActive={activeView === 'cinematic' && !isTransitioning}

          onOpenConsole={handleOpenConsole}

          onSwitchToEditorial={handleSwitchToEditorial}

          onSwitchToSecOps={handleScrollToSecOps}

          scrollToSection={scrollToSection}

        />



        {/* Layer 2: Dedicated Next-Page Transition Strip */}

        <PageTransitionStrip onNavigateToPage3={handleScrollToSecOps} />



        {/* Layer 3: Page 3 : Authentic Wine Noir & Cream SecOps Console */}

        <div id="secops-console-section" className="relative z-10">

          <SecOpsConsole

            onSwitchToEditorial={() => handleSwitchToEditorial('top')}

            onSwitchToCinematic={handleScrollToCinematicTop}

            isActive={!isTransitioning}

          />

        </div>

      </div>

    </div>

  );

}

