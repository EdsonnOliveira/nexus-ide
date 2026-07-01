import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalendarEventsSnapshot } from '@/types';

const POLL_INTERVAL_MS = 60_000;

const EMPTY_SNAPSHOT: CalendarEventsSnapshot = {
  platformSupported: true,
  accessGranted: false,
  available: false,
  permissionDenied: false,
  events: [],
};

export function useAppleCalendarEvents(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<CalendarEventsSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled || !window.nexus?.calendar) {
      setHydrated(true);
      setSnapshot(EMPTY_SNAPSHOT);
      return EMPTY_SNAPSHOT;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);

    try {
      const nextSnapshot = await window.nexus.calendar.getTodayEvents();

      if (requestIdRef.current === requestId) {
        setSnapshot(nextSnapshot);
      }

      return nextSnapshot;
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
        setHydrated(true);
      }
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setHydrated(false);
      setSnapshot(EMPTY_SNAPSHOT);
      return;
    }

    setHydrated(false);
    void refresh();

    const intervalId = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, refresh]);

  const openEvent = useCallback(async (startAt: number) => {
    if (!window.nexus?.calendar) {
      return;
    }

    await window.nexus.calendar.openEvent(startAt);
  }, []);

  return {
    snapshot,
    loading,
    hydrated,
    refresh,
    openEvent,
  };
}
