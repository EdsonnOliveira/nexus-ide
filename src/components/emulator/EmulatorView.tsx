import {
  ArrowLeft,
  Camera,
  Check,
  ChevronDown,
  Home,
  Loader2,
  Play,
  RotateCw,
  Smartphone,
  Square,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  positionDropdownBelowAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import { useEmulatorSession } from '@/hooks/useEmulatorSession';
import { useTabActions } from '@/stores/useTabStore';
import type { EmulatorDevice, EmulatorPlatform, EmulatorTab } from '@/types';

const EMULATOR_MIN_ZOOM = 0.5;
const EMULATOR_MAX_ZOOM = 1.5;
const EMULATOR_ZOOM_STEP = 0.1;
const EMULATOR_DEFAULT_ZOOM = 1;

function clampEmulatorZoom(factor: number, maxZoom = EMULATOR_MAX_ZOOM): number {
  return Math.min(maxZoom, Math.max(EMULATOR_MIN_ZOOM, Number(factor.toFixed(2))));
}

function computeEmulatorMaxZoom(
  wrap: HTMLElement,
  canvas: HTMLCanvasElement,
): number {
  if (canvas.offsetWidth <= 0 || canvas.offsetHeight <= 0) {
    return EMULATOR_DEFAULT_ZOOM;
  }

  const maxByHeight = wrap.clientHeight / canvas.offsetHeight;
  const maxByWidth = wrap.clientWidth / canvas.offsetWidth;
  const fitMax = Math.min(maxByHeight, maxByWidth, EMULATOR_MAX_ZOOM);

  return clampEmulatorZoom(Math.floor(fitMax * 100) / 100, EMULATOR_MAX_ZOOM);
}

interface PlatformIconProps {
  size?: number;
}

function AndroidIcon({ size = 14 }: PlatformIconProps) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='currentColor' aria-hidden>
      <path d='M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85-.29-.15-.65-.06-.83.22l-1.88 3.24a11.463 11.463 0 0 0-8.94 0L5.65 5.67c-.19-.29-.58-.38-.87-.2-.28.18-.37.54-.22.83L6.4 9.48C3.3 11.25 1.28 14.44 1 18h22c-.28-3.56-2.3-6.75-5.4-8.52zM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z' />
    </svg>
  );
}

function AppleLogoIcon({ size = 14 }: PlatformIconProps) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='currentColor' aria-hidden>
      <path d='M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z' />
    </svg>
  );
}

interface EmulatorViewProps {
  tab: EmulatorTab;
  isVisible: boolean;
  isRuntimeActive: boolean;
  isFocused: boolean;
  onFocusPane: (paneId: string) => void;
  onUpdateTab: (
    tabId: string,
    patch: Partial<Pick<EmulatorTab, 'platform' | 'deviceId' | 'sessionId' | 'title'>>,
  ) => void;
}

interface EmulatorDeviceMenuProps {
  anchorRect: DOMRect;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  devices: EmulatorDevice[];
  selectedDeviceId: string;
  onClose: () => void;
  onSelect: (deviceId: string) => void;
}

function EmulatorDeviceMenuComponent({
  anchorRect,
  anchorRef,
  devices,
  selectedDeviceId,
  onClose,
  onSelect,
}: EmulatorDeviceMenuProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownBelowAnchor(menu, anchorRect, 'start'),
    [anchorRect],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) {
        return;
      }

      requestClose();
    };

    const timeoutId = window.setTimeout(() => {
      window.addEventListener('mousedown', handlePointerDown);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [anchorRef, requestClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [requestClose]);

  const handleSelect = useCallback(
    (deviceId: string) => (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onSelect(deviceId);
      requestClose();
    },
    [onSelect, requestClose],
  );

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu emulator-view__device-menu overlay-popup--anchor-start ${animationClass}`}
      role='menu'
    >
      {devices.map((device) => {
        const isSelected = device.id === selectedDeviceId;

        return (
          <button
            key={device.id}
            type='button'
            className={`context-menu__item emulator-view__device-menu-item${isSelected ? ' context-menu__item--active' : ''}`}
            role='menuitem'
            onMouseDown={handleSelect(device.id)}
          >
            <span className='emulator-view__device-menu-item-content'>
              <span className='emulator-view__device-menu-name'>{device.name}</span>
              {device.subtitle ? (
                <span className='emulator-view__device-menu-subtitle'>{device.subtitle}</span>
              ) : null}
            </span>
            {isSelected ? (
              <Check size={14} strokeWidth={2} className='emulator-view__device-menu-check' aria-hidden />
            ) : null}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

const EmulatorDeviceMenu = memo(EmulatorDeviceMenuComponent);

function streamBackendLabel(backend: string): string {
  if (backend === 'idb') {
    return 'idb';
  }

  if (backend === 'simctl') {
    return 'simctl';
  }

  return 'adb';
}

function EmulatorViewComponent({
  tab,
  isVisible,
  isRuntimeActive,
  isFocused,
  onFocusPane,
  onUpdateTab,
}: EmulatorViewProps) {
  const {
    setupStatus,
    devices,
    selectedDeviceId,
    isLoadingDevices,
    sessionState,
    sessionMessage,
    captureBackend,
    streamFps,
    targetFps,
    streamFallbackReason,
    isStarting,
    frameSize,
    canvasRef,
    setPlatform,
    setDeviceId,
    startSession,
    stopSession,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleCanvasPaste,
    pressHome,
    pressBack,
    rotate,
    takeScreenshot,
  } = useEmulatorSession({ tab, isRuntimeActive, isFocused, onUpdateTab });

  const { addAgentTab } = useTabActions();
  const [screenshotCopied, setScreenshotCopied] = useState(false);
  const screenshotTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deviceMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const [deviceMenuAnchorRect, setDeviceMenuAnchorRect] = useState<DOMRect | null>(null);
  const [zoomFactor, setZoomFactor] = useState(EMULATOR_DEFAULT_ZOOM);
  const [maxZoomFactor, setMaxZoomFactor] = useState(EMULATOR_DEFAULT_ZOOM);
  const screenWrapRef = useRef<HTMLDivElement>(null);

  const platformSetup = useMemo(() => {
    if (!setupStatus) {
      return null;
    }

    return tab.platform === 'android' ? setupStatus.android : setupStatus.ios;
  }, [setupStatus, tab.platform]);

  const isRunning = sessionState === 'running' || sessionState === 'booting' || isStarting;
  const showControls = sessionState === 'running';
  const streamBadgeLabel = useMemo(() => {
    if (!captureBackend) {
      return '';
    }

    const backend = streamBackendLabel(captureBackend);

    if (captureBackend === 'simctl') {
      return streamFps > 0 ? `${backend} · ${streamFps} FPS` : `${backend} · ~7 FPS máx`;
    }

    return `${backend} · ${streamFps > 0 ? streamFps : targetFps} FPS`;
  }, [captureBackend, streamFps, targetFps]);
  const streamBadgeTitle = streamFallbackReason ?? undefined;
  const showBootSpinner = isStarting || sessionState === 'booting';
  const isDeviceSelectDisabled =
    isRunning || (isLoadingDevices && !devices.length) || !devices.length;

  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === selectedDeviceId) ?? null,
    [devices, selectedDeviceId],
  );

  const deviceTriggerLabel = useMemo(() => {
    if (isLoadingDevices && !devices.length) {
      return 'Carregando dispositivos…';
    }

    if (!devices.length) {
      return 'Nenhum dispositivo';
    }

    return selectedDevice?.name ?? devices[0]?.name ?? 'Nenhum dispositivo';
  }, [devices, isLoadingDevices, selectedDevice]);

  const handleMouseDown = useCallback(() => {
    onFocusPane(tab.id);
  }, [onFocusPane, tab.id]);

  const handlePlatformChange = useCallback(
    (platform: EmulatorPlatform) => {
      if (isRunning) {
        return;
      }

      setPlatform(platform);
    },
    [isRunning, setPlatform],
  );

  const handleToggleDeviceMenu = useCallback(() => {
    if (isDeviceSelectDisabled) {
      return;
    }

    setDeviceMenuOpen((open) => {
      if (open) {
        setDeviceMenuAnchorRect(null);
        return false;
      }

      const rect = deviceMenuButtonRef.current?.getBoundingClientRect() ?? null;
      setDeviceMenuAnchorRect(rect);
      return Boolean(rect);
    });
  }, [isDeviceSelectDisabled]);

  const handleCloseDeviceMenu = useCallback(() => {
    setDeviceMenuOpen(false);
    setDeviceMenuAnchorRect(null);
  }, []);

  useEffect(() => {
    if (isDeviceSelectDisabled && deviceMenuOpen) {
      handleCloseDeviceMenu();
    }
  }, [deviceMenuOpen, handleCloseDeviceMenu, isDeviceSelectDisabled]);

  const handleSelectDevice = useCallback(
    (deviceId: string) => {
      setDeviceId(deviceId);
    },
    [setDeviceId],
  );

  const handleToggleSession = useCallback(() => {
    if (isRunning || isStarting) {
      void stopSession();
      return;
    }

    void startSession();
  }, [isRunning, isStarting, sessionState, startSession, stopSession]);

  const handleInstall = useCallback(() => {
    if (!platformSetup?.installCommand) {
      return;
    }

    void addAgentTab(platformSetup.installCommand);
  }, [addAgentTab, platformSetup?.installCommand]);

  const handlePressHome = useCallback(() => {
    void pressHome();
  }, [pressHome]);

  const handlePressBack = useCallback(() => {
    void pressBack();
  }, [pressBack]);

  const handleRotate = useCallback(() => {
    void rotate();
  }, [rotate]);

  const handleScreenshot = useCallback(() => {
    void takeScreenshot().then((copied) => {
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
  }, [takeScreenshot]);

  const handleZoomIn = useCallback(() => {
    setZoomFactor((current) => clampEmulatorZoom(current + EMULATOR_ZOOM_STEP, maxZoomFactor));
  }, [maxZoomFactor]);

  const handleZoomOut = useCallback(() => {
    setZoomFactor((current) => clampEmulatorZoom(current - EMULATOR_ZOOM_STEP, maxZoomFactor));
  }, [maxZoomFactor]);

  useEffect(() => {
    if (!isRunning) {
      setZoomFactor(EMULATOR_DEFAULT_ZOOM);
      setMaxZoomFactor(EMULATOR_DEFAULT_ZOOM);
    }
  }, [isRunning]);

  useEffect(() => {
    setZoomFactor((current) => clampEmulatorZoom(current, maxZoomFactor));
  }, [maxZoomFactor]);

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    const wrap = screenWrapRef.current;
    const canvas = canvasRef.current;

    if (!wrap || !canvas) {
      return;
    }

    const updateMaxZoom = () => {
      setMaxZoomFactor(computeEmulatorMaxZoom(wrap, canvas));
    };

    const observer = new ResizeObserver(updateMaxZoom);
    observer.observe(wrap);
    observer.observe(canvas);
    updateMaxZoom();

    return () => observer.disconnect();
  }, [canvasRef, frameSize.height, frameSize.width, isRunning, showControls]);

  useEffect(() => {
    return () => {
      if (screenshotTimeoutRef.current) {
        clearTimeout(screenshotTimeoutRef.current);
      }
    };
  }, []);

  const screenStyle = useMemo(() => {
    const aspect = frameSize.width / frameSize.height;
    const maxHeight = '100%';
    const maxWidth = `calc(${maxHeight} * ${aspect})`;

    return {
      aspectRatio: `${frameSize.width} / ${frameSize.height}`,
      maxWidth,
      maxHeight,
    } as const;
  }, [frameSize.height, frameSize.width]);

  return (
    <div className='emulator-view' onMouseDown={handleMouseDown}>
      <div className={`emulator-view__toolbar${isFocused ? ' emulator-view__toolbar--focused' : ''}`}>
        <div className='emulator-view__platforms' role='tablist' aria-label='Plataforma do emulador'>
          <button
            type='button'
            className={`emulator-view__platform app-button${tab.platform === 'android' ? ' emulator-view__platform--active app-button--enter' : ''}`}
            onClick={() => handlePlatformChange('android')}
            disabled={isRunning}
          >
            <AndroidIcon size={14} />
            <span>Android</span>
          </button>
          <button
            type='button'
            className={`emulator-view__platform app-button${tab.platform === 'ios' ? ' emulator-view__platform--active app-button--enter' : ''}`}
            onClick={() => handlePlatformChange('ios')}
            disabled={isRunning}
          >
            <AppleLogoIcon size={14} />
            <span>iOS</span>
          </button>
        </div>

        <div className={`emulator-view__device-bar${deviceMenuOpen ? ' emulator-view__device-bar--open' : ''}`}>
          <button
            ref={deviceMenuButtonRef}
            type='button'
            className={`emulator-view__device-trigger app-button${deviceMenuOpen ? ' emulator-view__device-trigger--open app-button--enter' : ''}`}
            disabled={isDeviceSelectDisabled}
            aria-expanded={deviceMenuOpen}
            aria-haspopup='menu'
            onClick={handleToggleDeviceMenu}
          >
            <span className='emulator-view__device-trigger-label'>{deviceTriggerLabel}</span>
            <ChevronDown size={14} strokeWidth={2} className='emulator-view__device-trigger-icon' aria-hidden />
          </button>
          {deviceMenuOpen && deviceMenuAnchorRect ? (
            <EmulatorDeviceMenu
              anchorRect={deviceMenuAnchorRect}
              anchorRef={deviceMenuButtonRef}
              devices={devices}
              selectedDeviceId={selectedDeviceId}
              onClose={handleCloseDeviceMenu}
              onSelect={handleSelectDevice}
            />
          ) : null}
          {showControls ? (
            <div className='emulator-view__device-actions' role='toolbar' aria-label='Controles do emulador'>
              <button
                type='button'
                className='emulator-view__device-action app-button app-button--enter'
                title='Início'
                aria-label='Início'
                onClick={handlePressHome}
              >
                <Home size={14} strokeWidth={2} />
              </button>
              {tab.platform === 'android' ? (
                <button
                  type='button'
                  className='emulator-view__device-action app-button app-button--enter'
                  title='Voltar'
                  aria-label='Voltar'
                  onClick={handlePressBack}
                >
                  <ArrowLeft size={14} strokeWidth={2} />
                </button>
              ) : null}
              <button
                type='button'
                className='emulator-view__device-action app-button app-button--enter'
                title='Girar'
                aria-label='Girar'
                onClick={handleRotate}
              >
                <RotateCw size={14} strokeWidth={2} />
              </button>
              <button
                type='button'
                className='emulator-view__device-action app-button app-button--enter'
                title='Diminuir zoom'
                aria-label='Diminuir zoom'
                disabled={zoomFactor <= EMULATOR_MIN_ZOOM}
                onClick={handleZoomOut}
              >
                <ZoomOut size={14} strokeWidth={2} />
              </button>
              <button
                type='button'
                className='emulator-view__device-action app-button app-button--enter'
                title='Aumentar zoom'
                aria-label='Aumentar zoom'
                disabled={zoomFactor + EMULATOR_ZOOM_STEP / 2 >= maxZoomFactor}
                onClick={handleZoomIn}
              >
                <ZoomIn size={14} strokeWidth={2} />
              </button>
              <button
                type='button'
                className={`emulator-view__device-action app-button app-button--enter${screenshotCopied ? ' emulator-view__device-action--active' : ''}`}
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
                onClick={handleScreenshot}
              >
                {screenshotCopied ? <Check size={14} strokeWidth={2} /> : <Camera size={14} strokeWidth={2} />}
              </button>
            </div>
          ) : null}
        </div>

        <button
          type='button'
          className={`emulator-view__action app-button app-button--enter${isRunning ? ' emulator-view__action--stop' : ' emulator-view__action--start'}`}
          onClick={handleToggleSession}
          disabled={!selectedDeviceId || platformSetup?.available === false}
        >
          {showBootSpinner ? (
            <Loader2 size={14} className='emulator-view__spinner' />
          ) : isRunning ? (
            <Square size={14} strokeWidth={2} aria-hidden />
          ) : (
            <Play size={14} strokeWidth={2} aria-hidden />
          )}
          <span className='app-button__label'>{isRunning ? 'Parar' : 'Iniciar'}</span>
        </button>

        {captureBackend && showControls ? (
          <span
            className={`emulator-view__stream-badge emulator-view__stream-badge--${captureBackend} app-button--enter`}
            title={streamBadgeTitle}
          >
            {streamBadgeLabel}
          </span>
        ) : null}
      </div>

      <div className='emulator-view__body'>
        {!isRunning ? (
          <div className='emulator-view__empty workspace-empty-state'>
            <Smartphone size={28} strokeWidth={1.6} />
            <p>Selecione um dispositivo e clique em Iniciar para ver o emulador real nesta aba.</p>
            {platformSetup && !platformSetup.available ? (
              <div className='emulator-view__setup'>
                <p>Ferramentas ausentes: {platformSetup.missingTools.join(', ')}</p>
                {platformSetup.installHint ? <p>{platformSetup.installHint}</p> : null}
                {platformSetup.installCommand ? (
                  <button
                    type='button'
                    className='emulator-view__install app-button app-button--enter'
                    onClick={handleInstall}
                  >
                    Instalar
                  </button>
                ) : null}
              </div>
            ) : null}
            {sessionMessage ? <p className='emulator-view__error'>{sessionMessage}</p> : null}
          </div>
        ) : (
          <div className='emulator-view__screen-column'>
            <div
              ref={screenWrapRef}
              className='emulator-view__screen-wrap'
              style={{ '--emulator-zoom': zoomFactor } as React.CSSProperties}
            >
              {showBootSpinner ? (
                <div className='emulator-view__loading'>
                  <Loader2 size={18} className='emulator-view__spinner' />
                  <span>Iniciando emulador…</span>
                </div>
              ) : null}
              <canvas
                ref={canvasRef}
                className='emulator-view__screen'
                style={screenStyle}
                tabIndex={0}
                role='application'
                aria-label='Tela do emulador'
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPaste={handleCanvasPaste}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const EmulatorView = memo(EmulatorViewComponent);
