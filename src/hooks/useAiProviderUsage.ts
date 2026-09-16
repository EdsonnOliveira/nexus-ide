import { useCallback, useEffect, useState } from 'react';
import type { AiProviderUsageSnapshot } from '@/types';

const POLL_INTERVAL_MS = 5 * 60 * 1000;

const EMPTY_SNAPSHOT: AiProviderUsageSnapshot = {
  items: [],
  updatedAt: 0,
};

export function useAiProviderUsage(enabled: boolean): {
  snapshot: AiProviderUsageSnapshot;
  isLoading: boolean;
  refresh: (force?: boolean) => Promise<void>;
} {
  const [snapshot, setSnapshot] = useState<AiProviderUsageSnapshot>(EMPTY_SNAPSHOT);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async (force = false) => {
    if (!window.nexus.aiUsage?.getSnapshot) {
      return;
    }

    setIsLoading(true);

    try {
      const nextSnapshot = await window.nexus.aiUsage.getSnapshot(force);
      setSnapshot(nextSnapshot);
    } catch {
      setSnapshot(EMPTY_SNAPSHOT);
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

  return { snapshot, isLoading, refresh };
}
