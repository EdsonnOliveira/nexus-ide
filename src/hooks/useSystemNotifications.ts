import { useCallback, useEffect, useState } from 'react';
import type { SystemNotificationsSnapshot } from '@/types';

const DEFAULT_SNAPSHOT: SystemNotificationsSnapshot = {
  platformSupported: false,
  accessGranted: false,
  fullDiskAccessAppName: null,
  fullDiskAccessAppPath: null,
  items: [],
};

const POLL_INTERVAL_MS = 30_000;

export function useSystemNotifications(enabled: boolean): {
  snapshot: SystemNotificationsSnapshot;
  loading: boolean;
  refresh: () => void;
} {
  const [snapshot, setSnapshot] = useState<SystemNotificationsSnapshot>(DEFAULT_SNAPSHOT);
  const [loading, setLoading] = useState(enabled);

  const refresh = useCallback(() => {
    void window.nexus.systemNotifications.list().then((nextSnapshot) => {
      setSnapshot(nextSnapshot);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    const loadSnapshot = () => {
      void window.nexus.systemNotifications.list().then((nextSnapshot) => {
        if (!cancelled) {
          setSnapshot(nextSnapshot);
          setLoading(false);
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

  return { snapshot, loading, refresh };
}
