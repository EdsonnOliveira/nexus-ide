import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Library,
  ListMusic,
  Music,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { useAppleMusicPlayer } from '@/hooks/useAppleMusicPlayer';

interface MusicMarqueeLineProps {
  text: string;
  className: string;
}

function formatMusicTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '0:00';
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function MusicMarqueeLineComponent({ text, className }: MusicMarqueeLineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [shouldScroll, setShouldScroll] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const textElement = textRef.current;

    if (!container || !textElement) {
      return;
    }

    const syncOverflow = () => {
      setShouldScroll(textElement.scrollWidth > container.clientWidth + 1);
    };

    syncOverflow();

    const resizeObserver = new ResizeObserver(syncOverflow);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [text]);

  const marqueeDuration = `${Math.max(text.length * 0.12, 4)}s`;

  return (
    <div ref={containerRef} className='sidebar-music-player__marquee'>
      <div
        className={`sidebar-music-player__marquee-track${shouldScroll ? ' sidebar-music-player__marquee-track--scroll' : ''}`}
        style={
          shouldScroll
            ? ({ '--sidebar-music-marquee-duration': marqueeDuration } as React.CSSProperties)
            : undefined
        }
      >
        <span ref={textRef} className={`${className}${shouldScroll ? ' sidebar-music-player__marquee-item' : ''}`} title={text}>
          {text}
        </span>
        {shouldScroll ? (
          <span className={`${className} sidebar-music-player__marquee-item`} aria-hidden='true'>
            {text}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export const MusicMarqueeLine = memo(MusicMarqueeLineComponent);

interface MusicProgressBarProps {
  position: number;
  duration: number;
  disabled: boolean;
  onSeek: (seconds: number) => void;
}

function MusicProgressBarComponent({ position, duration, disabled, onSeek }: MusicProgressBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const safeDuration = duration > 0 ? duration : 0;
  const ratio =
    dragRatio ?? (safeDuration > 0 ? Math.min(Math.max(position / safeDuration, 0), 1) : 0);
  const displayPosition = dragRatio !== null ? ratio * safeDuration : position;

  const resolveRatioFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current;

    if (!track || safeDuration <= 0) {
      return 0;
    }

    const rect = track.getBoundingClientRect();

    if (rect.width <= 0) {
      return 0;
    }

    return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
  }, [safeDuration]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || safeDuration <= 0) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsDragging(true);
      setDragRatio(resolveRatioFromClientX(event.clientX));
    },
    [disabled, resolveRatioFromClientX, safeDuration],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) {
        return;
      }

      setDragRatio(resolveRatioFromClientX(event.clientX));
    },
    [isDragging, resolveRatioFromClientX],
  );

  const finishDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) {
        return;
      }

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      const nextRatio = resolveRatioFromClientX(event.clientX);
      setDragRatio(null);
      setIsDragging(false);
      onSeek(nextRatio * safeDuration);
    },
    [isDragging, onSeek, resolveRatioFromClientX, safeDuration],
  );

  return (
    <div className='sidebar-music-player__timeline'>
      <span className='sidebar-music-player__time'>{formatMusicTime(displayPosition)}</span>
      <div
        ref={trackRef}
        className={`sidebar-music-player__progress${isDragging ? ' sidebar-music-player__progress--dragging' : ''}${disabled ? ' sidebar-music-player__progress--disabled' : ''}`}
        role='slider'
        aria-label='Posição da faixa'
        aria-valuemin={0}
        aria-valuemax={safeDuration}
        aria-valuenow={Math.round(position)}
        aria-disabled={disabled}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <div className='sidebar-music-player__progress-fill' style={{ width: `${ratio * 100}%` }} />
        <span
          className='sidebar-music-player__progress-thumb'
          style={{ left: `${ratio * 100}%` }}
          aria-hidden='true'
        />
      </div>
      <span className='sidebar-music-player__time'>{formatMusicTime(safeDuration)}</span>
    </div>
  );
}

const MusicProgressBar = memo(MusicProgressBarComponent);

interface MusicQueueCoverProps {
  artworkUrl: string | null;
}

function MusicQueueCoverComponent({ artworkUrl }: MusicQueueCoverProps) {
  const [failed, setFailed] = useState(false);
  const showArtwork = Boolean(artworkUrl) && !failed;

  useEffect(() => {
    setFailed(false);
  }, [artworkUrl]);

  if (showArtwork) {
    return (
      <img
        className='sidebar-music-player__queue-cover'
        src={artworkUrl ?? undefined}
        alt=''
        draggable={false}
        onError={() => {
          setFailed(true);
        }}
      />
    );
  }

  return (
    <div className='sidebar-music-player__queue-cover sidebar-music-player__queue-cover--placeholder' aria-hidden='true'>
      <Music size={10} strokeWidth={2} />
    </div>
  );
}

const MusicQueueCover = memo(MusicQueueCoverComponent);

interface MusicListSkeletonProps {
  rows?: number;
  variant?: 'queue' | 'playlist';
}

function MusicListSkeletonComponent({
  rows = 4,
  variant = 'queue',
}: MusicListSkeletonProps) {
  return (
    <ul className='sidebar-music-player__queue-list' aria-hidden='true'>
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className='sidebar-music-player__skeleton-row app-button--enter'>
          <span className='sidebar-music-player__skeleton-cover' />
          <span
            className={`sidebar-music-player__skeleton-lines${variant === 'playlist' ? ' sidebar-music-player__skeleton-lines--playlist' : ''}`}
          >
            <span className='sidebar-music-player__skeleton-line sidebar-music-player__skeleton-line--title' />
            {variant === 'queue' ? (
              <span className='sidebar-music-player__skeleton-line sidebar-music-player__skeleton-line--subtitle' />
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

const MusicListSkeleton = memo(MusicListSkeletonComponent);

function MusicNowPlayingSkeletonComponent() {
  return (
    <div className='sidebar-music-player__header sidebar-music-player__header--skeleton' aria-hidden='true'>
      <div className='sidebar-music-player__cover-wrap'>
        <div className='sidebar-music-player__skeleton-cover sidebar-music-player__skeleton-cover--now-playing' />
      </div>
      <div className='sidebar-music-player__meta'>
        <span className='sidebar-music-player__skeleton-line sidebar-music-player__skeleton-line--eyebrow' />
        <span className='sidebar-music-player__skeleton-line sidebar-music-player__skeleton-line--title' />
        <span className='sidebar-music-player__skeleton-line sidebar-music-player__skeleton-line--subtitle' />
      </div>
    </div>
  );
}

const MusicNowPlayingSkeleton = memo(MusicNowPlayingSkeletonComponent);

function SidebarMusicPlayerComponent() {
  const {
    nowPlaying,
    displayPosition,
    isBusy,
    togglePlayback,
    nextTrack,
    previousTrack,
    seek,
    cycleRepeat,
    toggleShuffle,
    playQueueTrack,
    playlists,
    playlistsLoading,
    queueLoading,
    nowPlayingLoading,
    loadPlaylists,
    playPlaylist,
  } = useAppleMusicPlayer(true);
  const [artworkFailed, setArtworkFailed] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [playlistsOpen, setPlaylistsOpen] = useState(false);
  const [playlistPending, setPlaylistPending] = useState(false);

  useEffect(() => {
    setArtworkFailed(false);
  }, [nowPlaying.artworkUrl]);

  const isPlaying = nowPlaying.state === 'playing';
  const title = nowPlaying.available ? nowPlaying.title : 'Nenhuma faixa em reprodução';
  const artist = nowPlaying.available
    ? nowPlaying.artist
    : !nowPlaying.platformSupported
      ? 'Disponível apenas no macOS'
      : !nowPlaying.musicReady
        ? 'Apple Music indisponível'
        : 'Selecione uma playlist para começar';
  const showArtwork = Boolean(nowPlaying.artworkUrl) && !artworkFailed;
  const controlsDisabled =
    !nowPlaying.platformSupported || !nowPlaying.musicReady || isBusy;
  const timelineDisabled = controlsDisabled || !nowPlaying.available || nowPlaying.durationSeconds <= 0;

  const repeatLabel = useMemo(() => {
    if (nowPlaying.repeatMode === 'one') {
      return 'Repetir faixa';
    }

    if (nowPlaying.repeatMode === 'all') {
      return 'Repetir playlist';
    }

    return 'Repetir desligado';
  }, [nowPlaying.repeatMode]);

  const handleSeek = useCallback(
    (seconds: number) => {
      void seek(seconds);
    },
    [seek],
  );

  const handlePlayQueueTrack = useCallback(
    (playlistIndex: number) => {
      void playQueueTrack(playlistIndex);
    },
    [playQueueTrack],
  );

  const handleToggleQueue = useCallback(() => {
    setQueueOpen((current) => {
      const next = !current;

      if (next) {
        setPlaylistsOpen(false);
      }

      return next;
    });
  }, []);

  const handleTogglePlaylists = useCallback(() => {
    setPlaylistsOpen((current) => {
      const next = !current;

      if (next) {
        setQueueOpen(false);
        void loadPlaylists();
      }

      return next;
    });
  }, [loadPlaylists]);

  const handlePlayPlaylist = useCallback(
    (playlistId: string) => {
      setPlaylistsOpen(false);
      setQueueOpen(true);
      setPlaylistPending(true);
      void playPlaylist(playlistId).finally(() => {
        setPlaylistPending(false);
      });
    },
    [playPlaylist],
  );

  const showNowPlayingSkeleton = nowPlayingLoading || playlistPending;

  const queueToggleLabel = queueOpen ? 'Ocultar próximas faixas' : 'Mostrar próximas faixas';
  const playlistsToggleLabel = playlistsOpen ? 'Ocultar playlists' : 'Mostrar playlists';

  return (
    <section className='sidebar-music-player app-button--enter' aria-label='Player Apple Music'>
      {showNowPlayingSkeleton ? (
        <MusicNowPlayingSkeleton />
      ) : (
        <div className='sidebar-music-player__header'>
          <div className='sidebar-music-player__cover-wrap'>
            {showArtwork ? (
              <img
                className='sidebar-music-player__cover'
                src={nowPlaying.artworkUrl ?? undefined}
                alt=''
                draggable={false}
                onError={() => {
                  setArtworkFailed(true);
                }}
              />
            ) : (
              <div className='sidebar-music-player__cover sidebar-music-player__cover--placeholder' aria-hidden='true'>
                <Music size={16} strokeWidth={2} />
              </div>
            )}
          </div>
          <div className='sidebar-music-player__meta'>
            <span className='sidebar-music-player__eyebrow'>Tocando agora</span>
            <MusicMarqueeLine text={title} className='sidebar-music-player__title' />
            <MusicMarqueeLine text={artist} className='sidebar-music-player__artist' />
          </div>
        </div>
      )}

      <MusicProgressBar
        position={displayPosition}
        duration={nowPlaying.durationSeconds}
        disabled={timelineDisabled}
        onSeek={handleSeek}
      />

      <div className='sidebar-music-player__controls'>
        <button
          type='button'
          className={`sidebar-music-player__control app-button app-button--enter${nowPlaying.shuffleEnabled ? ' sidebar-music-player__control--active app-button--enter' : ''}`}
          aria-label={nowPlaying.shuffleEnabled ? 'Desativar aleatório' : 'Ativar aleatório'}
          title={nowPlaying.shuffleEnabled ? 'Desativar aleatório' : 'Ativar aleatório'}
          disabled={controlsDisabled}
          onClick={() => {
            void toggleShuffle();
          }}
        >
          <Shuffle size={15} strokeWidth={2} />
        </button>
        <button
          type='button'
          className='sidebar-music-player__control app-button app-button--enter'
          aria-label='Faixa anterior'
          title='Faixa anterior'
          disabled={controlsDisabled}
          onClick={() => {
            void previousTrack();
          }}
        >
          <SkipBack size={16} strokeWidth={2} />
        </button>
        <button
          type='button'
          className='sidebar-music-player__control sidebar-music-player__control--primary app-button app-button--enter'
          aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
          title={isPlaying ? 'Pausar' : 'Reproduzir'}
          disabled={controlsDisabled}
          onClick={() => {
            void togglePlayback();
          }}
        >
          {isPlaying ? <Pause size={16} strokeWidth={2} /> : <Play size={16} strokeWidth={2} />}
        </button>
        <button
          type='button'
          className='sidebar-music-player__control app-button app-button--enter'
          aria-label='Próxima faixa'
          title='Próxima faixa'
          disabled={controlsDisabled}
          onClick={() => {
            void nextTrack();
          }}
        >
          <SkipForward size={16} strokeWidth={2} />
        </button>
        <button
          type='button'
          className={`sidebar-music-player__control app-button app-button--enter${nowPlaying.repeatMode !== 'off' ? ' sidebar-music-player__control--active app-button--enter' : ''}`}
          aria-label={repeatLabel}
          title={repeatLabel}
          disabled={controlsDisabled}
          onClick={() => {
            void cycleRepeat();
          }}
        >
          {nowPlaying.repeatMode === 'one' ? (
            <Repeat1 size={15} strokeWidth={2} />
          ) : (
            <Repeat size={15} strokeWidth={2} />
          )}
        </button>
      </div>

      <div className='sidebar-music-player__sections'>
        <button
          type='button'
          className={`sidebar-music-player__section-toggle app-button app-button--enter${queueOpen ? ' sidebar-music-player__section-toggle--active app-button--enter' : ''}`}
          aria-label={queueToggleLabel}
          aria-expanded={queueOpen}
          title={queueToggleLabel}
          onClick={handleToggleQueue}
        >
          <ListMusic size={13} strokeWidth={2} aria-hidden='true' />
          <span className='sidebar-music-player__section-toggle-label'>Próximas</span>
        </button>
        <button
          type='button'
          className={`sidebar-music-player__section-toggle app-button app-button--enter${playlistsOpen ? ' sidebar-music-player__section-toggle--active app-button--enter' : ''}`}
          aria-label={playlistsToggleLabel}
          aria-expanded={playlistsOpen}
          title={playlistsToggleLabel}
          disabled={controlsDisabled}
          onClick={handleTogglePlaylists}
        >
          <Library size={13} strokeWidth={2} aria-hidden='true' />
          <span className='sidebar-music-player__section-toggle-label'>Playlists</span>
        </button>
      </div>

      {queueOpen ? (
        <div className='sidebar-music-player__queue app-button--enter'>
          {queueLoading || playlistPending ? (
            <MusicListSkeleton rows={5} variant='queue' />
          ) : nowPlaying.upcoming.length > 0 ? (
            <ul className='sidebar-music-player__queue-list'>
              {nowPlaying.upcoming.map((track) => (
                <li key={`${track.playlistIndex}:${track.title}:${track.artist}`}>
                  <button
                    type='button'
                    className='sidebar-music-player__queue-item app-button app-button--enter'
                    title={`${track.title} — ${track.artist}`}
                    aria-label={`Tocar ${track.title}`}
                    disabled={controlsDisabled}
                    onClick={() => {
                      handlePlayQueueTrack(track.playlistIndex);
                    }}
                  >
                    <MusicQueueCover artworkUrl={track.artworkUrl} />
                    <span className='sidebar-music-player__queue-title'>{track.title}</span>
                    <span className='sidebar-music-player__queue-artist'>{track.artist}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className='sidebar-music-player__queue-empty'>Nenhuma faixa na fila</p>
          )}
        </div>
      ) : null}

      {playlistsOpen ? (
        <div className='sidebar-music-player__queue app-button--enter'>
          {playlistsLoading ? (
            <MusicListSkeleton rows={5} variant='playlist' />
          ) : playlists.length > 0 ? (
            <ul className='sidebar-music-player__queue-list'>
              {playlists.map((playlist) => (
                <li key={playlist.id}>
                  <button
                    type='button'
                    className='sidebar-music-player__playlist-item app-button app-button--enter'
                    title={playlist.name}
                    aria-label={`Tocar playlist ${playlist.name}`}
                    disabled={controlsDisabled}
                    onClick={() => {
                      handlePlayPlaylist(playlist.id);
                    }}
                  >
                    <MusicQueueCover artworkUrl={playlist.artworkUrl} />
                    <span className='sidebar-music-player__playlist-title'>{playlist.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className='sidebar-music-player__queue-empty'>Nenhuma playlist encontrada</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

export const SidebarMusicPlayer = memo(SidebarMusicPlayerComponent);
