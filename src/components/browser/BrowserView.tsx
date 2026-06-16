import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCw, Smartphone, SquareTerminal } from 'lucide-react';
import type { WebviewTag } from 'electron';
import {
  BROWSER_DEVICE_PRESETS,
  DEFAULT_BROWSER_DEVICE_ID,
  type BrowserDevicePreset,
} from '@/constants/browserDevices';
import { BrowserDeviceMenu } from '@/components/browser/BrowserDeviceMenu';
import { useProjectTerminalUrlHints } from '@/hooks/useProjectTerminalUrlHints';
import { normalizeBrowserUrl } from '@/utils/browserUrl';
import { getProjectBrowserPartition } from '@/utils/projectBrowserSession';
import { formatTerminalUrlLabel } from '@/utils/terminalUrlExtract';
import {
  isLocalDevUrl,
  isBrowserErrorPageUrl,
  isSameLocalDevTarget,
  isOfflineLoadError,
  probeSiteReachable,
  type BrowserSiteStatus,
} from '@/utils/browserSiteStatus';

interface BrowserViewProps {
  projectId: string;
  url: string;
  isVisible: boolean;
  isFocused: boolean;
  onUrlChange: (url: string) => void;
}

function BrowserViewComponent({ projectId, url, isVisible, isFocused, onUrlChange }: BrowserViewProps) {
  const webviewRef = useRef<WebviewTag | null>(null);
  const devtoolsWebviewRef = useRef<WebviewTag | null>(null);
  const deviceMenuButtonRef = useRef<HTMLButtonElement>(null);
  const onUrlChangeRef = useRef(onUrlChange);
  const normalizedUrlRef = useRef('');
  const loadFailedRef = useRef(false);
  const siteStatusRef = useRef<BrowserSiteStatus>('checking');
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
  const [isLoading, setIsLoading] = useState(false);
  const [siteStatus, setSiteStatus] = useState<BrowserSiteStatus>('checking');
  const terminalUrlHints = useProjectTerminalUrlHints(isVisible, normalizedUrl);

  normalizedUrlRef.current = normalizedUrl;
  siteStatusRef.current = siteStatus;

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
        applyLocalProbeResult(false);
      }
      return false;
    }

    if (
      isLocalDevUrl(normalizedUrlRef.current) &&
      isSameLocalDevTarget(loadedUrl, normalizedUrlRef.current)
    ) {
      loadFailedRef.current = false;
      setSiteStatus('online');
      return true;
    }

    return false;
  }, [applyLocalProbeResult]);

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

  const deviceFrameStyle = useMemo(() => {
    if (!activeDevicePreset.width || !activeDevicePreset.height) {
      return undefined;
    }

    return {
      width: `${activeDevicePreset.width}px`,
      height: `${activeDevicePreset.height}px`,
    } as const;
  }, [activeDevicePreset.height, activeDevicePreset.width]);

  useEffect(() => {
    onUrlChangeRef.current = onUrlChange;
  }, [onUrlChange]);

  useEffect(() => {
    if (normalizedUrl) {
      setInputUrl(normalizedUrl);
      loadFailedRef.current = false;
      setSiteStatus('checking');
    }
  }, [normalizedUrl]);

  useEffect(() => {
    if (!normalizedUrl || !isVisible) {
      return;
    }

    if (!isLocalDevUrl(normalizedUrl)) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const reachable = await probeSiteReachable(normalizedUrl);

      if (cancelled || loadFailedRef.current) {
        return;
      }

      applyLocalProbeResult(reachable);
    })();

    return () => {
      cancelled = true;
    };
  }, [applyLocalProbeResult, isVisible, normalizedUrl]);

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
        return;
      }

      void validateSiteStatus(normalizedUrlRef.current);
    };

    const handleFailLoad = (event: Electron.DidFailLoadEvent) => {
      if (event.isMainFrame) {
        setIsLoading(false);
      }

      if (event.isMainFrame && event.errorCode !== -3) {
        loadFailedRef.current = true;
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

    return () => {
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('devtools-closed', handleDevToolsClosed);
      webview.removeEventListener('did-navigate', handleNavigate);
      webview.removeEventListener('did-navigate-in-page', handleNavigateInPage);
      webview.removeEventListener('did-start-loading', handleStartLoading);
      webview.removeEventListener('did-stop-loading', handleStopLoading);
      webview.removeEventListener('did-finish-load', handleFinishLoad);
      webview.removeEventListener('did-fail-load', handleFailLoad);
    };
  }, [applyLocalProbeResult, markOnlineIfSameTarget, syncNavigationState, validateSiteStatus]);

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
    setSiteStatus('checking');
    webviewRef.current?.reload();
  }, []);

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setInputUrl(event.target.value);
  }, []);

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
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
    setSiteStatus('checking');
    webviewRef.current?.loadURL(normalizedUrl);
  }, [normalizedUrl]);

  useEffect(() => {
    if (!isVisible || !isLocalDevUrl(normalizedUrl)) {
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
        loadFailedRef.current = false;
        applyLocalProbeResult(true);

        const webview = webviewRef.current;

        if (!webview) {
          return;
        }

        const currentUrl = webview.getURL();

        if (isBrowserErrorPageUrl(currentUrl) || !isSameLocalDevTarget(currentUrl, normalizedUrl)) {
          webview.loadURL(normalizedUrl);
        }

        return;
      }

      if (currentStatus === 'online' && !reachable) {
        loadFailedRef.current = true;
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
  }, [applyLocalProbeResult, isVisible, normalizedUrl]);

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
    setDeviceMenuOpen((open) => {
      if (open) {
        setDeviceMenuAnchorRect(null);
        return false;
      }

      const rect = deviceMenuButtonRef.current?.getBoundingClientRect() ?? null;
      setDeviceMenuAnchorRect(rect);
      return Boolean(rect);
    });
  }, []);

  const handleCloseDeviceMenu = useCallback(() => {
    setDeviceMenuOpen(false);
    setDeviceMenuAnchorRect(null);
  }, []);

  const handleSelectDevicePreset = useCallback((preset: BrowserDevicePreset) => {
    setDevicePresetId(preset.id);
  }, []);

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
        <button
          type='button'
          className='browser-panel__nav-btn'
          aria-label='Avançar'
          disabled={!canGoForward}
          onClick={handleForward}
        >
          <ChevronRight size={16} strokeWidth={2.25} />
        </button>
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
              className={`browser-panel__url-action${devToolsOpen ? ' browser-panel__url-action--active' : ''}`}
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
                className={`browser-panel__url-action${devicePresetId !== DEFAULT_BROWSER_DEVICE_ID ? ' browser-panel__url-action--active' : ''}${deviceMenuOpen ? ' browser-panel__url-action--active' : ''}`}
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
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <div
        className={`browser-panel__content browser-panel__viewport${devToolsOpen ? ' browser-panel__content--devtools-open' : ''}`}
      >
        <div className={`browser-panel__split browser-panel__split--${siteStatus}`}>
          <div className={`browser-panel__split-page browser-panel__split-page--${siteStatus}`}>
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
              className={`browser-panel__device-frame${activeDevicePreset.width ? ' browser-panel__device-frame--preset' : ''}${siteStatus !== 'online' ? ' browser-panel__device-frame--hidden' : ''}`}
              style={deviceFrameStyle}
            >
              <webview
                key={sessionPartition}
                ref={webviewRef}
                className='browser-panel__webview'
                src={normalizedUrl || undefined}
                partition={sessionPartition}
                allowpopups='true'
                webpreferences='contextIsolation=yes,javascript=yes,sandbox=no,devTools=yes'
              />
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
