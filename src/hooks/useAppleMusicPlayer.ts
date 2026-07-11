import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppleMusicNowPlaying, AppleMusicPlaylist } from '@/types';

const POLL_INTERVAL_PLAYING_MS = 800;
const POLL_INTERVAL_IDLE_MS = 1500;

const EMPTY_STATE: AppleMusicNowPlaying = {
  platformSupported: true,
  musicReady: false,
  available: false,
  title: '',
  artist: '',
  state: 'stopped',
  artworkUrl: null,
  positionSeconds: 0,
  durationSeconds: 0,
  repeatMode: 'off',
  shuffleEnabled: false,
  upcoming: [],
};

export function useAppleMusicPlayer(enabled: boolean) {
  const [nowPlaying, setNowPlaying] = useState<AppleMusicNowPlaying>(EMPTY_STATE);
  const [playlists, setPlaylists] = useState<AppleMusicPlaylist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [nowPlayingHydrated, setNowPlayingHydrated] = useState(false);
  const [displayPosition, setDisplayPosition] = useState(0);
  const requestIdRef = useRef(0);
  const syncAnchorRef = useRef({ at: Date.now(), position: 0 });

  const refreshNowPlaying = useCallback(async () => {
    if (!window.nexus?.music) {
      setNowPlayingHydrated(true);
      return EMPTY_STATE;
    }

    try {
      const snapshot = await window.nexus.music.getNowPlaying();
      setNowPlaying(snapshot);
      syncAnchorRef.current = {
        at: Date.now(),
        position: snapshot.positionSeconds,
      };
      setDisplayPosition(snapshot.positionSeconds);
      return snapshot;
    } finally {
      setNowPlayingHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setNowPlayingHydrated(false);
      return;
    }

    setNowPlayingHydrated(false);
    void refreshNowPlaying();

    const pollMs =
      nowPlaying.state === 'playing' ? POLL_INTERVAL_PLAYING_MS : POLL_INTERVAL_IDLE_MS;

    const tick = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }

      void refreshNowPlaying();
    };

    const intervalId = window.setInterval(tick, pollMs);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refreshNowPlaying();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, nowPlaying.state, refreshNowPlaying]);

  useEffect(() => {
    if (nowPlaying.state !== 'playing' || nowPlaying.durationSeconds <= 0) {
      setDisplayPosition(nowPlaying.positionSeconds);
      return;
    }

    const tickId = window.setInterval(() => {
      const elapsed = (Date.now() - syncAnchorRef.current.at) / 1000;
      const nextPosition = Math.min(
        syncAnchorRef.current.position + elapsed,
        nowPlaying.durationSeconds,
      );
      setDisplayPosition(nextPosition);
    }, 200);

    return () => {
      window.clearInterval(tickId);
    };
  }, [
    nowPlaying.durationSeconds,
    nowPlaying.positionSeconds,
    nowPlaying.state,
  ]);

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

  const seek = useCallback(
    async (seconds: number) => {
      const clamped = Math.max(0, Math.min(seconds, nowPlaying.durationSeconds || seconds));
      setDisplayPosition(clamped);
      syncAnchorRef.current = { at: Date.now(), position: clamped };
      await runControl(() => window.nexus.music.seek(clamped));
    },
    [nowPlaying.durationSeconds, runControl],
  );

  const cycleRepeat = useCallback(async () => {
    await runControl(() => window.nexus.music.cycleRepeat());
  }, [runControl]);

  const toggleShuffle = useCallback(async () => {
    await runControl(() => window.nexus.music.toggleShuffle());
  }, [runControl]);

  const playQueueTrack = useCallback(
    async (playlistIndex: number) => {
      if (playlistIndex <= 0) {
        return;
      }

      await runControl(() => window.nexus.music.playQueueTrack(playlistIndex));
    },
    [runControl],
  );

  const loadPlaylists = useCallback(async () => {
    if (!window.nexus?.music) {
      return [];
    }

    setPlaylistsLoading(true);

    try {
      const nextPlaylists = await window.nexus.music.getPlaylists();
      setPlaylists(nextPlaylists);
      return nextPlaylists;
    } finally {
      setPlaylistsLoading(false);
    }
  }, []);

  const playPlaylist = useCallback(
    async (playlistId: string) => {
      if (!playlistId.trim()) {
        return;
      }

      setQueueLoading(true);

      try {
        await runControl(() => window.nexus.music.playPlaylist(playlistId));

        const deadline = Date.now() + 6000;

        while (Date.now() < deadline) {
          const snapshot = await refreshNowPlaying();

          if (
            snapshot.upcoming.length > 0 ||
            (snapshot.available && snapshot.title.trim().length > 0)
          ) {
            break;
          }

          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 400);
          });
        }
      } finally {
        setQueueLoading(false);
      }
    },
    [refreshNowPlaying, runControl],
  );

  const nowPlayingLoading =
    !nowPlayingHydrated || queueLoading || (isBusy && !nowPlaying.available);

  return {
    nowPlaying,
    playlists,
    playlistsLoading,
    queueLoading,
    nowPlayingLoading,
    displayPosition,
    isBusy,
    togglePlayback,
    nextTrack,
    previousTrack,
    seek,
    cycleRepeat,
    toggleShuffle,
    playQueueTrack,
    loadPlaylists,
    playPlaylist,
    refreshNowPlaying,
  };
}
