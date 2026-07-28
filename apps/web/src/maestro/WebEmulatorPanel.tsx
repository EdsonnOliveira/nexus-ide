import { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Home,
  Loader2,
  Play,
  RotateCw,
  Smartphone,
  Square,
  X,
  AppWindow,
} from 'lucide-react';
import { WebAskMenuSelect } from './WebAskMenuSelect';
import {
  useWebEmulatorSession,
  type WebEmulatorPlatform,
} from './useWebEmulatorSession';
import { bridge } from '../lib/supabase';

interface WebEmulatorPanelProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string | null;
  projectId: string | null;
  deviceId: string | null;
}

function AndroidLogoIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='currentColor' aria-hidden>
      <path d='M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85-.29-.15-.65-.06-.83.22l-1.88 3.24a11.463 11.463 0 0 0-8.94 0L5.65 5.67c-.19-.29-.58-.38-.87-.2-.28.18-.37.54-.22.83L6.4 9.48C3.3 11.25 1.28 14.44 1 18h22c-.28-3.56-2.3-6.75-5.4-8.52zM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z' />
    </svg>
  );
}

function AppleLogoIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='currentColor' aria-hidden>
      <path d='M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z' />
    </svg>
  );
}

function WebEmulatorPanelComponent({
  open,
  onClose,
  workspaceId,
  projectId,
  deviceId,
}: WebEmulatorPanelProps) {
  const {
    platform,
    setPlatform,
    devices,
    sessions,
    selectedDeviceId,
    setSelectedDeviceId,
    sessionId,
    sessionState,
    sessionMessage,
    frameUrl,
    frameSize,
    apps,
    loading,
    error,
    attachSession,
    startSession,
    stopSession,
    sendInput,
    refreshApps,
    takeScreenshot,
  } = useWebEmulatorSession({
    workspaceId,
    projectId,
    deviceId,
    enabled: open,
  });

  const [appsOpen, setAppsOpen] = useState(false);
  const pointerRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    startedAt: number;
  } | null>(null);
  const lastMoveSentAtRef = useRef(0);
  const screenRef = useRef<HTMLDivElement>(null);

  const running = Boolean(sessionId) && sessionState !== 'stopped' && sessionState !== 'error';

  const sendPointer = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!sessionId) {
        return false;
      }
      return bridge.sendEmulatorInput(sessionId, payload);
    },
    [sessionId],
  );

  const commitGesture = useCallback(
    (input: {
      x: number;
      y: number;
      startX: number;
      startY: number;
      moved: boolean;
      durationMs: number;
    }) => {
      if (input.moved) {
        const durationMs = Math.max(100, Math.min(500, Math.round(input.durationMs)));
        void sendInput('emulator_swipe', {
          x1: input.startX,
          y1: input.startY,
          x2: input.x,
          y2: input.y,
          duration_ms: durationMs,
        });
        return;
      }
      void sendInput('emulator_tap', {
        x: input.x,
        y: input.y,
      });
    },
    [sendInput],
  );

  const runningDeviceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const session of sessions) {
      if (session.deviceId && session.state !== 'stopped' && session.state !== 'error') {
        ids.add(session.deviceId);
      }
    }
    for (const device of devices) {
      if (device.state === 'booted') {
        ids.add(device.id);
      }
    }
    return ids;
  }, [devices, sessions]);

  const deviceOptions = useMemo(
    () =>
      devices.map((device) => {
        const isRunning = runningDeviceIds.has(device.id);
        return {
          value: device.id,
          label: device.subtitle ? `${device.name} · ${device.subtitle}` : device.name,
          leading: isRunning ? (
            <span className='web-emulator-device-leading' aria-label='Rodando no Mac'>
              <span className='dot dot--online' />
            </span>
          ) : (
            <span className='web-emulator-device-leading' aria-hidden='true'>
              <span className='dot dot--offline' />
            </span>
          ),
        };
      }),
    [devices, runningDeviceIds],
  );

  const selectedDeviceOption = useMemo(
    () => deviceOptions.find((item) => item.value === selectedDeviceId) ?? null,
    [deviceOptions, selectedDeviceId],
  );

  const sessionOptions = useMemo(
    () =>
      sessions.map((session) => ({
        value: session.sessionId,
        label: `${session.platform === 'ios' ? 'iOS' : 'Android'} · ${session.state}`,
      })),
    [sessions],
  );

  const resolveCoords = useCallback(
    (clientX: number, clientY: number) => {
      const el = screenRef.current;
      if (!el) {
        return null;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return null;
      }

      let offsetX = 0;
      let offsetY = 0;
      let contentW = rect.width;
      let contentH = rect.height;

      if (frameSize.width > 0 && frameSize.height > 0) {
        const scale = Math.min(rect.width / frameSize.width, rect.height / frameSize.height);
        contentW = frameSize.width * scale;
        contentH = frameSize.height * scale;
        offsetX = (rect.width - contentW) / 2;
        offsetY = (rect.height - contentH) / 2;
      }

      if (contentW <= 0 || contentH <= 0) {
        return null;
      }

      const x = (clientX - rect.left - offsetX) / contentW;
      const y = (clientY - rect.top - offsetY) / contentH;
      if (x < 0 || x > 1 || y < 0 || y > 1) {
        return null;
      }

      return {
        x: Math.min(1, Math.max(0, x)),
        y: Math.min(1, Math.max(0, y)),
      };
    },
    [frameSize.height, frameSize.width],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!running) {
        return;
      }
      const coords = resolveCoords(event.clientX, event.clientY);
      if (!coords) {
        return;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      pointerRef.current = {
        pointerId: event.pointerId,
        startX: coords.x,
        startY: coords.y,
        lastX: coords.x,
        lastY: coords.y,
        moved: false,
        startedAt: Date.now(),
      };
      lastMoveSentAtRef.current = 0;
      void sendPointer({
        action: 'down',
        x: coords.x,
        y: coords.y,
        start_x: coords.x,
        start_y: coords.y,
      });
    },
    [resolveCoords, running, sendPointer],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const pointer = pointerRef.current;
      if (!pointer || pointer.pointerId !== event.pointerId) {
        return;
      }
      const coords = resolveCoords(event.clientX, event.clientY);
      if (!coords) {
        return;
      }
      const dx = coords.x - pointer.startX;
      const dy = coords.y - pointer.startY;
      if (Math.hypot(dx, dy) > 0.008) {
        pointer.moved = true;
      }
      pointer.lastX = coords.x;
      pointer.lastY = coords.y;
      const now = Date.now();
      if (now - lastMoveSentAtRef.current < 24) {
        return;
      }
      lastMoveSentAtRef.current = now;
      event.preventDefault();
      void sendPointer({
        action: 'move',
        x: coords.x,
        y: coords.y,
        start_x: pointer.startX,
        start_y: pointer.startY,
      });
    },
    [resolveCoords, sendPointer],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const pointer = pointerRef.current;
      if (!pointer || pointer.pointerId !== event.pointerId) {
        return;
      }
      pointerRef.current = null;
      const coords = resolveCoords(event.clientX, event.clientY) ?? {
        x: pointer.lastX,
        y: pointer.lastY,
      };
      event.preventDefault();
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
      }

      const durationMs = Math.max(120, Math.min(450, Date.now() - pointer.startedAt));
      void sendPointer({
        action: 'up',
        x: coords.x,
        y: coords.y,
        start_x: pointer.startX,
        start_y: pointer.startY,
        duration_ms: durationMs,
      }).then((ok) => {
        if (ok && platform === 'ios') {
          return;
        }
        commitGesture({
          x: coords.x,
          y: coords.y,
          startX: pointer.startX,
          startY: pointer.startY,
          moved: pointer.moved,
          durationMs,
        });
      });
    },
    [commitGesture, platform, resolveCoords, sendPointer],
  );

  const handlePlatform = useCallback(
    (next: WebEmulatorPlatform) => {
      if (running) {
        return;
      }
      setPlatform(next);
    },
    [running, setPlatform],
  );

  const handleToggleApps = useCallback(() => {
    setAppsOpen((current) => {
      const next = !current;
      if (next) {
        void refreshApps();
      }
      return next;
    });
  }, [refreshApps]);

  if (!open) {
    return null;
  }

  return (
    <div className='web-emulator-panel app-button--enter' role='dialog' aria-label='Emulador remoto'>
      <div className='web-emulator-panel__header'>
        <div className='web-emulator-panel__title'>
          <Smartphone size={16} />
          <span>Emulador</span>
          {sessionState !== 'stopped' ? (
            <span className='web-emulator-panel__badge'>{sessionState}</span>
          ) : null}
        </div>
        <button
          type='button'
          className='web-emulator-panel__icon-btn app-button'
          aria-label='Fechar emulador'
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>

      <div className='web-emulator-panel__toolbar'>
        <div className='web-emulator-panel__platform'>
          <button
            type='button'
            className={`web-emulator-panel__chip app-button${platform === 'android' ? ' is-active' : ''}`}
            disabled={running || loading}
            onClick={() => handlePlatform('android')}
          >
            <AndroidLogoIcon />
            Android
          </button>
          <button
            type='button'
            className={`web-emulator-panel__chip app-button${platform === 'ios' ? ' is-active' : ''}`}
            disabled={running || loading}
            onClick={() => handlePlatform('ios')}
          >
            <AppleLogoIcon />
            iOS
          </button>
        </div>

        <WebAskMenuSelect
          value={selectedDeviceId}
          options={deviceOptions}
          disabled={running || loading || deviceOptions.length === 0}
          ariaLabel='Dispositivo do emulador'
          triggerLabel={selectedDeviceOption?.label || 'Selecionar dispositivo'}
          triggerLeading={selectedDeviceOption?.leading}
          onChange={setSelectedDeviceId}
        />

        {sessionOptions.length > 0 ? (
          <WebAskMenuSelect
            value={sessionId ?? ''}
            options={sessionOptions}
            disabled={loading}
            ariaLabel='Sessões ativas no Desktop'
            triggerLabel={
              sessionOptions.find((item) => item.value === sessionId)?.label ||
              'Sessão no Desktop'
            }
            onChange={(value) => {
              if (value) {
                void attachSession(value);
              }
            }}
          />
        ) : null}

        {running ? (
          <button
            type='button'
            className='web-emulator-panel__action app-button'
            disabled={loading}
            onClick={() => void stopSession()}
          >
            <Square size={14} />
            Parar
          </button>
        ) : (
          <button
            type='button'
            className='web-emulator-panel__action app-button'
            disabled={loading || !selectedDeviceId || !deviceId}
            onClick={() => void startSession()}
          >
            {loading ? <Loader2 size={14} className='web-emulator-panel__spin' /> : <Play size={14} />}
            Iniciar
          </button>
        )}
      </div>

      <div className='web-emulator-panel__controls'>
        <button
          type='button'
          className='web-emulator-panel__icon-btn app-button'
          disabled={!running}
          aria-label='Home'
          onClick={() => void sendInput('emulator_press_home', {})}
        >
          <Home size={15} />
        </button>
        {platform === 'android' ? (
          <button
            type='button'
            className='web-emulator-panel__icon-btn app-button'
            disabled={!running}
            aria-label='Voltar'
            onClick={() => void sendInput('emulator_press_back', {})}
          >
            <ArrowLeft size={15} />
          </button>
        ) : null}
        <button
          type='button'
          className='web-emulator-panel__icon-btn app-button'
          disabled={!running}
          aria-label='Girar'
          onClick={() => void sendInput('emulator_rotate', {})}
        >
          <RotateCw size={15} />
        </button>
        <button
          type='button'
          className='web-emulator-panel__icon-btn app-button'
          disabled={!running}
          aria-label='Screenshot'
          onClick={() => void takeScreenshot()}
        >
          <Camera size={15} />
        </button>
        <button
          type='button'
          className={`web-emulator-panel__icon-btn app-button${appsOpen ? ' is-active' : ''}`}
          disabled={!running}
          aria-label='Apps'
          onClick={handleToggleApps}
        >
          <AppWindow size={15} />
        </button>
      </div>

      {error ? <p className='web-emulator-panel__error'>{error}</p> : null}
      {sessionMessage ? <p className='web-emulator-panel__message'>{sessionMessage}</p> : null}

      <div className='web-emulator-panel__body'>
        <div
          ref={screenRef}
          className='web-emulator-panel__screen'
          style={{
            aspectRatio:
              frameSize.width > 0 && frameSize.height > 0
                ? `${frameSize.width} / ${frameSize.height}`
                : '9 / 19',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {frameUrl ? (
            <img src={frameUrl} alt='Emulador' className='web-emulator-panel__frame' draggable={false} />
          ) : (
            <div className='web-emulator-panel__empty'>
              {loading
                ? 'Conectando…'
                : running
                  ? 'Recebendo tela do Desktop…'
                  : 'Inicie ou anexe uma sessão do Desktop'}
            </div>
          )}
        </div>

        {appsOpen ? (
          <div className='web-emulator-panel__apps'>
            <div className='web-emulator-panel__apps-title'>Apps instalados</div>
            {apps.length === 0 ? (
              <div className='web-emulator-panel__empty'>Nenhum app listado</div>
            ) : (
              apps.map((app) => (
                <div key={app.id} className='web-emulator-panel__app-row'>
                  <div className='web-emulator-panel__app-meta'>
                    <strong>{app.name}</strong>
                    <span>{app.id}</span>
                  </div>
                  <div className='web-emulator-panel__app-actions'>
                    <button
                      type='button'
                      className='web-emulator-panel__chip app-button'
                      onClick={() =>
                        void sendInput('emulator_launch_app', { app_id: app.id })
                      }
                    >
                      Abrir
                    </button>
                    <button
                      type='button'
                      className='web-emulator-panel__chip app-button'
                      onClick={() =>
                        void sendInput('emulator_terminate_app', { app_id: app.id })
                      }
                    >
                      Fechar
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const WebEmulatorPanel = memo(WebEmulatorPanelComponent);
