import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useAppleMusicPlayer } from '@/hooks/useAppleMusicPlayer';

interface MusicMarqueeLineProps {
  text: string;
  className: string;
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

const MusicMarqueeLine = memo(MusicMarqueeLineComponent);

function SidebarMusicPlayerComponent() {
  const { nowPlaying, isBusy, togglePlayback, nextTrack, previousTrack } = useAppleMusicPlayer(true);
  const [artworkFailed, setArtworkFailed] = useState(false);

  useEffect(() => {
    setArtworkFailed(false);
  }, [nowPlaying.artworkUrl]);

  const isPlaying = nowPlaying.state === 'playing';
  const title = nowPlaying.available ? nowPlaying.title : 'Nenhuma faixa em reprodução';
  const artist = nowPlaying.available
    ? nowPlaying.artist
    : nowPlaying.platformSupported
      ? 'Abra o Apple Music para controlar'
      : 'Disponível apenas no macOS';
  const showArtwork = Boolean(nowPlaying.artworkUrl) && !artworkFailed;

  return (
    <section className='sidebar-music-player app-button--enter' aria-label='Player Apple Music'>
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
      <div className='sidebar-music-player__controls'>
        <button
          type='button'
          className='sidebar-music-player__control app-button app-button--enter'
          aria-label='Faixa anterior'
          title='Faixa anterior'
          disabled={!nowPlaying.platformSupported || isBusy}
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
          disabled={!nowPlaying.platformSupported || isBusy}
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
          disabled={!nowPlaying.platformSupported || isBusy}
          onClick={() => {
            void nextTrack();
          }}
        >
          <SkipForward size={16} strokeWidth={2} />
        </button>
      </div>
    </section>
  );
}

export const SidebarMusicPlayer = memo(SidebarMusicPlayerComponent);
