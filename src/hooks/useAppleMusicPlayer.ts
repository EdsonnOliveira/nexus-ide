import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppleMusicNowPlaying } from '@/types';

const POLL_INTERVAL_MS = 1500;

const EMPTY_STATE: AppleMusicNowPlaying = {
  platformSupported: true,
  available: false,
  title: '',
  artist: '',
  state: 'stopped',
  artworkUrl: null,
};

export function useAppleMusicPlayer(enabled: boolean) {
  const [nowPlaying, setNowPlaying] = useState<AppleMusicNowPlaying>(EMPTY_STATE);
  const [isBusy, setIsBusy] = useState(false);
  const requestIdRef = useRef(0);

  const refreshNowPlaying = useCallback(async () => {
    if (!window.nexus?.music) {
      return EMPTY_STATE;
    }

    const snapshot = await window.nexus.music.getNowPlaying();
    setNowPlaying(snapshot);
    return snapshot;
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void refreshNowPlaying();

    const intervalId = window.setInterval(() => {
      void refreshNowPlaying();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, refreshNowPlaying]);

  const runControl = useCallback(
    async (action: () => Promise<void>) => {
      if (isBusy) {
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setIsBusy(true);

      try {
        await action();
        await refreshNowPlaying();
      } finally {
        if (requestIdRef.current === requestId) {
          setIsBusy(false);
        }
      }
    },
    [isBusy, refreshNowPlaying],
  );

  const togglePlayback = useCallback(async () => {
    await runControl(() => window.nexus.music.togglePlayback());
  }, [runControl]);

  const nextTrack = useCallback(async () => {
    await runControl(() => window.nexus.music.next());
  }, [runControl]);

  const previousTrack = useCallback(async () => {
    await runControl(() => window.nexus.music.previous());
  }, [runControl]);

  return {
    nowPlaying,
    isBusy,
    togglePlayback,
    nextTrack,
    previousTrack,
    refreshNowPlaying,
  };
}
