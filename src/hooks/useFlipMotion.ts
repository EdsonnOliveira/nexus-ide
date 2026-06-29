import { useLayoutEffect, useRef, type RefObject } from 'react';

const FLIP_IN_MS = 220;
const FLIP_OUT_MS = 180;
const FLIP_EASE_IN = 'cubic-bezier(0.16, 1, 0.3, 1)';
const FLIP_EASE_OUT = 'cubic-bezier(0.4, 0, 0.2, 1)';

function getFlipDuration(active: boolean): number {
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return 0;
  }

  return active ? FLIP_IN_MS : FLIP_OUT_MS;
}

function getFlipEasing(active: boolean): string {
  return active ? FLIP_EASE_IN : FLIP_EASE_OUT;
}

function clearFlipStyles(element: HTMLElement): void {
  element.style.removeProperty('transition');
  element.style.removeProperty('transform');
}

export function useFlipMotion<T extends HTMLElement>(
  active: boolean,
  elementRef: RefObject<T | null>,
  enabled = true,
): void {
  const previousActiveRef = useRef(active);
  const lastRectRef = useRef<DOMRect | null>(null);
  const isAnimatingRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const element = elementRef.current;

    if (!element || !enabled) {
      previousActiveRef.current = active;
      return;
    }

    const previousActive = previousActiveRef.current;
    const lastRect = lastRectRef.current;
    const nextRect = element.getBoundingClientRect();

    const finishAnimation = () => {
      isAnimatingRef.current = false;
      cleanupRef.current = null;
      clearFlipStyles(element);
      lastRectRef.current = element.getBoundingClientRect();
    };

    if (previousActive !== active && lastRect) {
      const dx = lastRect.left - nextRect.left;
      const dy = lastRect.top - nextRect.top;

      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        cleanupRef.current?.();

        const duration = getFlipDuration(active);
        const easing = getFlipEasing(active);

        clearFlipStyles(element);

        if (duration === 0) {
          lastRectRef.current = element.getBoundingClientRect();
        } else {
          isAnimatingRef.current = true;
          element.style.transition = 'none';
          element.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;

          void element.offsetHeight;

          element.style.transition = `transform ${duration}ms ${easing}`;
          element.style.transform = 'translate3d(0, 0, 0)';

          const handleTransitionEnd = (event: TransitionEvent) => {
            if (event.propertyName !== 'transform' || event.target !== element) {
              return;
            }

            finishAnimation();
          };

          const timeoutId = window.setTimeout(finishAnimation, duration + 32);

          element.addEventListener('transitionend', handleTransitionEnd);

          cleanupRef.current = () => {
            window.clearTimeout(timeoutId);
            element.removeEventListener('transitionend', handleTransitionEnd);
            finishAnimation();
          };
        }
      } else if (!isAnimatingRef.current) {
        lastRectRef.current = nextRect;
      }
    } else if (!isAnimatingRef.current) {
      lastRectRef.current = nextRect;
    }

    previousActiveRef.current = active;

    return () => {
      cleanupRef.current?.();
    };
  }, [active, enabled, elementRef]);
}
