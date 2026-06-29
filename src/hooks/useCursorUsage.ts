import { useCallback, useEffect, useState } from 'react';
import type { CursorPeriodUsageSnapshot } from '@/types';

const POLL_INTERVAL_MS = 5 * 60 * 1000;

export function useCursorUsage(enabled: boolean): {
  usage: CursorPeriodUsageSnapshot | null;
  isLoading: boolean;
  refresh: (force?: boolean) => Promise<void>;
} {
  const [usage, setUsage] = useState<CursorPeriodUsageSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async (force = false) => {
    setIsLoading(true);

    try {
      const snapshot = await window.nexus.cursorUsage.getCurrentPeriod(force);
      setUsage(snapshot);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void refresh();

    const intervalId = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, refresh]);

  return { usage, isLoading, refresh };
}
