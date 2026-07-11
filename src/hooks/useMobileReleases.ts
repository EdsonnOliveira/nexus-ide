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
    const refresh = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }

      setVisibleReleases(getVisibleReleases());
    };

    refresh();

    const intervalId = window.setInterval(refresh, 2000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        setVisibleReleases(getVisibleReleases());
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
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
