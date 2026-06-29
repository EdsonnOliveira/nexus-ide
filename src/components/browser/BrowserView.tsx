import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Camera, Check, ChevronLeft, ChevronRight, RotateCw, Smartphone, SquareTerminal, ZoomIn, ZoomOut } from 'lucide-react';
import type { WebviewTag } from 'electron';
import {
  BROWSER_DEVICE_PRESETS,
  DEFAULT_BROWSER_DEVICE_ID,
  type BrowserDevicePreset,
} from '@/constants/browserDevices';
import { BrowserDeviceMenu } from '@/components/browser/BrowserDeviceMenu';
import { BrowserCredentialBar } from '@/components/browser/BrowserCredentialBar';
import { useProjectTerminalUrlHints } from '@/hooks/useProjectTerminalUrlHints';
import { usePasswordAutofillStore } from '@/stores/usePasswordAutofillStore';
import { useProjectStore } from '@/stores/useProjectStore';
import type { PasswordInputFocusPayload, PasswordFieldAction } from '@/types/password';
import { PASSWORD_FOCUS_CONSOLE_PREFIX } from '@/types/password';
import { buildFillBrowserFieldByLabelScript, buildFillBrowserInputScript, buildResetBrowserFormFillStateScript } from '@/utils/fillBrowserInput';
import { fillBrowserFieldWithAction, waitForBrowserFieldAction } from '@/utils/browserKeyAction';
import { passwordBrowserUrlsMatch } from '@/utils/passwordBrowserUrl';
import { normalizeBrowserUrl } from '@/utils/browserUrl';
import { isBrowserReloadShortcut } from '@/utils/browserReloadShortcut';
import { getProjectBrowserPartition } from '@/utils/projectBrowserSession';
import { isOverlayBlockingTerminalHints } from '@/utils/overlayBlocking';
import { formatTerminalUrlLabel } from '@/utils/terminalUrlExtract';
import {
  isLocalDevUrl,
  isBrowserErrorPageUrl,
  isSameLocalDevTarget,
  isOfflineLoadError,
  probeSiteReachable,
  type BrowserSiteStatus,
} from '@/utils/browserSiteStatus';
import type { OverlayAnimationPhase } from '@/hooks/useAnimatedUnmount';

const BROWSER_MIN_ZOOM = 0.5;
const BROWSER_MAX_ZOOM = 3;
const BROWSER_ZOOM_STEP = 0.1;

function clampBrowserZoom(factor: number): number {
  return Math.min(BROWSER_MAX_ZOOM, Math.max(BROWSER_MIN_ZOOM, Number(factor.toFixed(2))));
}

function computeBrowserDeviceFrameScale(
  availableWidth: number,
  availableHeight: number,
  presetWidth: number,
  presetHeight: number,
): number {
  if (availableWidth <= 0 || availableHeight <= 0 || presetWidth <= 0 || presetHeight <= 0) {
    return 1;
  }

  const scale = Math.min(availableWidth / presetWidth, availableHeight / presetHeight, 1);

  return Number(scale.toFixed(3));
}

interface BrowserViewProps {
  projectId: string;
  url: string;
  isVisible: boolean;
  isRuntimeActive: boolean;
  isFocused: boolean;
  onUrlChange: (url: string) => void;
}

function BrowserViewComponent({
  projectId,
  url,
  isVisible,
  isRuntimeActive,
  isFocused,
  onUrlChange,
}: BrowserViewProps) {
  const webviewRef = useRef<WebviewTag | null>(null);
  const devtoolsWebviewRef = useRef<WebviewTag | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const deviceMenuButtonRef = useRef<HTMLButtonElement>(null);
  const requestDeviceMenuCloseRef = useRef<(() => void) | null>(null);
  const screenshotTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onUrlChangeRef = useRef(onUrlChange);
  const normalizedUrlRef = useRef('');
  const loadFailedRef = useRef(false);
  const pageReadyRef = useRef(false);
  const siteStatusRef = useRef<BrowserSiteStatus>('checking');
  const zoomFactorRef = useRef(1);
  const normalizedUrl = useMemo(() => normalizeBrowserUrl(url), [url]);
  const sessionPartition = useMemo(() => getProjectBrowserPartition(projectId), [projectId]);
  const [inputUrl, setInputUrl] = useState(normalizedUrl);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [devToolsOpen, setDevToolsOpen] = useState(false);
  const [devtoolsHostReady, setDevtoolsHostReady] = useState(false);
  const [devicePresetId, setDevicePresetId] = useState(DEFAULT_BROWSER_DEVICE_ID);
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const [deviceMenuAnchorRect, setDeviceMenuAnchorRect] = useState<DOMRect | null>(null);
  const [deviceMenuPhase, setDeviceMenuPhase] = useState<OverlayAnimationPhase>('in');
  const [isLoading, setIsLoading] = useState(false);
  const [siteStatus, setSiteStatus] = useState<BrowserSiteStatus>('checking');
  const [screenshotCopied, setScreenshotCopied] = useState(false);
  const [zoomFactor, setZoomFactor] = useState(1);
  const [deviceFrameScale, setDeviceFrameScale] = useState(1);
  const [guestPreloadPath, setGuestPreloadPath] = useState<string | null>(null);
  const [credentialPickerOpen, setCredentialPickerOpen] = useState(false);
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const activeCollectionId = usePasswordAutofillStore(
    (state) => state.activeByProject[projectId] ?? null,
  );
  const pendingBrowserFill = usePasswordAutofillStore((state) => state.pendingBrowserFill);
  const credentialPickerRequest = usePasswordAutofillStore(
    (state) => state.credentialPickerRequestByProject[projectId] ?? null,
  );
  const clearCredentialPickerRequest = usePasswordAutofillStore(
    (state) => state.clearCredentialPickerRequest,
  );
  const passwordCollections = useProjectStore(
    (state) => state.projects.find((item) => item.id === projectId)?.passwordCollections ?? [],
  );
  const activePasswordCollection = useMemo(
    () => passwordCollections.find((collection) => collection.id === activeCollectionId) ?? null,
    [activeCollectionId, passwordCollections],
  );
  const shouldShowTerminalUrlHints = isVisible && siteStatus !== 'online';
  const terminalUrlHints = useProjectTerminalUrlHints(shouldShowTerminalUrlHints, normalizedUrl);

  const applyZoomFactor = useCallback((factor: number) => {
    const webview = webviewRef.current;

    if (!webview) {
      return;
    }

    try {
      webview.setZoomFactor(factor);
    } catch {
      return;
    }
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoomFactor((current) => {
      const next = clampBrowserZoom(current + BROWSER_ZOOM_STEP);
      zoomFactorRef.current = next;
      applyZoomFactor(next);
      return next;
    });
  }, [applyZoomFactor]);

  const handleZoomOut = useCallback(() => {
    setZoomFactor((current) => {
      const next = clampBrowserZoom(current - BROWSER_ZOOM_STEP);
      zoomFactorRef.current = next;
      applyZoomFactor(next);
      return next;
    });
  }, [applyZoomFactor]);

  normalizedUrlRef.current = normalizedUrl;
  siteStatusRef.current = siteStatus;

  useEffect(() => {
    void window.nexus.passwords.getGuestPreloadPath().then((path) => {
      setGuestPreloadPath(path);
    });
  }, []);

  const runCollectionAutofill = useCallback(
    async (collectionId: string) => {
      const webview = webviewRef.current;
      const collection = passwordCollections.find((item) => item.id === collectionId);

      if (!webview || !collection) {
        return;
      }

      const values = await window.nexus.passwords.getValues(projectId, collectionId);
      const entries = collection.fields
        .map((field) => ({
          label: field.label,
          value: values[field.id] ?? '',
          action: field.action ?? 'none',
        }))
        .filter((entry) => entry.value);

      if (entries.length === 0) {
        return;
      }

      try {
        await webview.executeJavaScript(buildResetBrowserFormFillStateScript());

        for (const entry of entries) {
          const filled = await fillBrowserFieldWithAction(
            webview,
            buildFillBrowserFieldByLabelScript(entry.label, entry.value),
            entry.action,
          );

          if (!filled || entry.action === 'none') {
            continue;
          }

          await waitForBrowserFieldAction();
        }
      } catch {
        return;
      }
    },
    [passwordCollections, projectId],
  );

  useEffect(() => {
    if (
      !pendingBrowserFill ||
      pendingBrowserFill.projectId !== projectId ||
      siteStatus !== 'online' ||
      !passwordBrowserUrlsMatch(normalizedUrl, pendingBrowserFill.url)
    ) {
      return;
    }

    void runCollectionAutofill(pendingBrowserFill.collectionId).finally(() => {
      usePasswordAutofillStore.getState().clearPendingBrowserAutofill();
    });
  }, [normalizedUrl, pendingBrowserFill, projectId, runCollectionAutofill, siteStatus]);

  const handlePasswordInputFocus = useCallback(
    (_payload: PasswordInputFocusPayload | null | undefined) => {
      const autofillState = usePasswordAutofillStore.getState();
      const activeId = autofillState.activeByProject[projectId] ?? null;

      if (!activeId || !autofillState.isCredentialPickerArmed(projectId)) {
        return;
      }

      const collections =
        useProjectStore
          .getState()
          .projects.find((item) => item.id === projectId)?.passwordCollections ?? [];
      const collection = collections.find((item) => item.id === activeId);

      if (!collection) {
        return;
      }

      void window.nexus.passwords.getValues(projectId, activeId).then((values) => {
        setCredentialValues(values);
        setCredentialPickerOpen(true);
      });
    },
    [projectId],
  );

  useEffect(() => {
    if (!credentialPickerRequest) {
      return;
    }

    handlePasswordInputFocus(null);
    clearCredentialPickerRequest(projectId);
  }, [clearCredentialPickerRequest, credentialPickerRequest, handlePasswordInputFocus, projectId]);

  useEffect(() => {
    if (!activeCollectionId) {
      setCredentialPickerOpen(false);
      setCredentialValues({});
    }
  }, [activeCollectionId]);

  const tryRunPendingBrowserAutofill = useCallback(
    (loadedUrl: string) => {
      const pending = usePasswordAutofillStore.getState().pendingBrowserFill;

      if (
        !pending ||
        pending.projectId !== projectId ||
        !passwordBrowserUrlsMatch(loadedUrl, pending.url)
      ) {
        return;
      }

      void runCollectionAutofill(pending.collectionId).finally(() => {
        usePasswordAutofillStore.getState().clearPendingBrowserAutofill();
      });
    },
    [projectId, runCollectionAutofill],
  );

  const handleCredentialFieldSelect = useCallback(
    async (fieldId: string, value: string, action: PasswordFieldAction) => {
      const webview = webviewRef.current;

      if (!webview || !value) {
        return;
      }

      try {
        await fillBrowserFieldWithAction(
          webview,
          buildFillBrowserInputScript(value),
          action,
        );
      } catch {
        return;
      }
    },
    [],
  );

  const handleCredentialPickerClose = useCallback(() => {
    setCredentialPickerOpen(false);
    setCredentialValues({});
    const autofillStore = usePasswordAutofillStore.getState();
    autofillStore.dismissCredentialPicker(projectId);
    autofillStore.setActiveCollection(projectId, null);
  }, [projectId]);

  const applyLocalProbeResult = useCallback((reachable: boolean) => {
    if (reachable) {
      loadFailedRef.current = false;
      setSiteStatus('online');
      return;
    }

    setSiteStatus('offline');
  }, []);

  const markOnlineIfSameTarget = useCallback((loadedUrl: string) => {
    if (isBrowserErrorPageUrl(loadedUrl)) {
      if (isLocalDevUrl(normalizedUrlRef.current)) {
        loadFailedRef.current = true;
        pageReadyRef.current = false;
        applyLocalProbeResult(false);
      }
      return false;
    }

    if (
      isLocalDevUrl(normalizedUrlRef.current) &&
      isSameLocalDevTarget(loadedUrl, normalizedUrlRef.current)
    ) {
      loadFailedRef.current = false;
      pageReadyRef.current = true;
      setSiteStatus('online');
      return true;
    }

    return false;
  }, [applyLocalProbeResult]);

  const reloadWebviewForTarget = useCallback((targetUrl: string) => {
    const webview = webviewRef.current;

    if (!webview || !targetUrl) {
      return;
    }

    pageReadyRef.current = false;
    webview.loadURL(targetUrl);
  }, []);

  const shouldReloadWebview = useCallback(
    (targetUrl: string, options: { wasOffline: boolean; hadFailedLoad: boolean }) => {
      const webview = webviewRef.current;

      if (!webview) {
        return false;
      }

      if (options.wasOffline || options.hadFailedLoad || !pageReadyRef.current) {
        return true;
      }

      const currentUrl = webview.getURL();

      return isBrowserErrorPageUrl(currentUrl) || !isSameLocalDevTarget(currentUrl, targetUrl);
    },
    [],
  );

  const handleServerBecameReachable = useCallback(
    (targetUrl: string, previousStatus: BrowserSiteStatus) => {
      const hadFailedLoad = loadFailedRef.current;
      loadFailedRef.current = false;
      applyLocalProbeResult(true);

      if (
        shouldReloadWebview(targetUrl, {
          wasOffline: previousStatus === 'offline',
          hadFailedLoad,
        })
      ) {
        reloadWebviewForTarget(targetUrl);
      }
    },
    [applyLocalProbeResult, reloadWebviewForTarget, shouldReloadWebview],
  );

  const validateSiteStatus = useCallback(async (targetUrl: string) => {
    if (!targetUrl) {
      return;
    }

    if (isLocalDevUrl(targetUrl)) {
      const reachable = await probeSiteReachable(targetUrl);

      if (loadFailedRef.current && !reachable) {
        applyLocalProbeResult(false);
        return;
      }

      if (reachable) {
        loadFailedRef.current = false;
      }

      applyLocalProbeResult(reachable);
      return;
    }

    if (loadFailedRef.current) {
      return;
    }

    setSiteStatus('online');
  }, [applyLocalProbeResult]);

  const activeDevicePreset = useMemo(
    () =>
      BROWSER_DEVICE_PRESETS.find((preset) => preset.id === devicePresetId) ??
      BROWSER_DEVICE_PRESETS[0],
    [devicePresetId],
  );

  const siteStatusDetail = useMemo(() => {
    if (!normalizedUrl) {
      return null;
    }

    return `Não foi possível conectar a ${normalizedUrl}.`;
  }, [normalizedUrl]);

  const deviceFrameHostStyle = useMemo(() => {
    if (!activeDevicePreset.width || !activeDevicePreset.height) {
      return undefined;
    }

    return {
      width: `${activeDevicePreset.width * deviceFrameScale}px`,
      height: `${activeDevicePreset.height * deviceFrameScale}px`,
    } as const;
  }, [activeDevicePreset.height, activeDevicePreset.width, deviceFrameScale]);

  const deviceFrameStyle = useMemo(() => {
    if (!activeDevicePreset.width || !activeDevicePreset.height) {
      return undefined;
    }

    return {
      width: `${activeDevicePreset.width}px`,
      height: `${activeDevicePreset.height}px`,
      transform: `scale(${deviceFrameScale})`,
      transformOrigin: 'top left',
    } as const;
  }, [activeDevicePreset.height, activeDevicePreset.width, deviceFrameScale]);

  useEffect(() => {
    const presetWidth = activeDevicePreset.width;
    const presetHeight = activeDevicePreset.height;

    if (!presetWidth || !presetHeight) {
      setDeviceFrameScale(1);
      return;
    }

    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    const updateDeviceFrameScale = () => {
      const style = window.getComputedStyle(viewport);
      const paddingX = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
      const paddingY = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
      const availableWidth = viewport.clientWidth - paddingX;
      const availableHeight = viewport.clientHeight - paddingY;

      setDeviceFrameScale(
        computeBrowserDeviceFrameScale(
          availableWidth,
          availableHeight,
          presetWidth,
          presetHeight,
        ),
      );
    };

    const observer = new ResizeObserver(updateDeviceFrameScale);
    observer.observe(viewport);
    updateDeviceFrameScale();

    return () => observer.disconnect();
  }, [
    activeDevicePreset.height,
    activeDevicePreset.width,
    devToolsOpen,
    isVisible,
    siteStatus,
  ]);

  useEffect(() => {
    onUrlChangeRef.current = onUrlChange;
  }, [onUrlChange]);

  useEffect(() => {
    if (normalizedUrl) {
      setInputUrl(normalizedUrl);
      loadFailedRef.current = false;
      pageReadyRef.current = false;
      setSiteStatus('checking');
      setZoomFactor(1);
      zoomFactorRef.current = 1;
      applyZoomFactor(1);
    }
  }, [applyZoomFactor, normalizedUrl]);

  useEffect(() => {
    if (!normalizedUrl || !isRuntimeActive) {
      return;
    }

    if (!isLocalDevUrl(normalizedUrl)) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const reachable = await probeSiteReachable(normalizedUrl);

      if (cancelled) {
        return;
      }

      if (!reachable) {
        if (loadFailedRef.current || siteStatusRef.current === 'checking') {
          applyLocalProbeResult(false);
        }
        return;
      }

      handleServerBecameReachable(normalizedUrl, siteStatusRef.current);
    })();

    return () => {
      cancelled = true;
    };
  }, [applyLocalProbeResult, handleServerBecameReachable, isRuntimeActive, normalizedUrl]);

  const syncNavigationState = useCallback(() => {
    const webview = webviewRef.current;

    if (!webview) {
      return;
    }

    try {
      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
    } catch {
      setCanGoBack(false);
      setCanGoForward(false);
    }
  }, []);

  const navigateTo = useCallback((nextUrl: string) => {
    const webview = webviewRef.current;
    const normalized = normalizeBrowserUrl(nextUrl);

    if (!webview || !normalized) {
      return;
    }

    setSiteStatus('checking');
    loadFailedRef.current = false;
    pageReadyRef.current = false;
    setInputUrl(normalized);
    onUrlChangeRef.current(normalized);
    webview.loadURL(normalized);
  }, []);

  useEffect(() => {
    const webview = webviewRef.current;

    if (!webview) {
      return;
    }

    const handleDomReady = () => {
      applyZoomFactor(zoomFactorRef.current);
      syncNavigationState();
    };

    const handleDevToolsClosed = () => {
      setDevToolsOpen(false);
    };

    const handleNavigate = (event: Electron.DidNavigateEvent) => {
      loadFailedRef.current = false;
      setInputUrl(event.url);
      syncNavigationState();

      if (markOnlineIfSameTarget(event.url)) {
        return;
      }

      setSiteStatus('checking');
    };

    const handleNavigateInPage = (event: Electron.DidNavigateInPageEvent) => {
      setInputUrl(event.url);
      syncNavigationState();
    };

    const handleStartLoading = () => {
      setIsLoading(true);
      loadFailedRef.current = false;
      setSiteStatus((current) => (current === 'online' ? current : 'checking'));
    };

    const handleStopLoading = () => {
      setIsLoading(false);
      syncNavigationState();
    };

    const handleFinishLoad = () => {
      setIsLoading(false);
      syncNavigationState();

      const currentUrl = webview.getURL();

      if (markOnlineIfSameTarget(currentUrl)) {
        tryRunPendingBrowserAutofill(currentUrl);
        return;
      }

      void validateSiteStatus(normalizedUrlRef.current).then(() => {
        tryRunPendingBrowserAutofill(currentUrl || normalizedUrlRef.current);
      });
    };

    const handleIpcMessage = (event: Electron.IpcMessageEvent) => {
      if (event.channel !== 'password-input-focus') {
        return;
      }

      handlePasswordInputFocus(event.args[0] as PasswordInputFocusPayload | undefined);
    };

    const handleConsoleMessage = (event: Electron.ConsoleMessageEvent) => {
      if (!event.message.startsWith(PASSWORD_FOCUS_CONSOLE_PREFIX)) {
        return;
      }

      try {
        const payload = JSON.parse(
          event.message.slice(PASSWORD_FOCUS_CONSOLE_PREFIX.length),
        ) as PasswordInputFocusPayload;
        handlePasswordInputFocus(payload);
      } catch {
        return;
      }
    };

    const handleFailLoad = (event: Electron.DidFailLoadEvent) => {
      if (event.isMainFrame) {
        setIsLoading(false);
      }

      if (event.isMainFrame && event.errorCode !== -3) {
        loadFailedRef.current = true;
        pageReadyRef.current = false;
        const offline = isOfflineLoadError(event.errorCode);

        if (offline) {
          setSiteStatus('offline');
        } else {
          void validateSiteStatus(normalizedUrlRef.current);
        }
      }
    };

    webview.addEventListener('dom-ready', handleDomReady);
    webview.addEventListener('devtools-closed', handleDevToolsClosed);
    webview.addEventListener('did-navigate', handleNavigate);
    webview.addEventListener('did-navigate-in-page', handleNavigateInPage);
    webview.addEventListener('did-start-loading', handleStartLoading);
    webview.addEventListener('did-stop-loading', handleStopLoading);
    webview.addEventListener('did-finish-load', handleFinishLoad);
    webview.addEventListener('did-fail-load', handleFailLoad);
    webview.addEventListener('ipc-message', handleIpcMessage);
    webview.addEventListener('console-message', handleConsoleMessage);

    return () => {
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('devtools-closed', handleDevToolsClosed);
      webview.removeEventListener('did-navigate', handleNavigate);
      webview.removeEventListener('did-navigate-in-page', handleNavigateInPage);
      webview.removeEventListener('did-start-loading', handleStartLoading);
      webview.removeEventListener('did-stop-loading', handleStopLoading);
      webview.removeEventListener('did-finish-load', handleFinishLoad);
      webview.removeEventListener('did-fail-load', handleFailLoad);
      webview.removeEventListener('ipc-message', handleIpcMessage);
      webview.removeEventListener('console-message', handleConsoleMessage);
    };
  }, [
    applyLocalProbeResult,
    applyZoomFactor,
    handlePasswordInputFocus,
    markOnlineIfSameTarget,
    syncNavigationState,
    tryRunPendingBrowserAutofill,
    validateSiteStatus,
  ]);

  useEffect(() => {
    const devtoolsWebview = devtoolsWebviewRef.current;

    if (!devtoolsWebview) {
      return;
    }

    const handleDomReady = () => {
      setDevtoolsHostReady(true);
    };

    devtoolsWebview.addEventListener('dom-ready', handleDomReady);

    return () => {
      devtoolsWebview.removeEventListener('dom-ready', handleDomReady);
    };
  }, []);

  useEffect(() => {
    if (!isFocused) {
      return;
    }

    webviewRef.current?.focus();
  }, [isFocused]);

  const handleBack = useCallback(() => {
    webviewRef.current?.goBack();
  }, []);

  const handleForward = useCallback(() => {
    webviewRef.current?.goForward();
  }, []);

  const handleReload = useCallback(() => {
    loadFailedRef.current = false;
    pageReadyRef.current = false;
    setSiteStatus('checking');
    webviewRef.current?.reload();
  }, []);

  const isFocusedRef = useRef(isFocused);
  const isVisibleRef = useRef(isVisible);
  const handleReloadRef = useRef(handleReload);

  isFocusedRef.current = isFocused;
  isVisibleRef.current = isVisible;
  handleReloadRef.current = handleReload;

  useEffect(() => {
    if (!isRuntimeActive) {
      return;
    }

    const tryReload = () => {
      if (!isFocusedRef.current || !isVisibleRef.current || isOverlayBlockingTerminalHints()) {
        return;
      }

      handleReloadRef.current();
    };

    const unsubscribe = window.nexus.onBrowserReload(tryReload);

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isFocusedRef.current || !isVisibleRef.current || isOverlayBlockingTerminalHints()) {
        return;
      }

      if (!isBrowserReloadShortcut(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      handleReloadRef.current();
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      unsubscribe();
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [isRuntimeActive]);

  const handleInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setInputUrl(event.target.value);
  }, []);

  const handleInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Enter') {
        return;
      }

      event.preventDefault();
      navigateTo(inputUrl);
    },
    [inputUrl, navigateTo],
  );

  const handleRetry = useCallback(() => {
    if (!normalizedUrl) {
      return;
    }

    loadFailedRef.current = false;
    pageReadyRef.current = false;
    setSiteStatus('checking');
    webviewRef.current?.loadURL(normalizedUrl);
  }, [normalizedUrl]);

  useEffect(() => {
    if (!isRuntimeActive || !isLocalDevUrl(normalizedUrl)) {
      return;
    }

    let cancelled = false;

    const checkServer = async () => {
      const reachable = await probeSiteReachable(normalizedUrl);

      if (cancelled) {
        return;
      }

      const currentStatus = siteStatusRef.current;

      if ((currentStatus === 'offline' || currentStatus === 'checking') && reachable) {
        handleServerBecameReachable(normalizedUrl, currentStatus);
        return;
      }

      if (currentStatus === 'online' && reachable && !pageReadyRef.current) {
        reloadWebviewForTarget(normalizedUrl);
        return;
      }

      if (currentStatus === 'online' && !reachable) {
        loadFailedRef.current = true;
        pageReadyRef.current = false;
        applyLocalProbeResult(false);
      }
    };

    void checkServer();

    const intervalId = window.setInterval(() => {
      void checkServer();
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [applyLocalProbeResult, handleServerBecameReachable, isRuntimeActive, normalizedUrl, reloadWebviewForTarget]);

  useEffect(() => {
    return () => {
      if (screenshotTimeoutRef.current) {
        clearTimeout(screenshotTimeoutRef.current);
      }
    };
  }, []);

  const handleScreenshot = useCallback(() => {
    const webview = webviewRef.current;

    if (!webview || siteStatusRef.current !== 'online') {
      return;
    }

    void window.nexus.browser.captureScreenshot(webview.getWebContentsId()).then((copied) => {
      if (!copied) {
        return;
      }

      setScreenshotCopied(true);

      if (screenshotTimeoutRef.current) {
        clearTimeout(screenshotTimeoutRef.current);
      }

      screenshotTimeoutRef.current = setTimeout(() => {
        setScreenshotCopied(false);
        screenshotTimeoutRef.current = null;
      }, 2000);
    });
  }, []);

  const handleToggleDevTools = useCallback(() => {
    const webview = webviewRef.current;
    const devtoolsWebview = devtoolsWebviewRef.current;

    if (!webview || !devtoolsWebview || !devtoolsHostReady) {
      return;
    }

    if (devToolsOpen) {
      void window.nexus.browser.closeDevTools(webview.getWebContentsId());
      setDevToolsOpen(false);
      return;
    }

    void window.nexus.browser
      .openDevTools(webview.getWebContentsId(), devtoolsWebview.getWebContentsId())
      .then(() => {
        setDevToolsOpen(true);
      })
      .catch(() => {
        setDevToolsOpen(false);
      });
  }, [devToolsOpen, devtoolsHostReady]);

  const handleToggleDeviceMenu = useCallback(() => {
    if (deviceMenuOpen) {
      requestDeviceMenuCloseRef.current?.();
      return;
    }

    const rect = deviceMenuButtonRef.current?.getBoundingClientRect() ?? null;

    if (rect) {
      setDeviceMenuPhase('in');
      setDeviceMenuAnchorRect(rect);
      setDeviceMenuOpen(true);
    }
  }, [deviceMenuOpen]);

  const handleCloseDeviceMenu = useCallback(() => {
    setDeviceMenuOpen(false);
    setDeviceMenuAnchorRect(null);
    setDeviceMenuPhase('in');
  }, []);

  const handleRegisterDeviceMenuRequestClose = useCallback((requestClose: (() => void) | null) => {
    requestDeviceMenuCloseRef.current = requestClose;
  }, []);

  const handleDeviceMenuBackdropClose = useCallback(() => {
    requestDeviceMenuCloseRef.current?.();
  }, []);

  const handleSelectDevicePreset = useCallback(
    (preset: BrowserDevicePreset) => {
      setDevicePresetId(preset.id);
      setZoomFactor(1);
      zoomFactorRef.current = 1;
      applyZoomFactor(1);
    },
    [applyZoomFactor],
  );

  const handleTerminalUrlHintClick = useCallback(
    (hintUrl: string) => {
      onUrlChange(hintUrl);
      setInputUrl(hintUrl);
    },
    [onUrlChange],
  );

  return (
    <div
      className={`browser-panel${isVisible ? '' : ' browser-panel--hidden'}${deviceMenuOpen ? ' browser-panel--device-menu-open' : ''}`}
    >
      <div className='browser-panel__toolbar'>
        <button
          type='button'
          className='browser-panel__nav-btn'
          aria-label='Voltar'
          disabled={!canGoBack}
          onClick={handleBack}
        >
          <ChevronLeft size={16} strokeWidth={2.25} />
        </button>
        {canGoForward ? (
          <button
            type='button'
            className='browser-panel__nav-btn'
            aria-label='Avançar'
            onClick={handleForward}
          >
            <ChevronRight size={16} strokeWidth={2.25} />
          </button>
        ) : null}
        <button
          type='button'
          className={`browser-panel__nav-btn${isLoading ? ' browser-panel__nav-btn--loading' : ''}`}
          aria-label='Recarregar'
          aria-busy={isLoading}
          onClick={handleReload}
        >
          <RotateCw size={15} strokeWidth={2.25} />
        </button>
        <div className='browser-panel__url-bar'>
          <input
            type='text'
            className='browser-panel__url'
            value={inputUrl}
            spellCheck={false}
            autoComplete='off'
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
          />
          {terminalUrlHints.length > 0 ? (
            <div className='browser-panel__url-hints' role='listbox' aria-label='Links do terminal'>
              {terminalUrlHints.map((hintUrl) => (
                <button
                  key={hintUrl}
                  type='button'
                  className='browser-panel__url-hint app-button app-button--enter'
                  role='option'
                  title={hintUrl}
                  onClick={() => handleTerminalUrlHintClick(hintUrl)}
                >
                  {formatTerminalUrlLabel(hintUrl)}
                </button>
              ))}
            </div>
          ) : null}
          <div className='browser-panel__url-actions'>
            <button
              type='button'
              className={`browser-panel__url-action app-button app-button--enter${devToolsOpen ? ' browser-panel__url-action--active' : ''}`}
              aria-label='Console'
              title='Console'
              onClick={handleToggleDevTools}
            >
              <SquareTerminal size={14} strokeWidth={2} />
            </button>
            <div className='browser-panel__device-menu'>
              <button
                ref={deviceMenuButtonRef}
                type='button'
                className={`browser-panel__url-action app-button app-button--enter${devicePresetId !== DEFAULT_BROWSER_DEVICE_ID ? ' browser-panel__url-action--active' : ''}${deviceMenuOpen ? ' browser-panel__url-action--active' : ''}`}
                aria-label='Dispositivo'
                title='Dispositivo'
                aria-expanded={deviceMenuOpen}
                aria-haspopup='menu'
                onClick={handleToggleDeviceMenu}
              >
                <Smartphone size={14} strokeWidth={2} />
              </button>
              {deviceMenuOpen && deviceMenuAnchorRect ? (
                <BrowserDeviceMenu
                  anchorRect={deviceMenuAnchorRect}
                  anchorRef={deviceMenuButtonRef}
                  devicePresetId={devicePresetId}
                  onClose={handleCloseDeviceMenu}
                  onSelect={handleSelectDevicePreset}
                  onAnimationPhaseChange={setDeviceMenuPhase}
                  onRegisterRequestClose={handleRegisterDeviceMenuRequestClose}
                />
              ) : null}
            </div>
            <button
              type='button'
              className='browser-panel__url-action app-button app-button--enter'
              aria-label='Diminuir zoom'
              title='Diminuir zoom'
              disabled={zoomFactor <= BROWSER_MIN_ZOOM || siteStatus !== 'online'}
              onClick={handleZoomOut}
            >
              <ZoomOut size={14} strokeWidth={2} />
            </button>
            <button
              type='button'
              className='browser-panel__url-action app-button app-button--enter'
              aria-label='Aumentar zoom'
              title='Aumentar zoom'
              disabled={zoomFactor >= BROWSER_MAX_ZOOM || siteStatus !== 'online'}
              onClick={handleZoomIn}
            >
              <ZoomIn size={14} strokeWidth={2} />
            </button>
            <button
              type='button'
              className={`browser-panel__url-action app-button app-button--enter${screenshotCopied ? ' browser-panel__url-action--active' : ''}`}
              aria-label={
                screenshotCopied
                  ? 'Print copiado para a área de transferência'
                  : 'Copiar print para a área de transferência'
              }
              title={
                screenshotCopied
                  ? 'Print copiado para a área de transferência'
                  : 'Copiar print para a área de transferência'
              }
              disabled={siteStatus !== 'online'}
              onClick={handleScreenshot}
            >
              {screenshotCopied ? <Check size={14} strokeWidth={2} /> : <Camera size={14} strokeWidth={2} />}
            </button>
          </div>
        </div>
      </div>
      {activePasswordCollection && credentialPickerOpen ? (
        <BrowserCredentialBar
          collectionName={activePasswordCollection.name}
          fields={activePasswordCollection.fields}
          values={credentialValues}
          onClose={handleCredentialPickerClose}
          onSelectField={handleCredentialFieldSelect}
        />
      ) : null}
      <div
        className={`browser-panel__content browser-panel__viewport${devToolsOpen ? ' browser-panel__content--devtools-open' : ''}`}
      >
        {deviceMenuOpen && deviceMenuAnchorRect ? (
          <button
            type='button'
            className={`browser-panel__device-backdrop overlay-backdrop--${deviceMenuPhase} app-button app-button--enter`}
            aria-label='Fechar menu de dispositivo'
            onClick={handleDeviceMenuBackdropClose}
          />
        ) : null}
        <div className={`browser-panel__split browser-panel__split--${siteStatus}`}>
          <div
            ref={viewportRef}
            className={`browser-panel__split-page browser-panel__split-page--${siteStatus}`}
          >
            {siteStatus !== 'online' ? (
              <div className='browser-panel__site-state'>
                {siteStatus === 'checking' ? (
                  <>
                    <span className='browser-panel__site-status browser-panel__site-status--checking'>
                      <span className='browser-panel__site-status-dot' aria-hidden='true' />
                      Conectando ao servidor
                    </span>
                    <span className='browser-panel__site-state-detail'>
                      Aguardando resposta de {normalizedUrl || '…'}
                    </span>
                  </>
                ) : (
                  <>
                    <span className='browser-panel__site-status browser-panel__site-status--offline'>
                      <span className='browser-panel__site-status-dot' aria-hidden='true' />
                      Servidor offline
                    </span>
                    <span className='browser-panel__site-state-detail'>
                      {siteStatusDetail ??
                        'O servidor local não está respondendo. Execute o projeto no terminal.'}
                    </span>
                    <button type='button' className='browser-panel__retry' onClick={handleRetry}>
                      Tentar novamente
                    </button>
                  </>
                )}
              </div>
            ) : null}
            <div
              className={`browser-panel__device-frame-host${activeDevicePreset.width && activeDevicePreset.height ? '' : ' browser-panel__device-frame-host--responsive'}${siteStatus !== 'online' ? ' browser-panel__device-frame-host--hidden' : ''}`}
              style={deviceFrameHostStyle}
            >
              <div
                className={`browser-panel__device-frame${activeDevicePreset.width && activeDevicePreset.height ? ' browser-panel__device-frame--preset' : ''}${siteStatus !== 'online' ? ' browser-panel__device-frame--hidden' : ''}`}
                style={deviceFrameStyle}
              >
                {guestPreloadPath ? (
                  <webview
                    key={`${sessionPartition}:${guestPreloadPath}`}
                    ref={webviewRef}
                    className='browser-panel__webview'
                    src={normalizedUrl || undefined}
                    partition={sessionPartition}
                    preload={guestPreloadPath}
                    allowpopups
                    webpreferences='contextIsolation=yes,javascript=yes,sandbox=no,devTools=yes'
                  />
                ) : null}
              </div>
            </div>
          </div>
          <div
            className={`browser-panel__split-devtools${devToolsOpen ? ' browser-panel__split-devtools--open' : ''}`}
          >
            <webview
              ref={devtoolsWebviewRef}
              className='browser-panel__devtools'
              src='about:blank'
              webpreferences='contextIsolation=yes,javascript=yes,sandbox=no'
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export const BrowserView = memo(BrowserViewComponent);
