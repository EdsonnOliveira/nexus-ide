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
const POLL_INTERVAL_LOW_BATTERY_MS = 3_000;

function resolvePollInterval(snapshot: SystemStatusSnapshot): number {
  if (
    snapshot.batteryPresent &&
    snapshot.batteryLevel !== null &&
    snapshot.batteryLevel <= 15 &&
    !snapshot.batteryCharging
  ) {
    return POLL_INTERVAL_LOW_BATTERY_MS;
  }

  return POLL_INTERVAL_MS;
}

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
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let currentInterval = 0;

    const scheduleNextPoll = (interval: number) => {
      if (intervalId !== null) {
        clearInterval(intervalId);
      }

      currentInterval = interval;
      intervalId = setInterval(loadSnapshot, interval);
    };

    const loadSnapshot = () => {
      void window.nexus.systemStatus.getSnapshot().then((nextSnapshot) => {
        if (cancelled) {
          return;
        }

        setSnapshot(nextSnapshot);

        const nextInterval = resolvePollInterval(nextSnapshot);

        if (nextInterval !== currentInterval) {
          scheduleNextPoll(nextInterval);
        }
      });
    };

    loadSnapshot();
    scheduleNextPoll(POLL_INTERVAL_MS);

    return () => {
      cancelled = true;

      if (intervalId !== null) {
        clearInterval(intervalId);
      }
    };
  }, [enabled]);

  return { snapshot, refresh };
}
