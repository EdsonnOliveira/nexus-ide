import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WebviewTag } from 'electron';
import { ExternalLink, Mouse, Move, RotateCcw, TvMinimalPlay, X } from 'lucide-react';
import { EmptyState } from '@/components/overlay/EmptyState';
import { MusicMarqueeLine } from '@/components/sidebar/SidebarMusicPlayer';
import {
  SIDEBAR_VIDEO_PROVIDER_LABELS,
  SIDEBAR_YOUTUBE_PARTITION,
  YOUTUBE_PIP_CHROME_HIDE_CSS,
  YOUTUBE_EMBED_PIP_CSS,
  buildYouTubeEmbedPipFitScript,
  buildYouTubePipChromeHideScript,
  buildYouTubePipControlsVisibilityScript,
  buildYouTubePipLiveKeepAliveScript,
  buildYouTubePipPlayerFitScript,
  extractYouTubeVideoId,
  isYouTubeEmbedBlockedPageScript,
  isYouTubeWebviewEmbedUrl,
  resolveYouTubeWatchFallbackUrl,
  resolveYouTubeWebviewPlaybackUrl,
  type SidebarVideoSession,
} from '@/utils/sidebarVideoProviders';
import {
  createYouTubeEmbedPlayer,
  isYouTubeEmbedBlockedError,
  loadYouTubeIframeApi,
} from '@/utils/youtubeIframePlayer';

interface SidebarVideoPiPProps {
  session: SidebarVideoSession;
  onClose: () => void;
}

interface PiPPosition {
  x: number;
  y: number;
}

interface PiPSize {
  width: number;
  height: number;
}

interface DragOffset {
  x: number;
  y: number;
}

interface ResizeState {
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
}

const FLOATING_WIDTH = 320;
const MIN_WIDTH = 220;
const MIN_HEIGHT = 160;
const MAX_WIDTH_RATIO = 0.92;
const MAX_HEIGHT_RATIO = 0.88;
const WEBVIEW_LOADING_MAX_MS = 8_000;
const YOUTUBE_WEBVIEW_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MOUSE_FLEE_THRESHOLD = 96;
const MOUSE_FLEE_COOLDOWN_MS = 420;
const MOUSE_FLEE_MIN_MOVE = 48;
const VIEWPORT_EDGE_PADDING = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function distanceToRect(clientX: number, clientY: number, rect: DOMRect): number {
  const deltaX = Math.max(rect.left - clientX, 0, clientX - rect.right);
  const deltaY = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
  return Math.hypot(deltaX, deltaY);
}

function isMouseInHeaderSafeZone(clientX: number, clientY: number, headerRect: DOMRect): boolean {
  const safeLeft = headerRect.left - 16;
  const safeRight = headerRect.right + 16;
  const safeTop = headerRect.top - MOUSE_FLEE_THRESHOLD;
  const safeBottom = headerRect.bottom + 12;

  return (
    clientX >= safeLeft &&
    clientX <= safeRight &&
    clientY >= safeTop &&
    clientY <= safeBottom
  );
}

function resolvePiPCorners(width: number, height: number): PiPPosition[] {
  const maxX = Math.max(VIEWPORT_EDGE_PADDING, window.innerWidth - width - VIEWPORT_EDGE_PADDING);
  const maxY = Math.max(VIEWPORT_EDGE_PADDING, window.innerHeight - height - VIEWPORT_EDGE_PADDING);

  return [
    { x: VIEWPORT_EDGE_PADDING, y: VIEWPORT_EDGE_PADDING },
    { x: maxX, y: VIEWPORT_EDGE_PADDING },
    { x: VIEWPORT_EDGE_PADDING, y: maxY },
    { x: maxX, y: maxY },
  ];
}

function findNearestCornerIndex(currentX: number, currentY: number, corners: PiPPosition[]): number {
  return corners.reduce(
    (best, corner, index) => {
      const distance = Math.hypot(corner.x - currentX, corner.y - currentY);

      if (distance < best.distance) {
        return { index, distance };
      }

      return best;
    },
    { index: 0, distance: Number.POSITIVE_INFINITY },
  ).index;
}

function resolveFleeCorner(
  clientX: number,
  clientY: number,
  width: number,
  height: number,
  currentX: number,
  currentY: number,
): PiPPosition {
  const corners = resolvePiPCorners(width, height);
  const nearestCornerIndex = findNearestCornerIndex(currentX, currentY, corners);
  const fallbackIndex = (nearestCornerIndex + 2) % corners.length;

  return corners.reduce(
    (best, corner, index) => {
      if (index === nearestCornerIndex) {
        return best;
      }

      const centerX = corner.x + width / 2;
      const centerY = corner.y + height / 2;
      const distance = Math.hypot(clientX - centerX, clientY - centerY);

      if (distance > best.distance) {
        return { corner, distance };
      }

      return best;
    },
    { corner: corners[fallbackIndex], distance: -1 },
  ).corner;
}

function SidebarVideoPiPComponent({ session, onClose }: SidebarVideoPiPProps) {
  const pipRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const lastMouseFleeAtRef = useRef(0);
  const webviewLoadingTimerRef = useRef<number | null>(null);
  const youtubePlayerRef = useRef<{ destroy: () => void } | null>(null);
  const youtubePlayerMountIdRef = useRef(`sidebar-youtube-player-${crypto.randomUUID()}`);
  const dragOffsetRef = useRef<DragOffset | null>(null);
  const resizeStateRef = useRef<ResizeState | null>(null);
  const [isFloating, setIsFloating] = useState(false);
  const [position, setPosition] = useState<PiPPosition | null>(null);
  const [customSize, setCustomSize] = useState<PiPSize | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isMouseFleeEnabled, setIsMouseFleeEnabled] = useState(false);
  const [forceWebview, setForceWebview] = useState(
    session.provider === 'youtube' || !session.useEmbed || session.isLive === true,
  );
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [isSwitchingPlayback, setIsSwitchingPlayback] = useState(
    session.provider === 'youtube' || !session.useEmbed || session.isLive === true,
  );
  const [youtubeWebviewSrc, setYoutubeWebviewSrc] = useState(() =>
    session.provider === 'youtube' ? resolveYouTubeWebviewPlaybackUrl(session) : session.playbackUrl,
  );
  const providerLabel = SIDEBAR_VIDEO_PROVIDER_LABELS[session.provider];
  const isCustomized = isFloating || customSize !== null;
  const displayTitle = session.title.trim() || providerLabel;
  const youtubeVideoId = useMemo(
    () => (session.provider === 'youtube' ? extractYouTubeVideoId(session.sourceUrl) : null),
    [session.provider, session.sourceUrl],
  );
  const useWebview =
    session.provider === 'youtube' ? true : forceWebview || !session.useEmbed;
  const webviewPlaybackUrl =
    session.provider === 'youtube' ? youtubeWebviewSrc : session.playbackUrl;

  const switchToWebviewPlayback = useCallback(() => {
    youtubePlayerRef.current?.destroy();
    youtubePlayerRef.current = null;
    setForceWebview(true);
    setIsSwitchingPlayback(true);
    setPlaybackFailed(false);
    setYoutubeWebviewSrc(resolveYouTubeWebviewPlaybackUrl(session));
  }, [session]);

  const clearWebviewLoadingTimer = useCallback(() => {
    if (webviewLoadingTimerRef.current !== null) {
      window.clearTimeout(webviewLoadingTimerRef.current);
      webviewLoadingTimerRef.current = null;
    }
  }, []);

  const finishPlaybackLoading = useCallback(() => {
    clearWebviewLoadingTimer();
    setIsSwitchingPlayback(false);
  }, [clearWebviewLoadingTimer]);

  const handleOpenExternal = useCallback(() => {
    void window.nexus.tasks.openExternalUrl(session.sourceUrl);
  }, [session.sourceUrl]);

  const webviewRef = useRef<WebviewTag | null>(null);
  const youtubeCssInsertedRef = useRef(false);
  const youtubeFallbackAttemptedRef = useRef(false);

  const applyYouTubeEmbedFit = useCallback(async (webview: WebviewTag) => {
    try {
      if (!youtubeCssInsertedRef.current) {
        webview.insertCSS(YOUTUBE_EMBED_PIP_CSS);
        youtubeCssInsertedRef.current = true;
      }

      await webview.executeJavaScript(buildYouTubeEmbedPipFitScript());
    } catch {
      // ignore
    }
  }, []);

  const applyYouTubeWatchChromeHide = useCallback(async (webview: WebviewTag) => {
    try {
      if (!youtubeCssInsertedRef.current) {
        webview.insertCSS(YOUTUBE_PIP_CHROME_HIDE_CSS);
        youtubeCssInsertedRef.current = true;
      }

      await webview.executeJavaScript(buildYouTubePipChromeHideScript());
    } catch {
      // ignore
    }
  }, []);

  const syncYouTubeWebviewChrome = useCallback(
    async (webview: WebviewTag, url?: string) => {
      if (session.provider !== 'youtube') {
        return;
      }

      const currentUrl = url ?? webview.getURL();

      if (isYouTubeWebviewEmbedUrl(currentUrl)) {
        await applyYouTubeEmbedFit(webview);
        return;
      }

      await applyYouTubeWatchChromeHide(webview);
    },
    [applyYouTubeEmbedFit, applyYouTubeWatchChromeHide, session.provider],
  );

  const fitYouTubePlayer = useCallback(async () => {
    const webview = webviewRef.current;

    if (!webview || !useWebview || playbackFailed || session.provider !== 'youtube') {
      return;
    }

    if (isYouTubeWebviewEmbedUrl(webview.getURL())) {
      await applyYouTubeEmbedFit(webview);
      return;
    }

    try {
      await webview.executeJavaScript(buildYouTubePipPlayerFitScript());
    } catch {
      // ignore
    }
  }, [applyYouTubeEmbedFit, playbackFailed, session.provider, useWebview]);

  const setYouTubeControlsVisible = useCallback(
    async (visible: boolean) => {
      const webview = webviewRef.current;

      if (!webview || !useWebview || playbackFailed || session.provider !== 'youtube') {
        return;
      }

      try {
        await webview.executeJavaScript(buildYouTubePipControlsVisibilityScript(visible));
      } catch {
        // ignore
      }
    },
    [playbackFailed, session.provider, useWebview],
  );

  const handleViewportMouseEnter = useCallback(() => {
    void setYouTubeControlsVisible(true);
  }, [setYouTubeControlsVisible]);

  const handleViewportMouseLeave = useCallback(() => {
    void setYouTubeControlsVisible(false);
  }, [setYouTubeControlsVisible]);

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport || !useWebview || playbackFailed) {
      return;
    }

    const observer = new ResizeObserver(() => {
      void fitYouTubePlayer();
    });

    observer.observe(viewport);

    return () => {
      observer.disconnect();
    };
  }, [fitYouTubePlayer, playbackFailed, useWebview, webviewPlaybackUrl]);

  useEffect(() => {
    if (!isResizing) {
      void fitYouTubePlayer();
    }
  }, [customSize, fitYouTubePlayer, isFloating, isResizing]);

  useEffect(() => {
    const webview = webviewRef.current;

    if (!webview || !useWebview || playbackFailed) {
      return;
    }

    const handleDomReady = () => {
      void (async () => {
        try {
          if (session.provider !== 'youtube') {
            return;
          }

          const currentUrl = webview.getURL();
          const isRelayPage = currentUrl.includes('youtube-pip-relay.html');
          const isDirectEmbed = currentUrl.includes('/embed/');

          if (isRelayPage) {
            if (!youtubeFallbackAttemptedRef.current) {
              let embedReady = false;

              for (let attempt = 0; attempt < 6; attempt += 1) {
                await new Promise((resolve) => {
                  window.setTimeout(resolve, 1_000);
                });

                try {
                  const blocked = await webview.executeJavaScript(isYouTubeEmbedBlockedPageScript());

                  if (blocked) {
                    youtubeFallbackAttemptedRef.current = true;
                    setIsSwitchingPlayback(true);
                    youtubeCssInsertedRef.current = false;
                    webview.loadURL(resolveYouTubeWatchFallbackUrl(session));
                    return;
                  }

                  embedReady = await webview.executeJavaScript(
                    'window.__nexusYoutubeEmbedReady === true',
                  );

                  if (embedReady) {
                    break;
                  }
                } catch {
                  // ignore
                }
              }

              if (!embedReady) {
                youtubeFallbackAttemptedRef.current = true;
                setIsSwitchingPlayback(true);
                youtubeCssInsertedRef.current = false;
                webview.loadURL(resolveYouTubeWatchFallbackUrl(session));
                return;
              }
            }

            await syncYouTubeWebviewChrome(webview, currentUrl);
            return;
          }

          if (isDirectEmbed && !youtubeFallbackAttemptedRef.current) {
            await new Promise((resolve) => {
              window.setTimeout(resolve, 1_500);
            });

            try {
              const blocked = await webview.executeJavaScript(isYouTubeEmbedBlockedPageScript());

              if (blocked) {
                youtubeFallbackAttemptedRef.current = true;
                setIsSwitchingPlayback(true);
                youtubeCssInsertedRef.current = false;
                webview.loadURL(resolveYouTubeWatchFallbackUrl(session));
                return;
              }
            } catch {
              return;
            }
          }

          await syncYouTubeWebviewChrome(webview, currentUrl);
        } finally {
          finishPlaybackLoading();
        }
      })();
    };

    const handlePageUpdate = () => {
      void syncYouTubeWebviewChrome(webview);
      finishPlaybackLoading();
    };

    const handleFailLoad = (event: Electron.DidFailLoadEvent) => {
      if (!event.isMainFrame || event.errorCode === -3) {
        return;
      }

      clearWebviewLoadingTimer();
      setPlaybackFailed(true);
      setIsSwitchingPlayback(false);
    };

    const handleFinishLoad = () => {
      void syncYouTubeWebviewChrome(webview);
      finishPlaybackLoading();
    };

    const handleStopLoading = () => {
      void syncYouTubeWebviewChrome(webview);
      finishPlaybackLoading();
    };

    webview.addEventListener('dom-ready', handleDomReady);
    webview.addEventListener('did-fail-load', handleFailLoad);
    webview.addEventListener('did-finish-load', handleFinishLoad);
    webview.addEventListener('did-stop-loading', handleStopLoading);
    webview.addEventListener('did-navigate-in-page', handlePageUpdate);
    webview.addEventListener('did-navigate', handlePageUpdate);

    return () => {
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('did-fail-load', handleFailLoad);
      webview.removeEventListener('did-finish-load', handleFinishLoad);
      webview.removeEventListener('did-stop-loading', handleStopLoading);
      webview.removeEventListener('did-navigate-in-page', handlePageUpdate);
      webview.removeEventListener('did-navigate', handlePageUpdate);
    };
  }, [
    clearWebviewLoadingTimer,
    finishPlaybackLoading,
    playbackFailed,
    syncYouTubeWebviewChrome,
    useWebview,
    webviewPlaybackUrl,
    session,
  ]);

  useEffect(() => {
    if (!useWebview || playbackFailed || session.provider !== 'youtube' || session.isLive !== true) {
      return;
    }

    const runKeepAlive = () => {
      const webview = webviewRef.current;

      if (!webview) {
        return;
      }

      void webview.executeJavaScript(buildYouTubePipLiveKeepAliveScript()).catch(() => {
        // ignore
      });
    };

    runKeepAlive();

    const intervalId = window.setInterval(runKeepAlive, 20_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [playbackFailed, session.isLive, session.provider, useWebview, webviewPlaybackUrl]);

  useEffect(() => {
    youtubeCssInsertedRef.current = false;
    youtubeFallbackAttemptedRef.current = false;
  }, [webviewPlaybackUrl, session.sourceUrl]);

  useEffect(() => {
    if (!useWebview || playbackFailed) {
      clearWebviewLoadingTimer();
      return;
    }

    clearWebviewLoadingTimer();
    webviewLoadingTimerRef.current = window.setTimeout(() => {
      webviewLoadingTimerRef.current = null;
      setIsSwitchingPlayback(false);
    }, WEBVIEW_LOADING_MAX_MS);

    return clearWebviewLoadingTimer;
  }, [clearWebviewLoadingTimer, playbackFailed, useWebview, webviewPlaybackUrl]);

  useEffect(() => {
    setIsFloating(false);
    setPosition(null);
    setCustomSize(null);
    setIsDragging(false);
    setIsResizing(false);
    setIsMouseFleeEnabled(false);
    lastMouseFleeAtRef.current = 0;
    setForceWebview(session.provider === 'youtube' || !session.useEmbed || session.isLive === true);
    setPlaybackFailed(false);
    setIsSwitchingPlayback(
      session.provider === 'youtube' || !session.useEmbed || session.isLive === true,
    );
    youtubeFallbackAttemptedRef.current = false;
    youtubeCssInsertedRef.current = false;
    setYoutubeWebviewSrc(
      session.provider === 'youtube'
        ? resolveYouTubeWebviewPlaybackUrl(session)
        : session.playbackUrl,
    );
    dragOffsetRef.current = null;
    resizeStateRef.current = null;
    youtubePlayerRef.current?.destroy();
    youtubePlayerRef.current = null;
    clearWebviewLoadingTimer();
  }, [clearWebviewLoadingTimer, session.sourceUrl, session.useEmbed, session.isLive]);

  useEffect(() => {
    if (useWebview || playbackFailed || session.provider === 'youtube' || !youtubeVideoId) {
      youtubePlayerRef.current?.destroy();
      youtubePlayerRef.current = null;
      return;
    }

    let disposed = false;
    const mountId = youtubePlayerMountIdRef.current;

    void loadYouTubeIframeApi().then(() => {
      if (disposed || useWebview || playbackFailed) {
        return;
      }

      youtubePlayerRef.current?.destroy();
      youtubePlayerRef.current = createYouTubeEmbedPlayer(mountId, youtubeVideoId, {
        onReady: () => {
          if (!disposed) {
            finishPlaybackLoading();
          }
        },
        onError: (event) => {
          if (disposed) {
            return;
          }

          if (isYouTubeEmbedBlockedError(event.data)) {
            switchToWebviewPlayback();
            return;
          }

          setPlaybackFailed(true);
          finishPlaybackLoading();
        },
      });
    });

    return () => {
      disposed = true;
      youtubePlayerRef.current?.destroy();
      youtubePlayerRef.current = null;
    };
  }, [finishPlaybackLoading, playbackFailed, switchToWebviewPlayback, useWebview, youtubeVideoId]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleReset = useCallback(() => {
    setIsFloating(false);
    setPosition(null);
    setCustomSize(null);
    setIsDragging(false);
    setIsResizing(false);
    setIsMouseFleeEnabled(false);
    lastMouseFleeAtRef.current = 0;
    dragOffsetRef.current = null;
    resizeStateRef.current = null;
  }, []);

  const getCurrentRect = useCallback((): DOMRect | null => {
    return pipRef.current?.getBoundingClientRect() ?? null;
  }, []);

  const ensureFloatingAtCurrentRect = useCallback(() => {
    const rect = getCurrentRect();

    if (!rect) {
      return null;
    }

    if (!isFloating) {
      setPosition({ x: rect.left, y: rect.top });
      setCustomSize((current) => current ?? { width: rect.width, height: rect.height });
      setIsFloating(true);
    }

    return rect;
  }, [getCurrentRect, isFloating]);

  const handleToggleMouseFlee = useCallback(() => {
    setIsMouseFleeEnabled((current) => {
      const next = !current;

      if (next) {
        ensureFloatingAtCurrentRect();
      }

      return next;
    });
  }, [ensureFloatingAtCurrentRect]);

  const updateFloatingPosition = useCallback(
    (clientX: number, clientY: number) => {
      const offset = dragOffsetRef.current;
      const pip = pipRef.current;

      if (!offset || !pip) {
        return;
      }

      const width = pip.offsetWidth || customSize?.width || FLOATING_WIDTH;
      const height = pip.offsetHeight || customSize?.height || MIN_HEIGHT;

      setPosition({
        x: clamp(clientX - offset.x, 8, window.innerWidth - width - 8),
        y: clamp(clientY - offset.y, 8, window.innerHeight - height - 8),
      });
    },
    [customSize?.height, customSize?.width],
  );

  const handleMovePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();

      const rect = getCurrentRect();

      if (!rect) {
        return;
      }

      if (!isFloating) {
        setPosition({ x: rect.left, y: rect.top });
        setCustomSize((current) => current ?? { width: rect.width, height: rect.height });
        setIsFloating(true);
      }

      dragOffsetRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };

      setIsDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [getCurrentRect, isFloating],
  );

  const handleMovePointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!dragOffsetRef.current) {
        return;
      }

      updateFloatingPosition(event.clientX, event.clientY);
    },
    [updateFloatingPosition],
  );

  const handleMovePointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    dragOffsetRef.current = null;
    setIsDragging(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const rect = getCurrentRect();

      if (!rect) {
        return;
      }

      const shouldFloat = isFloating || Math.abs(event.movementX) > 0;

      if (!isFloating && event.pointerType !== 'touch') {
        const startWidth = rect.width;
        const startHeight = rect.height;

        resizeStateRef.current = {
          startX: event.clientX,
          startY: event.clientY,
          startWidth,
          startHeight,
        };
        setIsResizing(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }

      if (!isFloating) {
        setPosition({ x: rect.left, y: rect.top });
        setIsFloating(true);
      }

      resizeStateRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        startWidth: customSize?.width ?? rect.width,
        startHeight: customSize?.height ?? rect.height,
      };

      if (shouldFloat && !customSize) {
        setCustomSize({ width: rect.width, height: rect.height });
      }

      setIsResizing(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [customSize, getCurrentRect, isFloating],
  );

  const handleResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const state = resizeStateRef.current;

      if (!state) {
        return;
      }

      const deltaX = event.clientX - state.startX;
      const deltaY = event.clientY - state.startY;
      const maxWidth = window.innerWidth * MAX_WIDTH_RATIO;
      const maxHeight = window.innerHeight * MAX_HEIGHT_RATIO;

      if (isFloating) {
        const nextWidth = clamp(state.startWidth + deltaX, MIN_WIDTH, maxWidth);
        const nextHeight = clamp(state.startHeight + deltaY, MIN_HEIGHT, maxHeight);

        setCustomSize({ width: nextWidth, height: nextHeight });

        if (position) {
          setPosition({
            x: clamp(position.x, 8, window.innerWidth - nextWidth - 8),
            y: clamp(position.y, 8, window.innerHeight - nextHeight - 8),
          });
        }

        return;
      }

      const nextHeight = clamp(state.startHeight + deltaY, MIN_HEIGHT, maxHeight);

      if (Math.abs(deltaX) > 12) {
        const rect = getCurrentRect();

        if (rect) {
          setPosition({ x: rect.left, y: rect.top });
          setIsFloating(true);
          setCustomSize({
            width: clamp(state.startWidth + deltaX, MIN_WIDTH, maxWidth),
            height: nextHeight,
          });
          return;
        }
      }

      setCustomSize({
        width: state.startWidth,
        height: nextHeight,
      });
    },
    [getCurrentRect, isFloating, position],
  );

  const handleResizePointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    resizeStateRef.current = null;
    setIsResizing(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  useEffect(() => {
    if (!isMouseFleeEnabled || isDragging || isResizing) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const header = headerRef.current;
      const pip = pipRef.current;
      const viewport = viewportRef.current;

      if (!header || !pip || !viewport) {
        return;
      }

      const headerRect = header.getBoundingClientRect();

      if (isMouseInHeaderSafeZone(event.clientX, event.clientY, headerRect)) {
        return;
      }

      const viewportRect = viewport.getBoundingClientRect();
      const proximity = distanceToRect(event.clientX, event.clientY, viewportRect);

      if (proximity > MOUSE_FLEE_THRESHOLD) {
        return;
      }

      const now = Date.now();

      if (now - lastMouseFleeAtRef.current < MOUSE_FLEE_COOLDOWN_MS) {
        return;
      }

      const pipRect = pip.getBoundingClientRect();
      const width = pipRect.width;
      const height = pipRect.height;
      const currentX = isFloating && position ? position.x : pipRect.left;
      const currentY = isFloating && position ? position.y : pipRect.top;
      const nextCorner = resolveFleeCorner(
        event.clientX,
        event.clientY,
        width,
        height,
        currentX,
        currentY,
      );
      const moveDistance = Math.hypot(nextCorner.x - currentX, nextCorner.y - currentY);

      if (moveDistance < MOUSE_FLEE_MIN_MOVE) {
        return;
      }

      lastMouseFleeAtRef.current = now;

      if (!isFloating) {
        setCustomSize((current) => current ?? { width, height });
        setIsFloating(true);
      }

      setPosition(nextCorner);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [isDragging, isFloating, isMouseFleeEnabled, isResizing, position]);

  const pipStyle = useMemo(() => {
    if (isFloating && position) {
      return {
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${customSize?.width ?? FLOATING_WIDTH}px`,
        height: `${customSize?.height ?? MIN_HEIGHT}px`,
      };
    }

    if (customSize) {
      return {
        height: `${customSize.height}px`,
      };
    }

    return undefined;
  }, [customSize, isFloating, position]);

  const renderLoadingOverlay = () =>
    isSwitchingPlayback ? (
      <div className='sidebar-video-pip__loading sidebar-video-pip__loading--overlay' role='status' aria-live='polite'>
        <span className='sidebar-video-pip__loading-spinner' aria-hidden='true' />
        <span className='sidebar-video-pip__loading-label'>Carregando vídeo...</span>
      </div>
    ) : null;

  const renderViewport = () => {
    if (playbackFailed) {
      return (
        <EmptyState
          icon={TvMinimalPlay}
          title='Não foi possível reproduzir'
          message='Este conteúdo pode estar bloqueado para exibição no app.'
          compact
          className='sidebar-video-pip__fallback'
        >
          <button
            type='button'
            className='empty-state__action empty-state__action--primary app-button app-button--enter sidebar-video-pip__fallback-action'
            onClick={handleOpenExternal}
          >
            <ExternalLink size={14} strokeWidth={2} />
            <span className='app-button__label'>Abrir no YouTube</span>
          </button>
        </EmptyState>
      );
    }

    if (useWebview) {
      return (
        <>
          <webview
            key={session.sourceUrl}
            ref={webviewRef}
            className='sidebar-video-pip__frame'
            src={webviewPlaybackUrl}
            {...(session.provider === 'youtube'
              ? {
                  partition: SIDEBAR_YOUTUBE_PARTITION,
                  useragent: YOUTUBE_WEBVIEW_USER_AGENT,
                  httpreferrer: 'https://www.youtube.com/',
                }
              : {})}
            allowpopups
            webpreferences='contextIsolation=yes,javascript=yes,sandbox=no,backgroundThrottling=no'
          />
          {renderLoadingOverlay()}
        </>
      );
    }

    return (
      <>
        <div
          id={youtubePlayerMountIdRef.current}
          className='sidebar-video-pip__frame sidebar-video-pip__frame--youtube-player'
          title={displayTitle}
        />
        {renderLoadingOverlay()}
      </>
    );
  };

  const pipNode = (
    <section
      ref={pipRef}
      className={`sidebar-video-pip app-button--enter${isFloating ? ' sidebar-video-pip--portaled sidebar-video-pip--floating' : ''}${customSize ? ' sidebar-video-pip--custom-size' : ''}${isDragging ? ' sidebar-video-pip--dragging' : ''}${isResizing ? ' sidebar-video-pip--resizing' : ''}${isMouseFleeEnabled ? ' sidebar-video-pip--mouse-flee' : ''}`}
      style={pipStyle}
      aria-label={`PiP ${providerLabel}`}
    >
      <div className='sidebar-video-pip__header' ref={headerRef}>
        <div className='sidebar-video-pip__meta'>
          <span className='sidebar-video-pip__eyebrow'>Rodando agora</span>
          <MusicMarqueeLine text={displayTitle} className='sidebar-video-pip__title' />
        </div>
        <div className='sidebar-video-pip__actions'>
          {isCustomized ? (
            <button
              type='button'
              className='sidebar-video-pip__action app-button app-button--enter'
              aria-label='Voltar para posição padrão'
              title='Voltar para posição padrão'
              onClick={handleReset}
            >
              <RotateCcw size={14} strokeWidth={2} />
            </button>
          ) : null}
          <button
            type='button'
            className={`sidebar-video-pip__action sidebar-video-pip__mouse-flee app-button app-button--enter${isMouseFleeEnabled ? ' sidebar-video-pip__action--active app-button--enter' : ''}`}
            aria-label={isMouseFleeEnabled ? 'Desativar fugir do mouse' : 'Ativar fugir do mouse'}
            title={isMouseFleeEnabled ? 'Desativar fugir do mouse' : 'Ativar fugir do mouse'}
            aria-pressed={isMouseFleeEnabled}
            onClick={handleToggleMouseFlee}
          >
            <Mouse size={14} strokeWidth={2} />
          </button>
          <button
            type='button'
            className={`sidebar-video-pip__action sidebar-video-pip__move app-button app-button--enter${isDragging ? ' sidebar-video-pip__move--dragging' : ''}`}
            aria-label='Mover PiP'
            title='Mover PiP'
            onPointerDown={handleMovePointerDown}
            onPointerMove={handleMovePointerMove}
            onPointerUp={handleMovePointerUp}
            onPointerCancel={handleMovePointerUp}
          >
            <Move size={14} strokeWidth={2} />
          </button>
          <button
            type='button'
            className='sidebar-video-pip__action app-button app-button--enter'
            aria-label='Fechar PiP'
            title='Fechar PiP'
            onClick={handleClose}
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      </div>
      <div
        className='sidebar-video-pip__viewport'
        ref={viewportRef}
        onMouseEnter={handleViewportMouseEnter}
        onMouseLeave={handleViewportMouseLeave}
      >
        {renderViewport()}
      </div>
      <button
        type='button'
        className='sidebar-video-pip__resize app-button app-button--enter'
        aria-label='Redimensionar PiP'
        title='Redimensionar PiP'
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
        onPointerCancel={handleResizePointerUp}
      />
    </section>
  );

  if (isFloating) {
    return createPortal(pipNode, document.body);
  }

  return pipNode;
}

export const SidebarVideoPiP = memo(SidebarVideoPiPComponent);
