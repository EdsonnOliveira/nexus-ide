import { useEffect, useRef, useState } from 'react';

const DEFAULT_RELEASE_MS = 480;

export function useStableLoadingMap(
  rawMap: Map<string, boolean>,
  releaseMs = DEFAULT_RELEASE_MS,
): Map<string, boolean> {
  const [stableMap, setStableMap] = useState<Map<string, boolean>>(() => new Map(rawMap));
  const releaseTimersRef = useRef(new Map<string, number>());
  const rawMapRef = useRef(rawMap);
  const stableMapRef = useRef(stableMap);

  rawMapRef.current = rawMap;
  stableMapRef.current = stableMap;

  useEffect(() => {
    for (const [tabId, loading] of rawMap) {
      if (loading) {
        const timer = releaseTimersRef.current.get(tabId);

        if (timer !== undefined) {
          window.clearTimeout(timer);
          releaseTimersRef.current.delete(tabId);
        }

        if (!stableMapRef.current.get(tabId)) {
          setStableMap((previous) => {
            const next = new Map(previous);
            next.set(tabId, true);
            return next;
          });
        }

        continue;
      }

      if (stableMapRef.current.get(tabId) && !releaseTimersRef.current.has(tabId)) {
        releaseTimersRef.current.set(
          tabId,
          window.setTimeout(() => {
            releaseTimersRef.current.delete(tabId);

            if (!rawMapRef.current.get(tabId)) {
              setStableMap((previous) => {
                if (!previous.get(tabId)) {
                  return previous;
                }

                const next = new Map(previous);
                next.delete(tabId);
                return next;
              });
            }
          }, releaseMs),
        );
      }
    }

    for (const tabId of stableMapRef.current.keys()) {
      if (rawMap.has(tabId)) {
        continue;
      }

      const timer = releaseTimersRef.current.get(tabId);

      if (timer !== undefined) {
        window.clearTimeout(timer);
        releaseTimersRef.current.delete(tabId);
      }

      setStableMap((previous) => {
        if (!previous.has(tabId)) {
          return previous;
        }

        const next = new Map(previous);
        next.delete(tabId);
        return next;
      });
    }
  }, [rawMap, releaseMs]);

  useEffect(
    () => () => {
      for (const timer of releaseTimersRef.current.values()) {
        window.clearTimeout(timer);
      }

      releaseTimersRef.current.clear();
    },
    [],
  );

  return stableMap;
}
