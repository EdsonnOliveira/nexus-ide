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
      setVisibleReleases(getVisibleReleases());
    };

    refresh();

    const intervalId = window.setInterval(refresh, 1000);

    return () => {
      window.clearInterval(intervalId);
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
