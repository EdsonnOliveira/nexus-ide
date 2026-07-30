import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommandType } from '@nexus/protocol';
import { bridge } from '../lib/supabase';
import { waitForCommandResult } from './webCommandResult';

export interface WebPreviewSessionInfo {
  sessionId: string;
  projectId: string | null;
  localUrl: string;
  publicUrl: string | null;
  state: string;
  message: string | null;
}

interface UseWebPreviewSessionOptions {
  workspaceId: string | null;
  projectId: string | null;
  deviceId: string | null;
  enabled: boolean;
}

async function runPreviewCommand(
  type: CommandType,
  input: {
    workspaceId: string;
    deviceId: string;
    projectId: string | null;
    payload?: Record<string, unknown>;
  },
  timeoutMs = 60000,
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

function parseSession(result: Record<string, unknown>): WebPreviewSessionInfo {
  return {
    sessionId: String(result.session_id ?? result.sessionId ?? ''),
    projectId: (result.project_id as string | null) ?? (result.projectId as string | null) ?? null,
    localUrl: String(result.local_url ?? result.localUrl ?? ''),
    publicUrl: (result.public_url as string | null) ?? (result.publicUrl as string | null) ?? null,
    state: String(result.state ?? 'stopped'),
    message: (result.message as string | null) ?? null,
  };
}

export function useWebPreviewSession({
  workspaceId,
  projectId,
  deviceId,
  enabled,
}: UseWebPreviewSessionOptions) {
  const [sessions, setSessions] = useState<WebPreviewSessionInfo[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState('stopped');
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const attachInFlightRef = useRef(false);
  const autoStartedRef = useRef(false);

  const applySession = useCallback((session: WebPreviewSessionInfo) => {
    setSessionId(session.sessionId || null);
    setPublicUrl(session.publicUrl);
    setLocalUrl(session.localUrl || null);
    setSessionState(session.state);
    setSessionMessage(session.message);
  }, []);

  const refreshSessions = useCallback(async () => {
    if (!workspaceId || !deviceId) {
      return;
    }
    try {
      const result = await runPreviewCommand(
        'preview_list_sessions',
        {
          workspaceId,
          deviceId,
          projectId,
        },
        20000,
      );
      const list = Array.isArray(result.sessions) ? result.sessions : [];
      const next = list.map((item) => parseSession(item as Record<string, unknown>));
      setSessions(next);
      return next;
    } catch {
      setSessions([]);
      return [] as WebPreviewSessionInfo[];
    }
  }, [deviceId, projectId, workspaceId]);

  const startSession = useCallback(async () => {
    if (!workspaceId || !deviceId || !projectId) {
      setError('Selecione um Mac e um projeto');
      return;
    }
    setLoading(true);
    setError(null);
    setSessionMessage('Abrindo túnel do front…');
    try {
      const result = await runPreviewCommand(
        'preview_start',
        {
          workspaceId,
          deviceId,
          projectId,
          payload: {},
        },
        90000,
      );
      const session = parseSession(result);
      applySession(session);
      setIframeKey((value) => value + 1);
      await refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSessionState('error');
    } finally {
      setLoading(false);
    }
  }, [applySession, deviceId, projectId, refreshSessions, workspaceId]);

  const attachSession = useCallback(
    async (targetSessionId?: string) => {
      if (!workspaceId || !deviceId || !projectId) {
        return;
      }
      if (attachInFlightRef.current) {
        return;
      }
      attachInFlightRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const result = await runPreviewCommand(
          'preview_attach',
          {
            workspaceId,
            deviceId,
            projectId,
            payload: targetSessionId ? { session_id: targetSessionId } : {},
          },
          90000,
        );
        const session = parseSession(result);
        applySession(session);
        setIframeKey((value) => value + 1);
        await refreshSessions();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        attachInFlightRef.current = false;
        setLoading(false);
      }
    },
    [applySession, deviceId, projectId, refreshSessions, workspaceId],
  );

  const stopSession = useCallback(async () => {
    if (!workspaceId || !deviceId || !sessionId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await runPreviewCommand(
        'preview_stop',
        {
          workspaceId,
          deviceId,
          projectId,
          payload: { session_id: sessionId },
        },
        30000,
      );
      setSessionId(null);
      setPublicUrl(null);
      setSessionState('stopped');
      setSessionMessage(null);
      autoStartedRef.current = false;
      await refreshSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [deviceId, projectId, refreshSessions, sessionId, workspaceId]);

  const refreshIframe = useCallback(() => {
    setIframeKey((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      autoStartedRef.current = false;
      return;
    }
    if (!workspaceId || !deviceId || !projectId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const list = await refreshSessions();
      if (cancelled || !list) {
        return;
      }
      const forProject = list.filter(
        (item) => item.projectId === projectId || !item.projectId,
      );
      const running = forProject.find(
        (item) => item.state === 'running' && item.publicUrl && !item.sessionId.startsWith('detected:'),
      );
      if (running) {
        applySession(running);
        autoStartedRef.current = true;
        return;
      }
      const detected = forProject.find((item) => item.state === 'detected' && item.localUrl);
      if (detected) {
        setLocalUrl(detected.localUrl);
        setSessionState('detected');
      }
      if (!autoStartedRef.current && !attachInFlightRef.current) {
        autoStartedRef.current = true;
        await attachSession();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySession, attachSession, deviceId, enabled, projectId, refreshSessions, workspaceId]);

  return {
    sessions,
    sessionId,
    publicUrl,
    localUrl,
    sessionState,
    sessionMessage,
    loading,
    error,
    iframeKey,
    startSession,
    attachSession,
    stopSession,
    refreshSessions,
    refreshIframe,
  };
}
