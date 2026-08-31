import { useEffect, useRef } from 'react';
import { useWebStore, type WebAgentSession } from '../store';
import { notifyWebAgentFinished } from './webAgentNotify';

export function useWebAgentCompletionNotify(openAgentId: string | null): void {
  const agents = useWebStore((state) => state.agents);
  const userId = useWebStore((state) => state.user?.id ?? null);
  const markAgentReady = useWebStore((state) => state.markAgentReady);
  const clearAgentNotification = useWebStore((state) => state.clearAgentNotification);
  const previousStatusRef = useRef<Map<string, WebAgentSession['status']> | null>(null);

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
      markAgentReady(agent.id);
      notifyWebAgentFinished(agent, userId);
    }

    previousStatusRef.current = next;
  }, [agents, clearAgentNotification, markAgentReady, openAgentId, userId]);
}
