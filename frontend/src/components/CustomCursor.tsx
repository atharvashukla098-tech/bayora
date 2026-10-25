import { useEffect, useRef, useState } from 'react';

export function CustomCursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    let mouseX = -100;
    let mouseY = -100;
    let ringX = -100;
    let ringY = -100;
    let hasMoved = false;

    let isHoveringCurrent = false;

    const onMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      if (!hasMoved) {
        hasMoved = true;
        ringX = mouseX;
        ringY = mouseY;
        setIsVisible(true);
      }

      // 60FPS OPTIMIZATION: Only dispatch React setState if hover state actually transitions
      const target = e.target;
      let shouldHover = false;
      if (target instanceof Element) {
        if (
          target.tagName === 'BUTTON' ||
          target.tagName === 'A' ||
          target.closest('button') ||
          target.closest('a') ||
          (target as HTMLElement).dataset?.hover
        ) {
          shouldHover = true;
        }
      }

      if (shouldHover !== isHoveringCurrent) {
        isHoveringCurrent = shouldHover;
        setIsHovering(shouldHover);
      }
    };

    const onMouseLeave = () => setIsVisible(false);
    const onMouseEnter = () => setIsVisible(true);

    window.addEventListener('mousemove', onMouseMove, { passive: true });
    document.addEventListener('mouseleave', onMouseLeave);
    document.addEventListener('mouseenter', onMouseEnter);

    let animId = 0;
    const update = () => {
      animId = requestAnimationFrame(update);
      // Buttery smooth lerp for outer ring
      ringX += (mouseX - ringX) * 0.22;
      ringY += (mouseY - ringY) * 0.22;

      // Direct hardware-accelerated transform with zero CSS transition delay
      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${mouseX}px, ${mouseY}px, 0)`;
      }
      if (ringRef.current) {
        ringRef.current.style.transform = `translate3d(${ringX}px, ${ringY}px, 0)`;
      }
    };
    animId = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseleave', onMouseLeave);
      document.removeEventListener('mouseenter', onMouseEnter);
    };
  }, []);

  return (
    <div
      className={`fixed inset-0 pointer-events-none z-50 overflow-hidden transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* Inner precise dot - ZERO CSS transition delay for instant 1:1 response */}
      <div
        ref={dotRef}
        className="fixed top-0 left-0 w-2 h-2 -ml-1 -mt-1 bg-white rounded-full mix-blend-difference pointer-events-none will-change-transform"
      />
      {/* Outer fluid ring - smooth lerp via RAF */}
      <div
        ref={ringRef}
        className={`fixed top-0 left-0 rounded-full border border-white/50 pointer-events-none mix-blend-difference will-change-transform transition-[width,height,margin,background-color,border-color] duration-200 ${
          isHovering
            ? 'w-12 h-12 -ml-6 -mt-6 bg-white/15 border-white scale-110'
            : 'w-7 h-7 -ml-3.5 -mt-3.5 bg-transparent'
        }`}
      />
    </div>
  );
}
