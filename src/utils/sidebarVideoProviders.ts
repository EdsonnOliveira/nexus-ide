export type SidebarVideoProvider = 'youtube' | 'prime' | 'disney' | 'netflix';

export interface SidebarVideoSession {
  provider: SidebarVideoProvider;
  sourceUrl: string;
  playbackUrl: string;
  useEmbed: boolean;
  isLive?: boolean;
  title: string;
}

export interface PersistedSidebarVideoSession {
  sourceUrl: string;
  title: string;
  isLive?: boolean;
}

export const SIDEBAR_YOUTUBE_PARTITION = 'persist:nexus-sidebar-youtube';

export const SIDEBAR_VIDEO_PROVIDER_LABELS: Record<SidebarVideoProvider, string> = {
  youtube: 'YouTube',
  prime: 'Prime Video',
  disney: 'Disney+',
  netflix: 'Netflix',
};

const PROVIDER_HOSTS: Record<SidebarVideoProvider, readonly string[]> = {
  youtube: ['youtube.com', 'youtu.be', 'www.youtube.com', 'm.youtube.com'],
  prime: ['primevideo.com', 'www.primevideo.com', 'amazon.com', 'www.amazon.com', 'amazon.com.br', 'www.amazon.com.br'],
  disney: ['disneyplus.com', 'www.disneyplus.com'],
  netflix: ['netflix.com', 'www.netflix.com'],
};

function normalizeInputUrl(raw: string): URL | null {
  const trimmed = raw.trim();

  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

function matchesHost(hostname: string, hosts: readonly string[]): boolean {
  const normalized = hostname.toLowerCase();

  return hosts.some((host) => normalized === host || normalized.endsWith(`.${host}`));
}

export function detectSidebarVideoProvider(raw: string): SidebarVideoProvider | null {
  const url = normalizeInputUrl(raw);

  if (!url) {
    return null;
  }

  return detectProvider(url);
}

function detectProvider(url: URL): SidebarVideoProvider | null {
  if (matchesHost(url.hostname, PROVIDER_HOSTS.youtube)) {
    return 'youtube';
  }

  if (matchesHost(url.hostname, PROVIDER_HOSTS.prime)) {
    const path = url.pathname.toLowerCase();

    if (path.includes('/gp/video') || url.hostname.includes('primevideo')) {
      return 'prime';
    }

    return null;
  }

  if (matchesHost(url.hostname, PROVIDER_HOSTS.disney)) {
    return 'disney';
  }

  if (matchesHost(url.hostname, PROVIDER_HOSTS.netflix)) {
    return 'netflix';
  }

  return null;
}

export function extractYouTubeVideoId(raw: string | URL): string | null {
  const url = raw instanceof URL ? raw : normalizeInputUrl(raw);

  if (!url || !matchesHost(url.hostname, PROVIDER_HOSTS.youtube)) {
    return null;
  }

  if (url.hostname === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return id || null;
  }

  if (url.pathname.startsWith('/embed/')) {
    const id = url.pathname.slice('/embed/'.length).split('/')[0];
    return id || null;
  }

  if (url.pathname.startsWith('/shorts/')) {
    const id = url.pathname.slice('/shorts/'.length).split('/')[0];
    return id || null;
  }

  if (url.pathname.startsWith('/live/')) {
    const id = url.pathname.slice('/live/'.length).split('/')[0];
    return id || null;
  }

  const watchId = url.searchParams.get('v');

  if (watchId) {
    return watchId;
  }

  return null;
}

export function isYouTubeLiveUrl(raw: string | URL): boolean {
  const url = raw instanceof URL ? raw : normalizeInputUrl(raw);

  if (!url || !matchesHost(url.hostname, PROVIDER_HOSTS.youtube)) {
    return false;
  }

  if (url.pathname.startsWith('/live/')) {
    return true;
  }

  if (url.searchParams.get('feature') === 'live') {
    return true;
  }

  return false;
}

export function buildYouTubeWatchUrl(videoId: string, autoplay = true, mobile = false): string {
  const params = new URLSearchParams({
    v: videoId,
    autoplay: autoplay ? '1' : '0',
  });

  const host = mobile ? 'https://m.youtube.com/watch' : 'https://www.youtube.com/watch';

  return `${host}?${params.toString()}`;
}

function buildYouTubePlaybackUrl(videoId: string, autoplay = true, origin?: string): string {
  const params = new URLSearchParams({
    autoplay: autoplay ? '1' : '0',
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
    fs: '0',
    iv_load_policy: '3',
    enablejsapi: '1',
  });

  const embedOrigin = origin ?? getYouTubePipEmbedOrigin();

  params.set('origin', embedOrigin);
  params.set('widget_referrer', embedOrigin);

  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

export function getYouTubePipEmbedOrigin(): string {
  if (typeof window === 'undefined') {
    return 'https://www.youtube.com';
  }

  const origin = window.location.origin;

  if (origin.startsWith('http://') || origin.startsWith('https://')) {
    return origin;
  }

  return 'https://www.youtube.com';
}

export function buildYouTubePipRelayUrl(videoId: string, autoplay = true): string | null {
  const origin = getYouTubePipEmbedOrigin();

  if (!origin.startsWith('http://') && !origin.startsWith('https://')) {
    return null;
  }

  const params = new URLSearchParams({
    v: videoId,
    autoplay: autoplay ? '1' : '0',
  });

  return `${origin}/youtube-pip-relay.html?${params.toString()}`;
}

const YOUTUBE_PIP_CHROME_HIDE_SELECTORS = [
  'ytd-masthead',
  '#masthead',
  '#masthead-container',
  '#guide-wrapper',
  '#guide',
  'ytd-mini-guide-renderer',
  'ytd-miniplayer',
  'ytm-mobile-topbar-renderer',
  'ytm-mobile-topbar-header-renderer',
  'ytm-app-header-layout',
  'ytm-pivot-bar-renderer',
  'ytm-mobile-fixed-bottom-bar-renderer',
  'ytm-single-column-watch-next-results-renderer',
  'ytm-watch-metadata-actions',
  'ytm-comments-entry-point-teaser-renderer',
  'ytm-item-section-renderer',
  'ytm-reel-shelf-renderer',
  'ytm-compact-video-renderer',
  'ytm-promoted-sparkles-web-renderer',
  'ytm-engagement-panel',
  'ytm-popup-container',
  'ytm-navbar',
  '#header-bar',
  '#header',
  '.YTMobileTopbarHeader',
  '.ytm-app-header',
  '.mobile-topbar-sign-in-button',
  '.pivot-bar',
  '.related-chips-slot-wrapper',
  '.slim-owner-block',
  '.watch-below-the-player',
  '#secondary',
  '#related',
  '#comments',
  'ytd-watch-metadata',
  '#below',
  'ytd-browse',
  'ytd-live-chat-frame',
  '#chat-container',
  'yt-page-navigation-progress',
  '.ytp-cards-teaser',
  '.ytp-ce-element',
  '.ytp-endscreen-content',
  '.ytp-show-tiles',
  'header',
  'footer',
  'nav',
  '[role="banner"]',
  '[role="navigation"]',
] as const;

export const YOUTUBE_EMBED_PIP_CSS = `
  html,
  body {
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
    height: 100% !important;
    overflow: hidden !important;
    background: #000 !important;
  }

  .html5-video-player,
  #movie_player,
  #player,
  video,
  iframe {
    width: 100% !important;
    height: 100% !important;
    border: 0 !important;
  }
`;

export function buildYouTubeEmbedPipFitScript(): string {
  return `(function () {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.margin = '0';
    document.body.style.padding = '0';

    const iframe = document.querySelector('iframe');

    if (iframe instanceof HTMLElement) {
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = '0';
      return true;
    }

    const player =
      document.querySelector('.html5-video-player') ||
      document.querySelector('#movie_player') ||
      document.querySelector('video');

    if (player instanceof HTMLElement) {
      player.style.width = '100%';
      player.style.height = '100%';
    }

    const playButton = document.querySelector('.ytp-large-play-button');

    if (playButton instanceof HTMLElement) {
      playButton.click();
    }

    return true;
  })()`;
}

export const YOUTUBE_PIP_CHROME_HIDE_CSS = `
  ${YOUTUBE_PIP_CHROME_HIDE_SELECTORS.join(',\n  ')} {
    display: none !important;
    visibility: hidden !important;
    height: 0 !important;
    max-height: 0 !important;
    overflow: hidden !important;
    pointer-events: none !important;
  }

  html,
  body,
  ytm-app,
  ytm-watch,
  ytd-app,
  #content,
  #page-manager,
  ytd-watch-flexy,
  .player-container,
  #primary,
  #player-full-bleed,
  .html5-video-player,
  #player-container-id,
  #player,
  #movie_player {
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
    height: 100% !important;
    max-height: 100% !important;
    overflow: hidden !important;
    background: #000 !important;
  }

  #movie_player,
  .html5-video-player,
  #player-container-id,
  #player {
    position: fixed !important;
    inset: 0 !important;
    z-index: 2147483646 !important;
  }

  .html5-video-container,
  .video-stream,
  video,
  iframe,
  embed,
  object {
    width: 100% !important;
    height: 100% !important;
    object-fit: cover !important;
    border: 0 !important;
  }

  .html5-video-player:not(.nexus-pip-controls-visible) .ytp-chrome-bottom,
  .html5-video-player:not(.nexus-pip-controls-visible) .ytp-chrome-top,
  .html5-video-player:not(.nexus-pip-controls-visible) .ytp-gradient-bottom,
  .html5-video-player:not(.nexus-pip-controls-visible) .ytp-gradient-top,
  .html5-video-player:not(.nexus-pip-controls-visible) .ytp-progress-bar-container,
  .html5-video-player:not(.nexus-pip-controls-visible) .ytp-pause-overlay,
  .html5-video-player:not(.nexus-pip-controls-visible) .ytp-cued-thumbnail-overlay,
  .html5-video-player:not(.nexus-pip-controls-visible) .ytp-doubletap-ui,
  .html5-video-player:not(.nexus-pip-controls-visible) .ytp-youtube-button,
  #movie_player:not(.nexus-pip-controls-visible) .ytp-chrome-bottom,
  #movie_player:not(.nexus-pip-controls-visible) .ytp-chrome-top,
  #movie_player:not(.nexus-pip-controls-visible) .ytp-gradient-bottom,
  #movie_player:not(.nexus-pip-controls-visible) .ytp-gradient-top,
  #movie_player:not(.nexus-pip-controls-visible) .ytp-progress-bar-container,
  #movie_player:not(.nexus-pip-controls-visible) .ytp-pause-overlay,
  #movie_player:not(.nexus-pip-controls-visible) .ytp-cued-thumbnail-overlay,
  #movie_player:not(.nexus-pip-controls-visible) .ytp-doubletap-ui,
  #movie_player:not(.nexus-pip-controls-visible) .ytp-youtube-button {
    opacity: 0 !important;
    visibility: hidden !important;
    pointer-events: none !important;
    transition: opacity 0.18s ease !important;
  }

  .html5-video-player.ytp-playing:not(.ytp-buffering) .ytp-spinner,
  .html5-video-player.ytp-playing:not(.ytp-buffering) .ytp-spinner-container,
  #movie_player.ytp-playing:not(.ytp-buffering) .ytp-spinner,
  #movie_player.ytp-playing:not(.ytp-buffering) .ytp-spinner-container {
    opacity: 0 !important;
    visibility: hidden !important;
    pointer-events: none !important;
  }
`;

export function buildYouTubePipChromeHideScript(): string {
  const selectorsJson = JSON.stringify(YOUTUBE_PIP_CHROME_HIDE_SELECTORS);

  return `(function () {
    const SELECTORS = ${selectorsJson};

    function findPlayer() {
      return (
        document.querySelector('#movie_player') ||
        document.querySelector('.html5-video-player') ||
        document.querySelector('#player-container-id') ||
        document.querySelector('#player') ||
        document.querySelector('.player-container') ||
        document.querySelector('video')
      );
    }

    function hideNode(node) {
      if (!(node instanceof HTMLElement)) {
        return;
      }

      node.style.setProperty('display', 'none', 'important');
      node.style.setProperty('visibility', 'hidden', 'important');
      node.style.setProperty('height', '0', 'important');
      node.style.setProperty('max-height', '0', 'important');
      node.style.setProperty('overflow', 'hidden', 'important');
      node.style.setProperty('pointer-events', 'none', 'important');
    }

    function patchPageVisibility() {
      if (window.__nexusYoutubePipVisibilityPatched) {
        return;
      }

      window.__nexusYoutubePipVisibilityPatched = true;

      try {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: function () {
            return 'visible';
          },
        });
        Object.defineProperty(document, 'hidden', {
          configurable: true,
          get: function () {
            return false;
          },
        });
      } catch {
        // ignore
      }
    }

    function hideMasthead() {
      [
        'ytd-masthead',
        '#masthead',
        '#masthead-container',
        'ytm-mobile-topbar-renderer',
        'ytm-mobile-topbar-header-renderer',
        'ytm-app-header-layout',
        '#header-bar',
        '#header',
      ].forEach(function (selector) {
        document.querySelectorAll(selector).forEach(hideNode);
      });
    }

    function syncPlayerLayout() {
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const player = findPlayer();

      if (!(player instanceof HTMLElement)) {
        return false;
      }

      player.style.setProperty('position', 'fixed', 'important');
      player.style.setProperty('top', '0', 'important');
      player.style.setProperty('left', '0', 'important');
      player.style.setProperty('width', viewportWidth + 'px', 'important');
      player.style.setProperty('height', viewportHeight + 'px', 'important');
      player.style.setProperty('z-index', '2147483646', 'important');
      player.style.setProperty('margin', '0', 'important');
      player.style.setProperty('padding', '0', 'important');
      player.style.setProperty('background', '#000', 'important');

      const primary = document.querySelector('#primary');

      if (primary instanceof HTMLElement) {
        primary.style.setProperty('position', 'fixed', 'important');
        primary.style.setProperty('top', '0', 'important');
        primary.style.setProperty('left', '0', 'important');
        primary.style.setProperty('width', viewportWidth + 'px', 'important');
        primary.style.setProperty('height', viewportHeight + 'px', 'important');
        primary.style.setProperty('margin', '0', 'important');
        primary.style.setProperty('padding', '0', 'important');
        primary.style.setProperty('z-index', '2147483645', 'important');
      }

      player.querySelectorAll('video').forEach(function (video) {
        if (video instanceof HTMLVideoElement) {
          video.style.setProperty('width', '100%', 'important');
          video.style.setProperty('height', '100%', 'important');
          video.style.setProperty('object-fit', 'cover', 'important');
        }
      });

      return true;
    }

    function applyInitialPlayerLayout() {
      syncPlayerLayout();

      const player = findPlayer();

      if (!(player instanceof HTMLElement)) {
        return;
      }

      if (!window.__nexusYoutubePipLayoutApplied) {
        window.__nexusYoutubePipLayoutApplied = true;

        const video = player.querySelector('video');

        if (video instanceof HTMLVideoElement && video.paused) {
          const playButton = player.querySelector('.ytp-large-play-button');

          if (playButton instanceof HTMLElement) {
            playButton.click();
          }
        }
      }
    }

    function schedulePlayerLayoutRetry(attempt) {
      if (attempt > 40) {
        return;
      }

      window.setTimeout(function () {
        applyChromeHide();
        applyInitialPlayerLayout();

        if (!findPlayer()) {
          schedulePlayerLayoutRetry(attempt + 1);
        }
      }, 250);
    }

    function hideMobileWatchChrome() {
      const watch = document.querySelector('ytm-watch');

      if (!(watch instanceof HTMLElement)) {
        return;
      }

      Array.from(watch.children).forEach(function (child) {
        if (!(child instanceof HTMLElement)) {
          return;
        }

        if (!child.querySelector('.html5-video-player, video, #player, #movie_player')) {
          hideNode(child);
        }
      });
    }

    function hideDesktopWatchChrome() {
      const flexy = document.querySelector('ytd-watch-flexy');

      if (!(flexy instanceof HTMLElement)) {
        return;
      }

      Array.from(flexy.children).forEach(function (child) {
        if (!(child instanceof HTMLElement)) {
          return;
        }

        if (!child.querySelector('.html5-video-player, video, #movie_player, #player, .player-container')) {
          hideNode(child);
        }
      });
    }

    function hideAppShell() {
      ['ytm-app', 'ytd-app'].forEach(function (selector) {
        const app = document.querySelector(selector);

        if (!(app instanceof HTMLElement)) {
          return;
        }

        Array.from(app.children).forEach(function (child) {
          if (!(child instanceof HTMLElement)) {
            return;
          }

          if (!child.querySelector('.html5-video-player, video, #movie_player, #player, .player-container')) {
            hideNode(child);
          }
        });
      });
    }

    function setControlsVisible(visible) {
      const player = findPlayer();

      if (!(player instanceof HTMLElement)) {
        return;
      }

      if (visible) {
        player.classList.add('nexus-pip-controls-visible');
        player.classList.remove('ytp-autohide');
      } else {
        player.classList.remove('nexus-pip-controls-visible');
        player.classList.add('ytp-autohide');
      }
    }

    function syncPlayerControls() {
      const player = findPlayer();

      if (!(player instanceof HTMLElement)) {
        return;
      }

      const video = player.querySelector('video');

      if (video instanceof HTMLVideoElement && !video.paused && video.readyState >= 2) {
        player.querySelectorAll('.ytp-spinner, .ytp-spinner-container').forEach(function (node) {
          if (node instanceof HTMLElement) {
            node.style.setProperty('display', 'none', 'important');
          }
        });
      }

      if (!player.classList.contains('nexus-pip-controls-visible')) {
        player.classList.add('ytp-autohide');
      }
    }

    window.__nexusYoutubePipSetControlsVisible = function (visible) {
      setControlsVisible(visible);
      syncPlayerControls();
    };

    function applyChromeHide() {
      hideMasthead();

      SELECTORS.forEach(function (selector) {
        document.querySelectorAll(selector).forEach(hideNode);
      });

      hideAppShell();
      hideMobileWatchChrome();
      hideDesktopWatchChrome();
    }

    function applyHide() {
      patchPageVisibility();
      applyChromeHide();
      applyInitialPlayerLayout();
      syncPlayerControls();

      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      document.body.style.margin = '0';
      document.body.style.padding = '0';
    }

    window.__nexusYoutubePipFit = function () {
      syncPlayerLayout();
      syncPlayerControls();
    };

    if (!window.__nexusYoutubePipHideObserver) {
      window.__nexusYoutubePipHideObserver = true;
      applyHide();
      setControlsVisible(false);
      schedulePlayerLayoutRetry(0);

      var chromeHideTimer = null;

      new MutationObserver(function () {
        if (chromeHideTimer !== null) {
          clearTimeout(chromeHideTimer);
        }

        chromeHideTimer = setTimeout(function () {
          chromeHideTimer = null;
          applyChromeHide();
          applyInitialPlayerLayout();
          syncPlayerControls();
        }, 150);
      }).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    } else {
      applyHide();
      applyInitialPlayerLayout();
    }

    return true;
  })()`;
}

export function buildYouTubePipControlsVisibilityScript(visible: boolean): string {
  return `(function () {
    if (typeof window.__nexusYoutubePipSetControlsVisible === 'function') {
      window.__nexusYoutubePipSetControlsVisible(${visible ? 'true' : 'false'});
    }

    return true;
  })()`;
}

export function buildYouTubePipPlayerFitScript(): string {
  return `(function () {
    if (typeof window.__nexusYoutubePipFit === 'function') {
      window.__nexusYoutubePipFit();
    }

    return true;
  })()`;
}

export function buildYouTubePipLiveKeepAliveScript(): string {
  return `(function () {
    if (!window.__nexusYoutubePipVisibilityPatched) {
      window.__nexusYoutubePipVisibilityPatched = true;

      try {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: function () {
            return 'visible';
          },
        });
        Object.defineProperty(document, 'hidden', {
          configurable: true,
          get: function () {
            return false;
          },
        });
      } catch {
        // ignore
      }
    }

    const player =
      document.querySelector('#movie_player') || document.querySelector('.html5-video-player');

    if (!(player instanceof HTMLElement)) {
      return false;
    }

    const video = player.querySelector('video');

    if (!(video instanceof HTMLVideoElement) || video.ended) {
      return false;
    }

    const now = Date.now();
    const isBuffering =
      player.classList.contains('ytp-buffering') || video.readyState < 3;

    if (typeof window.__nexusYoutubeLiveSnapshot !== 'object') {
      window.__nexusYoutubeLiveSnapshot = {
        time: video.currentTime,
        at: now,
        lastProgressAt: now,
      };
    }

    const snapshot = window.__nexusYoutubeLiveSnapshot;

    if (Math.abs(video.currentTime - snapshot.time) > 0.25) {
      snapshot.time = video.currentTime;
      snapshot.at = now;
      snapshot.lastProgressAt = now;
    }

    const stalledForMs = now - snapshot.lastProgressAt;
    const shouldRecover = video.paused || isBuffering || stalledForMs > 15000;

    if (!shouldRecover) {
      return true;
    }

    if (video.paused) {
      video.play().catch(function () {});
    }

    const playButton = player.querySelector('.ytp-play-button, .ytp-large-play-button');

    if (playButton instanceof HTMLElement && (video.paused || isBuffering)) {
      playButton.click();
    }

    if (stalledForMs > 45000 && !video.paused) {
      snapshot.lastProgressAt = now;
      video.play().catch(function () {});
    }

    return true;
  })()`;
}

export function isYouTubeEmbedBlockedPageScript(): string {
  return `(function () {
    if (window.__nexusYoutubeEmbedBlocked) {
      return true;
    }

    if (window.__nexusYoutubeEmbedReady) {
      return false;
    }

    if (window.location.href.includes('youtube-pip-relay.html')) {
      return false;
    }

    if (
      document.querySelector('.html5-video-player, #movie_player, video, .ytp-large-play-button')
    ) {
      return false;
    }

    const text = document.body?.innerText ?? '';

    return (
      text.includes('Video unavailable') ||
      text.includes('This video is unavailable') ||
      text.includes('blocked it from display') ||
      text.includes('Error 152') ||
      text.includes('Error 153') ||
      text.includes('configuration error') ||
      text.includes('Watch video on YouTube') ||
      Boolean(document.querySelector('.ytp-error, .ytp-error-content-wrap'))
    );
  })()`;
}

export function isYouTubeWebviewEmbedUrl(url: string): boolean {
  return url.includes('/embed/') || url.includes('youtube-pip-relay.html');
}

export function resolveYouTubeWebviewPlaybackUrl(session: SidebarVideoSession): string {
  const videoId = extractYouTubeVideoId(session.sourceUrl);

  if (!videoId) {
    return session.playbackUrl;
  }

  if (session.isLive === true || session.useEmbed === false) {
    return resolveYouTubeWatchFallbackUrl(session);
  }

  const relayUrl = buildYouTubePipRelayUrl(videoId, true);

  if (relayUrl) {
    return relayUrl;
  }

  return resolveYouTubeWatchFallbackUrl(session);
}

export function resolveYouTubeWatchFallbackUrl(session: SidebarVideoSession): string {
  const videoId = extractYouTubeVideoId(session.sourceUrl);

  if (!videoId) {
    return session.playbackUrl;
  }

  return buildYouTubeWatchUrl(videoId, true, false);
}

export async function fetchSidebarVideoTitle(
  sourceUrl: string,
  provider: SidebarVideoProvider,
): Promise<string> {
  try {
    const response = await fetch(
      `https://noembed.com/embed?url=${encodeURIComponent(sourceUrl)}`,
    );

    if (response.ok) {
      const data = (await response.json()) as { title?: string };
      const title = data.title?.trim();

      if (title) {
        return title;
      }
    }
  } catch {
    // ignore
  }

  return SIDEBAR_VIDEO_PROVIDER_LABELS[provider];
}

export function restoreSidebarVideoSession(
  persisted: PersistedSidebarVideoSession,
): SidebarVideoSession | null {
  const session = parseSidebarVideoLink(persisted.sourceUrl, { autoplay: false });

  if (!session) {
    return null;
  }

  return {
    ...session,
    title: persisted.title,
    isLive: persisted.isLive ?? session.isLive,
    useEmbed: persisted.isLive ? false : session.useEmbed,
  };
}

export function toPersistedSidebarVideoSession(
  session: SidebarVideoSession,
): PersistedSidebarVideoSession {
  return {
    sourceUrl: session.sourceUrl,
    title: session.title,
    isLive: session.isLive,
  };
}

export function parseSidebarVideoLink(
  raw: string,
  options?: { autoplay?: boolean },
): SidebarVideoSession | null {
  const url = normalizeInputUrl(raw);

  if (!url) {
    return null;
  }

  const provider = detectProvider(url);

  if (!provider) {
    return null;
  }

  if (provider === 'youtube') {
    const videoId = extractYouTubeVideoId(url);

    if (!videoId) {
      return null;
    }

    const autoplay = options?.autoplay ?? true;
    const isLive = isYouTubeLiveUrl(url);
    const sourceUrl = buildYouTubeWatchUrl(videoId, false);

    return {
      provider,
      sourceUrl,
      playbackUrl: isLive
        ? buildYouTubeWatchUrl(videoId, autoplay)
        : buildYouTubePlaybackUrl(videoId, autoplay),
      useEmbed: !isLive,
      isLive,
      title: '',
    };
  }

  if (provider === 'prime') {
    const path = url.pathname.toLowerCase();

    if (!path.includes('/gp/video') && !url.hostname.includes('primevideo')) {
      return null;
    }
  }

  if (provider === 'netflix') {
    const path = url.pathname.toLowerCase();

    if (!path.includes('/watch') && !path.includes('/title')) {
      return null;
    }
  }

  return {
    provider,
    sourceUrl: url.toString(),
    playbackUrl: url.toString(),
    useEmbed: false,
    title: '',
  };
}
