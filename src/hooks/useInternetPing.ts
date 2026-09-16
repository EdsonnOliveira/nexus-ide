import { useEffect, useState } from 'react';

const POLL_INTERVAL_MS = 3000;

export function useInternetPing(enabled: boolean): number | null {
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    let timeoutId = 0;

    const poll = async () => {
      try {
        const snapshot = await window.nexus.systemStatus.getInternetPing();

        if (!cancelled) {
          setLatencyMs(snapshot.latencyMs);
        }
      } catch {
        if (!cancelled) {
          setLatencyMs(null);
        }
      }

      if (!cancelled) {
        timeoutId = window.setTimeout(() => {
          void poll();
        }, POLL_INTERVAL_MS);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [enabled]);

  return latencyMs;
}
