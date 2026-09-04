import { useEffect, useRef } from 'react';
import { useWebStore, type WebAgentSession } from '../store';
import { notifyWebAgentFinished } from './webAgentNotify';

function resolveNotifyKey(agent: WebAgentSession): string {
  const lastTurn = agent.turns[agent.turns.length - 1];
  const executionId = lastTurn?.id ?? agent.commandId ?? agent.id;
  const outcome = agent.status === 'error' ? 'failed' : 'completed';
  return `${agent.id}:${executionId}:${outcome}`;
}

export function useWebAgentCompletionNotify(openAgentId: string | null): void {
  const agents = useWebStore((state) => state.agents);
  const userId = useWebStore((state) => state.user?.id ?? null);
  const markAgentReady = useWebStore((state) => state.markAgentReady);
  const clearAgentNotification = useWebStore((state) => state.clearAgentNotification);
  const previousStatusRef = useRef<Map<string, WebAgentSession['status']> | null>(null);
  const notifiedKeysRef = useRef(new Set<string>());

  useEffect(() => {
    if (openAgentId) {
      clearAgentNotification(openAgentId);
    }
  }, [clearAgentNotification, openAgentId]);

  useEffect(() => {
    const previous = previousStatusRef.current;
    const next = new Map(agents.map((agent) => [agent.id, agent.status]));

    if (!previous) {
      previousStatusRef.current = next;
      return;
    }

    for (const agent of agents) {
      if (agent.source === 'desktop_pane') {
        continue;
      }
      const was = previous.get(agent.id);
      const is = agent.status;
      if (is === 'running') {
        if (was !== 'running') {
          clearAgentNotification(agent.id);
        }
        continue;
      }
      if (was !== 'running') {
        continue;
      }
      if (openAgentId === agent.id) {
        continue;
      }
      const notifyKey = resolveNotifyKey(agent);
      if (notifiedKeysRef.current.has(notifyKey)) {
        continue;
      }
      notifiedKeysRef.current.add(notifyKey);
      markAgentReady(agent.id);
      notifyWebAgentFinished(agent, userId);
    }

    previousStatusRef.current = next;
  }, [agents, clearAgentNotification, markAgentReady, openAgentId, userId]);
}
