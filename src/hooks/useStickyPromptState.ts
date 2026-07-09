import { useEffect, useRef, useState, type RefObject } from 'react';

export type StickyPromptMotionPhase = 'in' | 'out' | null;

const STICKY_PROMPT_IN_MS = 220;
const STICKY_PROMPT_OUT_MS = 180;
const STICKY_ENTER_OFFSET_PX = 10;
const STICKY_EXIT_OFFSET_PX = 42;
const STICKY_STATE_LOCK_MS = 320;

interface UseStickyPromptStateOptions {
  disabled?: boolean;
}

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
  options: UseStickyPromptStateOptions = {},
): { isStuck: boolean; phase: StickyPromptMotionPhase } {
  const disabled = options.disabled ?? false;
  const [rawStuck, setRawStuck] = useState(false);
  const [isStuck, setIsStuck] = useState(false);
  const [phase, setPhase] = useState<StickyPromptMotionPhase>(null);
  const isStuckRef = useRef(false);
  const rawStuckRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const lockUntilRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    isStuckRef.current = false;
    rawStuckRef.current = false;
    lockUntilRef.current = 0;
    setRawStuck(false);
    setIsStuck(false);
    setPhase(null);
  }, [watchKey]);

  useEffect(() => {
    if (!disabled) {
      return;
    }

    rawStuckRef.current = false;
    setRawStuck(false);
  }, [disabled]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollContainerRef.current;

    if (!sentinel || !root) {
      rawStuckRef.current = false;
      setRawStuck(false);
      return;
    }

    const evaluate = () => {
      if (disabled) {
        if (rawStuckRef.current) {
          rawStuckRef.current = false;
          setRawStuck(false);
        }

        return;
      }

      if (performance.now() < lockUntilRef.current) {
        return;
      }

      const rootRect = root.getBoundingClientRect();
      const sentinelRect = sentinel.getBoundingClientRect();
      const offsetTop = sentinelRect.top - rootRect.top;
      const previous = rawStuckRef.current;
      let next = previous;

      if (!previous && offsetTop < -STICKY_ENTER_OFFSET_PX) {
        next = true;
      } else if (previous && offsetTop > STICKY_EXIT_OFFSET_PX) {
        next = false;
      }

      if (next === previous) {
        return;
      }

      rawStuckRef.current = next;
      lockUntilRef.current = performance.now() + STICKY_STATE_LOCK_MS;
      setRawStuck(next);
    };

    const scheduleEvaluate = () => {
      if (rafRef.current !== null) {
        return;
      }

      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        evaluate();
      });
    };

    scheduleEvaluate();

    root.addEventListener('scroll', scheduleEvaluate, { passive: true });
    window.addEventListener('resize', scheduleEvaluate, { passive: true });

    const resizeObserver = new ResizeObserver(scheduleEvaluate);
    resizeObserver.observe(root);

    return () => {
      root.removeEventListener('scroll', scheduleEvaluate);
      window.removeEventListener('resize', scheduleEvaluate);
      resizeObserver.disconnect();

      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [disabled, scrollContainerRef, sentinelRef, watchKey]);

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
