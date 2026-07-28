import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommandType } from '@nexus/protocol';
import { bridge } from '../lib/supabase';
import { waitForCommandResult } from './webCommandResult';

export type WebEmulatorPlatform = 'android' | 'ios';

export interface WebEmulatorDevice {
  id: string;
  name: string;
  platform: WebEmulatorPlatform;
  subtitle: string | null;
  state: string;
}

export interface WebEmulatorSessionInfo {
  sessionId: string;
  tabId: string;
  platform: WebEmulatorPlatform;
  deviceId: string;
  localProjectId: string | null;
  state: string;
}

export interface WebEmulatorApp {
  id: string;
  name: string;
}

interface UseWebEmulatorSessionOptions {
  workspaceId: string | null;
  projectId: string | null;
  deviceId: string | null;
  enabled: boolean;
}

async function runEmulatorCommand(
  type: CommandType,
  input: {
    workspaceId: string;
    deviceId: string;
    projectId: string | null;
    payload?: Record<string, unknown>;
  },
  timeoutMs = 30000,
): Promise<Record<string, unknown>> {
  const commandId = await bridge.executeCommand({
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    target_device_id: input.deviceId,
    type,
    payload: input.payload ?? {},
  });
  return waitForCommandResult(commandId, timeoutMs);
}

export function useWebEmulatorSession({
  workspaceId,
  projectId,
  deviceId,
  enabled,
}: UseWebEmulatorSessionOptions) {
  const [platform, setPlatform] = useState<WebEmulatorPlatform>('android');
  const [devices, setDevices] = useState<WebEmulatorDevice[]>([]);
  const [sessions, setSessions] = useState<WebEmulatorSessionInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<string>('stopped');
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [apps, setApps] = useState<WebEmulatorApp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frameUrlRef = useRef<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const lastFrameAtRef = useRef(0);
  const attachInFlightRef = useRef(false);

  const clearFrame = useCallback(() => {
    if (frameUrlRef.current) {
      URL.revokeObjectURL(frameUrlRef.current);
      frameUrlRef.current = null;
    }
    setFrameUrl(null);
  }, []);

  const applyFrameBase64 = useCallback((base64: string, mimeType: string, width?: number, height?: number) => {
    if (!base64) {
      return;
    }
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mimeType });
      const url = URL.createObjectURL(blob);
      if (frameUrlRef.current) {
        URL.revokeObjectURL(frameUrlRef.current);
      }
      frameUrlRef.current = url;
      lastFrameAtRef.current = Date.now();
      setFrameUrl(url);
      if (width && height && width > 0 && height > 0) {
        setFrameSize({ width, height });
      }
    } catch {
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    if (!workspaceId || !deviceId) {
      return;
    }
    try {
      const result = await runEmulatorCommand('emulator_list_sessions', {
        workspaceId,
        deviceId,
        projectId,
      });
      const list = Array.isArray(result.sessions) ? result.sessions : [];
      setSessions(
        list.map((item) => {
          const row = item as Record<string, unknown>;
          return {
            sessionId: String(row.sessionId ?? row.session_id ?? ''),
            tabId: String(row.tabId ?? row.tab_id ?? ''),
            platform: row.platform === 'ios' ? 'ios' : 'android',
            deviceId: String(row.deviceId ?? row.device_id ?? ''),
            localProjectId: String(row.localProjectId ?? row.local_project_id ?? '') || null,
            state: String(row.state ?? 'running'),
          };
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [deviceId, projectId, workspaceId]);

  const refreshDevices = useCallback(async () => {
    if (!workspaceId || !deviceId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await runEmulatorCommand('emulator_list_devices', {
        workspaceId,
        deviceId,
        projectId,
        payload: { platform },
      });
      const list = Array.isArray(result.devices) ? result.devices : [];
      const mapped = list.map((item) => {
        const row = item as Record<string, unknown>;
        return {
          id: String(row.id ?? ''),
          name: String(row.name ?? row.id ?? ''),
          platform: (row.platform === 'ios' ? 'ios' : 'android') as WebEmulatorPlatform,
          subtitle: typeof row.subtitle === 'string' ? row.subtitle : null,
          state: String(row.state ?? 'available'),
        };
      });
      setDevices(mapped);
      setSelectedDeviceId((current) => current || mapped[0]?.id || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [deviceId, platform, projectId, workspaceId]);

  const detachCurrent = useCallback(async () => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    if (sessionId && workspaceId && deviceId) {
      try {
        await runEmulatorCommand('emulator_detach', {
          workspaceId,
          deviceId,
          projectId,
          payload: { session_id: sessionId },
        });
      } catch {
      }
    }
    clearFrame();
  }, [clearFrame, deviceId, projectId, sessionId, workspaceId]);

  const attachSession = useCallback(
    async (nextSessionId: string) => {
      if (!workspaceId || !deviceId || !nextSessionId) {
        return;
      }
      if (attachInFlightRef.current) {
        return;
      }
      attachInFlightRef.current = true;
      await detachCurrent();
      setLoading(true);
      setError(null);
      try {
        const matched = sessions.find((item) => item.sessionId === nextSessionId);
        if (matched) {
          setPlatform(matched.platform);
          if (matched.deviceId) {
            setSelectedDeviceId(matched.deviceId);
          }
        }

        unsubscribeRef.current?.();
        unsubscribeRef.current = bridge.subscribeToEmulator(nextSessionId, (payload) => {
          const envelope = payload as {
            type?: string;
            payload?: Record<string, unknown>;
          };
          const data = envelope.payload ?? (payload as Record<string, unknown>);
          const type = envelope.type ?? String(data.type ?? '');

          if (type === 'emulator.frame' || data.jpeg_base64) {
            applyFrameBase64(
              String(data.jpeg_base64 ?? ''),
              'image/jpeg',
              Number(data.width ?? 0),
              Number(data.height ?? 0),
            );
            return;
          }

          if (type === 'emulator.state' || type === 'emulator.closed') {
            setSessionState(String(data.state ?? (type === 'emulator.closed' ? 'stopped' : 'running')));
            setSessionMessage(typeof data.message === 'string' ? data.message : null);
            if (type === 'emulator.closed' || data.state === 'stopped' || data.state === 'error') {
              clearFrame();
            }
          }
        });

        const result = await runEmulatorCommand('emulator_attach', {
          workspaceId,
          deviceId,
          projectId,
          payload: { session_id: nextSessionId },
        });
        setSessionId(nextSessionId);
        setSessionState(String(result.state ?? matched?.state ?? 'running'));
        setSessionMessage(typeof result.message === 'string' ? result.message : null);
        if (typeof result.platform === 'string') {
          setPlatform(result.platform === 'ios' ? 'ios' : 'android');
        }
        const resultDeviceId = String(result.deviceId ?? result.device_id ?? '');
        if (resultDeviceId) {
          setSelectedDeviceId(resultDeviceId);
        }
        if (typeof result.frameWidth === 'number' && typeof result.frameHeight === 'number') {
          setFrameSize({ width: result.frameWidth, height: result.frameHeight });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        attachInFlightRef.current = false;
        setLoading(false);
      }
    },
    [applyFrameBase64, clearFrame, detachCurrent, deviceId, projectId, sessions, workspaceId],
  );

  const startSession = useCallback(async () => {
    if (!workspaceId || !deviceId || !selectedDeviceId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await runEmulatorCommand(
        'emulator_start',
        {
          workspaceId,
          deviceId,
          projectId,
          payload: {
            platform,
            device_id: selectedDeviceId,
          },
        },
        180000,
      );
      const nextSessionId = String(result.session_id ?? result.sessionId ?? '');
      if (!nextSessionId) {
        throw new Error('Sessão de emulador não retornada');
      }
      await attachSession(nextSessionId);
      await refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }, [
    attachSession,
    deviceId,
    platform,
    projectId,
    refreshSessions,
    selectedDeviceId,
    workspaceId,
  ]);

  const stopSession = useCallback(async () => {
    if (!workspaceId || !deviceId || !sessionId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await runEmulatorCommand('emulator_stop', {
        workspaceId,
        deviceId,
        projectId,
        payload: { session_id: sessionId },
      });
      await detachCurrent();
      setSessionId(null);
      setSessionState('stopped');
      await refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [detachCurrent, deviceId, projectId, refreshSessions, sessionId, workspaceId]);

  const sendInput = useCallback(
    async (type: CommandType, payload: Record<string, unknown>) => {
      if (!workspaceId || !deviceId || !sessionId) {
        return;
      }
      const isGesture = type === 'emulator_tap' || type === 'emulator_swipe';
      try {
        await runEmulatorCommand(
          type,
          {
            workspaceId,
            deviceId,
            projectId,
            payload: { session_id: sessionId, ...payload },
          },
          isGesture ? 12000 : 30000,
        );
      } catch (err) {
        if (!isGesture) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    },
    [deviceId, projectId, sessionId, workspaceId],
  );

  const refreshApps = useCallback(async () => {
    if (!workspaceId || !deviceId || !sessionId) {
      return;
    }
    try {
      const result = await runEmulatorCommand(
        'emulator_list_apps',
        {
          workspaceId,
          deviceId,
          projectId,
          payload: { session_id: sessionId },
        },
        30000,
      );
      const list = Array.isArray(result.apps) ? result.apps : [];
      setApps(
        list.map((item) => {
          const row = item as Record<string, unknown>;
          return {
            id: String(row.id ?? ''),
            name: String(row.name ?? row.id ?? ''),
          };
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [deviceId, projectId, sessionId, workspaceId]);

  const takeScreenshot = useCallback(async () => {
    if (!workspaceId || !deviceId || !sessionId) {
      return;
    }
    try {
      const result = await runEmulatorCommand(
        'emulator_screenshot',
        {
          workspaceId,
          deviceId,
          projectId,
          payload: { session_id: sessionId },
        },
        30000,
      );
      const base64 = String(result.png_base64 ?? '');
      if (!base64) {
        throw new Error('Screenshot vazio');
      }
      const link = document.createElement('a');
      link.href = `data:image/png;base64,${base64}`;
      link.download = `nexus-emulator-${Date.now()}.png`;
      link.click();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [deviceId, projectId, sessionId, workspaceId]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void refreshDevices();
    void refreshSessions();
  }, [enabled, refreshDevices, refreshSessions]);

  useEffect(() => {
    if (!enabled || !workspaceId || !deviceId || sessionId || loading || attachInFlightRef.current) {
      return;
    }
    const preferred =
      sessions.find((item) => item.state === 'running' || item.state === 'booting') ?? sessions[0];
    if (!preferred?.sessionId) {
      return;
    }
    void attachSession(preferred.sessionId);
  }, [attachSession, deviceId, enabled, loading, sessionId, sessions, workspaceId]);

  useEffect(() => {
    if (!enabled || !workspaceId || !deviceId || !sessionId) {
      return;
    }
    if (sessionState !== 'running' && sessionState !== 'booting') {
      return;
    }

    let cancelled = false;
    let inFlight = false;

    const pollFrame = async () => {
      if (cancelled || inFlight) {
        return;
      }
      const age = Date.now() - lastFrameAtRef.current;
      if (frameUrlRef.current && age < 2500) {
        return;
      }
      inFlight = true;
      try {
        const result = await runEmulatorCommand(
          'emulator_screenshot',
          {
            workspaceId,
            deviceId,
            projectId,
            payload: { session_id: sessionId },
          },
          20000,
        );
        if (cancelled) {
          return;
        }
        applyFrameBase64(String(result.png_base64 ?? ''), 'image/png');
      } catch {
      } finally {
        inFlight = false;
      }
    };

    const timer = window.setInterval(() => {
      void pollFrame();
    }, 2500);
    void pollFrame();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [applyFrameBase64, deviceId, enabled, projectId, sessionId, sessionState, workspaceId]);

  useEffect(() => {
    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      if (frameUrlRef.current) {
        URL.revokeObjectURL(frameUrlRef.current);
        frameUrlRef.current = null;
      }
    };
  }, []);

  return {
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
    refreshDevices,
    refreshSessions,
    attachSession,
    startSession,
    stopSession,
    sendInput,
    refreshApps,
    takeScreenshot,
  };
}
