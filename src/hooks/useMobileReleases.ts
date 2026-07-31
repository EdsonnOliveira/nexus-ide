import { useCallback, useEffect, useState } from 'react';
import { useMobileReleaseStore } from '@/stores/useMobileReleaseStore';
import type { MobileActiveRelease } from '@/types';

export function useMobileReleases() {
  const [visibleReleases, setVisibleReleases] = useState<MobileActiveRelease[]>([]);
  const releases = useMobileReleaseStore((state) => state.releases);
  const dismissedUids = useMobileReleaseStore((state) => state.dismissedUids);
  const dismiss = useMobileReleaseStore((state) => state.dismiss);
  const getVisibleReleases = useMobileReleaseStore((state) => state.getVisibleReleases);

  useEffect(() => {
    let timer: number | null = null;
    let cancelled = false;

    const refresh = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }

      setVisibleReleases(getVisibleReleases());
    };

    const schedule = () => {
      if (cancelled) {
        return;
      }

      if (timer !== null) {
        window.clearTimeout(timer);
      }

      const delayMs = document.visibilityState === 'hidden' ? 60_000 : 15_000;

      timer = window.setTimeout(() => {
        refresh();
        schedule();
      }, delayMs);
    };

    refresh();
    schedule();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh();
      }

      schedule();
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);

      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [getVisibleReleases, releases, dismissedUids]);

  const dismissRelease = useCallback(
    (uid: string) => {
      dismiss(uid);
      setVisibleReleases(getVisibleReleases());
    },
    [dismiss, getVisibleReleases],
  );

  return {
    visibleReleases,
    dismissRelease,
  };
}
