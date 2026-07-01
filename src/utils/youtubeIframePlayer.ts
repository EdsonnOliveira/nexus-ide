interface YouTubePlayerInstance {
  destroy: () => void;
}

interface YouTubePlayerErrorEvent {
  data: number;
}

interface YouTubePlayerOptions {
  videoId: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onError?: (event: YouTubePlayerErrorEvent) => void;
    onReady?: () => void;
  };
}

interface YouTubePlayerConstructor {
  new (elementId: string, options: YouTubePlayerOptions): YouTubePlayerInstance;
}

declare global {
  interface Window {
    YT?: {
      Player: YouTubePlayerConstructor;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeIframeApiPromise: Promise<void> | null = null;

function getYouTubeIframePlayerOrigin(): string {
  if (typeof window === 'undefined') {
    return 'https://www.youtube.com';
  }

  const origin = window.location.origin;

  if (origin.startsWith('http://') || origin.startsWith('https://')) {
    return origin;
  }

  return 'https://www.youtube.com';
}

export function loadYouTubeIframeApi(): Promise<void> {
  if (window.YT?.Player) {
    return Promise.resolve();
  }

  if (!youtubeIframeApiPromise) {
    youtubeIframeApiPromise = new Promise((resolve) => {
      const previousReady = window.onYouTubeIframeAPIReady;

      window.onYouTubeIframeAPIReady = () => {
        previousReady?.();
        resolve();
      };

      const existingScript = document.querySelector('script[data-nexus-youtube-iframe-api]');

      if (existingScript) {
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.dataset.nexusYoutubeIframeApi = 'true';
      document.head.appendChild(script);
    });
  }

  return youtubeIframeApiPromise;
}

export function createYouTubeEmbedPlayer(
  elementId: string,
  videoId: string,
  events: YouTubePlayerOptions['events'],
): YouTubePlayerInstance | null {
  if (!window.YT?.Player) {
    return null;
  }

  return new window.YT.Player(elementId, {
    videoId,
    playerVars: {
      autoplay: 1,
      rel: 0,
      modestbranding: 1,
      playsinline: 1,
      origin: getYouTubeIframePlayerOrigin(),
    },
    events,
  });
}

export function isYouTubeEmbedBlockedError(code: number): boolean {
  return code === 101 || code === 150 || code === 152;
}
