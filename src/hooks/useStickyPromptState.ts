import { useEffect, useState, type RefObject } from 'react';

export function useStickyPromptState(
  sentinelRef: RefObject<HTMLDivElement | null>,
  scrollContainerRef: RefObject<HTMLDivElement | null>,
  watchKey: string,
): boolean {
  const [isStuck, setIsStuck] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollContainerRef.current;

    if (!sentinel || !root) {
      setIsStuck(false);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) {
          return;
        }

        setIsStuck(!entry.isIntersecting);
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

  return isStuck;
}
