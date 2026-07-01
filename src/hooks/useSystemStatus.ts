import { useCallback, useEffect, useState } from 'react';
import type { SystemStatusSnapshot } from '@/types';

const DEFAULT_SNAPSHOT: SystemStatusSnapshot = {
  platformSupported: false,
  volume: 0,
  muted: false,
  batteryLevel: null,
  batteryCharging: false,
  batteryPresent: false,
  batteryTimeRemaining: null,
  wifiConnected: false,
  wifiNetwork: null,
};

const POLL_INTERVAL_MS = 15_000;

export function useSystemStatus(enabled: boolean): {
  snapshot: SystemStatusSnapshot;
  refresh: () => void;
} {
  const [snapshot, setSnapshot] = useState<SystemStatusSnapshot>(DEFAULT_SNAPSHOT);

  const refresh = useCallback(() => {
    void window.nexus.systemStatus.getSnapshot().then((nextSnapshot) => {
      setSnapshot(nextSnapshot);
    });
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    const loadSnapshot = () => {
      void window.nexus.systemStatus.getSnapshot().then((nextSnapshot) => {
        if (!cancelled) {
          setSnapshot(nextSnapshot);
        }
      });
    };

    loadSnapshot();
    const intervalId = window.setInterval(loadSnapshot, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [enabled]);

  return { snapshot, refresh };
}
