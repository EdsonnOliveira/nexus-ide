import { useEffect, useRef, useState, type RefObject } from 'react';

export type StickyPromptMotionPhase = 'in' | 'out' | null;

const STICKY_PROMPT_IN_MS = 220;
const STICKY_PROMPT_OUT_MS = 180;

function getStickyMotionDuration(phase: 'in' | 'out'): number {
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return 0;
  }

  return phase === 'in' ? STICKY_PROMPT_IN_MS : STICKY_PROMPT_OUT_MS;
}

export function useStickyPromptState(
  sentinelRef: RefObject<HTMLDivElement | null>,
  scrollContainerRef: RefObject<HTMLDivElement | null>,
  watchKey: string,
): { isStuck: boolean; phase: StickyPromptMotionPhase } {
  const [rawStuck, setRawStuck] = useState(false);
  const [isStuck, setIsStuck] = useState(false);
  const [phase, setPhase] = useState<StickyPromptMotionPhase>(null);
  const isStuckRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    isStuckRef.current = false;
    setRawStuck(false);
    setIsStuck(false);
    setPhase(null);
  }, [watchKey]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollContainerRef.current;

    if (!sentinel || !root) {
      setRawStuck(false);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) {
          return;
        }

        setRawStuck(!entry.isIntersecting);
      },
      {
        root,
        threshold: 0,
      },
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [scrollContainerRef, sentinelRef, watchKey]);

  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (rawStuck) {
      isStuckRef.current = true;
      setIsStuck(true);
      setPhase('in');
      timerRef.current = window.setTimeout(() => {
        setPhase(null);
        timerRef.current = null;
      }, getStickyMotionDuration('in'));

      return () => {
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
        }
      };
    }

    if (!isStuckRef.current) {
      return;
    }

    setPhase('out');
    timerRef.current = window.setTimeout(() => {
      isStuckRef.current = false;
      setIsStuck(false);
      setPhase(null);
      timerRef.current = null;
    }, getStickyMotionDuration('out'));

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [rawStuck]);

  return { isStuck, phase };
}
