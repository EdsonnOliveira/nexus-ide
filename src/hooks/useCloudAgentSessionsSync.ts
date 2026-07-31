import { useEffect, useRef } from 'react';
import { listOpenAgentSessionBundles, type AgentSessionBundle } from '@nexus/supabase';
import type { Unsubscribe } from '@nexus/protocol';
import { cloudBridge, cloudSupabase } from '@/lib/nexusCloud';
import { useCloudStore } from '@/stores/useCloudStore';
import { useCloudAgentSessionsStore } from '@/stores/useCloudAgentSessionsStore';
import { hydrateCloudAgentSessions } from '@/utils/hydrateCloudAgentSessions';
import {
  createCloudAgentStreamState,
  extractCloudAgentStreamChunk,
  feedCloudAgentStreamChunk,
  type CloudAgentStreamState,
} from '@/utils/cloudAgentStreamParser';

const ACTIVE_POLL_MS = 4000;
const IDLE_POLL_MS = 30_000;
const HIDDEN_POLL_MS = 120_000;

async function fetchOpenAgentSessionBundles(
  authenticated: boolean,
): Promise<AgentSessionBundle[]> {
  if (authenticated && cloudSupabase) {
    return listOpenAgentSessionBundles(cloudSupabase);
  }

  if (window.nexus?.cloud?.listOpenAgentSessions) {
    return window.nexus.cloud.listOpenAgentSessions();
  }

  return [];
}

export function useCloudAgentSessionsSync(active: boolean): void {
  const authenticated = useCloudStore((state) => state.authenticated);
  const runtimeOnline = useCloudStore((state) => state.runtimeOnline);
  const mergeSessions = useCloudAgentSessionsStore((state) => state.mergeSessions);
  const patchRunningTurn = useCloudAgentSessionsStore((state) => state.patchRunningTurn);
  const setSessionStatus = useCloudAgentSessionsStore((state) => state.setSessionStatus);
  const clearSessions = useCloudAgentSessionsStore((state) => state.clearSessions);

  const subscriptionsRef = useRef(new Map<string, Unsubscribe>());
  const parsersRef = useRef(new Map<string, CloudAgentStreamState>());

  useEffect(() => {
    if (!active) {
      return;
    }

    const canSync =
      (authenticated && Boolean(cloudSupabase)) ||
      runtimeOnline ||
      Boolean(window.nexus?.cloud?.listOpenAgentSessions);

    if (!canSync) {
      clearSessions();
      return;
    }

    let cancelled = false;
    let timer: number | null = null;
    let lastHasRunning = false;
    const bridge = cloudBridge;

    const unsubscribeSession = (sessionId: string) => {
      const unsubscribe = subscriptionsRef.current.get(sessionId);

      if (unsubscribe) {
        unsubscribe();
        subscriptionsRef.current.delete(sessionId);
      }

      parsersRef.current.delete(sessionId);
    };

    const subscribeRunningSession = (sessionId: string, commandId: string) => {
      if (!bridge || !authenticated || subscriptionsRef.current.has(sessionId) || !commandId) {
        return;
      }

      const parser = createCloudAgentStreamState();
      parsersRef.current.set(sessionId, parser);

      const unsubscribe = bridge.subscribeToExecution(commandId, (payload) => {
        const chunk = extractCloudAgentStreamChunk(payload);

        if (chunk) {
          const state = parsersRef.current.get(sessionId) ?? createCloudAgentStreamState();
          parsersRef.current.set(sessionId, state);
          const update = feedCloudAgentStreamChunk(state, chunk);
          patchRunningTurn(sessionId, {
            thought: update.thought,
            thoughtStreaming: update.thoughtStreaming,
            response: update.response,
          });

          if (update.done) {
            setSessionStatus(sessionId, 'done');
            unsubscribeSession(sessionId);
          }
        }

        const envelope = payload as { type?: string; payload?: { status?: string } };
        const type = envelope?.type ?? '';
        const status = envelope?.payload?.status ?? '';

        if (type === 'completed' || type === 'agent.completed' || status === 'completed') {
          setSessionStatus(sessionId, 'done');
          unsubscribeSession(sessionId);
        }

        if (type === 'failed' || type === 'agent.failed' || status === 'failed') {
          setSessionStatus(sessionId, 'error');
          unsubscribeSession(sessionId);
        }
      });

      subscriptionsRef.current.set(sessionId, unsubscribe);
    };

    const resolvePollDelay = (hasRunning: boolean) => {
      if (document.visibilityState === 'hidden') {
        return hasRunning ? IDLE_POLL_MS : HIDDEN_POLL_MS;
      }

      return hasRunning ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    };

    const scheduleNext = (hasRunning: boolean) => {
      if (cancelled) {
        return;
      }

      lastHasRunning = hasRunning;

      if (timer !== null) {
        window.clearTimeout(timer);
      }

      timer = window.setTimeout(() => {
        void poll();
      }, resolvePollDelay(hasRunning));
    };

    const poll = async () => {
      let hasRunning = false;

      try {
        const bundles = await fetchOpenAgentSessionBundles(authenticated);

        if (cancelled) {
          return;
        }

        const hydrated = hydrateCloudAgentSessions(bundles).filter(
          (session) => session.source !== 'desktop_pane',
        );
        const hydratedIds = new Set(hydrated.map((session) => session.id));

        for (const sessionId of Array.from(subscriptionsRef.current.keys())) {
          if (!hydratedIds.has(sessionId)) {
            unsubscribeSession(sessionId);
          }
        }

        mergeSessions(hydrated);

        for (const session of hydrated) {
          if (session.status === 'running') {
            hasRunning = true;
            subscribeRunningSession(session.id, session.commandId);
          } else {
            unsubscribeSession(session.id);
          }
        }
      } catch (error) {
        console.warn('[cloud-agents] falha ao sincronizar agents da web', error);
      }

      scheduleNext(hasRunning);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void poll();
        return;
      }

      scheduleNext(lastHasRunning);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    void poll();

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);

      if (timer !== null) {
        window.clearTimeout(timer);
      }

      for (const sessionId of Array.from(subscriptionsRef.current.keys())) {
        unsubscribeSession(sessionId);
      }
    };
  }, [
    active,
    authenticated,
    runtimeOnline,
    clearSessions,
    mergeSessions,
    patchRunningTurn,
    setSessionStatus,
  ]);
}
