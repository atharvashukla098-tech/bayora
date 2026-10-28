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

  // Strictly start on the first page ('editorial') on every entry
  const [activeView, setActiveView] = useState<'editorial' | 'cinematic' | 'secops'>('editorial');

  const [scrollProgress, setScrollProgress] = useState(0);

  const [isTransitioning, setIsTransitioning] = useState(false);

  const [consoleOpen, setConsoleOpen] = useState(false);

  const [consoleScenario, setConsoleScenario] = useState('SC-02');

  const [tamperActive, setTamperActive] = useState(false);

  const lenisRef = useRef<Lenis | null>(null);

  const activeViewRef = useRef(activeView);
  const transitionTo3DRef = useRef<() => void>(() => {});



  const handleOpenConsole = (scenarioId?: string) => {

    if (scenarioId) {

      setConsoleScenario(scenarioId);

    }

    setConsoleOpen(true);

  };



  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);


  useEffect(() => {

    if ('scrollRestoration' in history) {

      history.scrollRestoration = 'manual';

    }

    const resetToFirstPageStart = () => {
      if (!window.location.hash || window.location.hash === '#editorial') {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        if (lenisRef.current) {
          lenisRef.current.scrollTo(0, { immediate: true });
        }
      }
    };
    resetToFirstPageStart();
    window.addEventListener('load', resetToFirstPageStart);
    window.addEventListener('pageshow', resetToFirstPageStart);

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

    return () => {
      window.removeEventListener('load', resetToFirstPageStart);
      window.removeEventListener('pageshow', resetToFirstPageStart);
      window.removeEventListener('hashchange', onHashChange);

    };

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

    // Strictly enforce starting at top of the first page
    lenis.scrollTo(0, { immediate: true });
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;



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

    // Bidirectional scroll bridge: when user reaches the end of the first page (editorial)
    // and scrolls down, redirect to the starting of the second page (cinematic).
    let downScrollAccumulator = 0;
    let downResetTimer: number | null = null;

    const onWheel = (e: WheelEvent) => {
      if (activeViewRef.current !== 'editorial') return;
      const scrollY = window.scrollY || (window as any).__lenis?.scroll || document.documentElement.scrollTop || 0;
      const docH = document.documentElement.scrollHeight;
      const atBottom = window.innerHeight + scrollY >= docH - 75;
      if (!atBottom || e.deltaY <= 0) {
        downScrollAccumulator = 0;
        return;
      }

      downScrollAccumulator += Math.abs(e.deltaY);
      if (downResetTimer) clearTimeout(downResetTimer);
      downResetTimer = window.setTimeout(() => {
        downScrollAccumulator = 0;
      }, 300);

      if (downScrollAccumulator >= 30) {
        downScrollAccumulator = 0;
        transitionTo3DRef.current();
      }
    };
    window.addEventListener('wheel', onWheel, { passive: true });

    let touchStartY = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        touchStartY = e.touches[0].clientY;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (activeViewRef.current !== 'editorial' || e.touches.length === 0) return;
      const scrollY = window.scrollY || (window as any).__lenis?.scroll || document.documentElement.scrollTop || 0;
      const docH = document.documentElement.scrollHeight;
      const atBottom = window.innerHeight + scrollY >= docH - 75;
      const deltaTouchY = touchStartY - e.touches[0].clientY;
      if (atBottom && deltaTouchY > 35) {
        transitionTo3DRef.current();
      }
    };
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });

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
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      if (downResetTimer) clearTimeout(downResetTimer);
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
    // Ensure transition callback is wired


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

  transitionTo3DRef.current = handleTransitionTo3D;



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

