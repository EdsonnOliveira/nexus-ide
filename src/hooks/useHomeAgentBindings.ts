import { useEffect, useMemo, useState } from 'react';
import {
  HOME_AGENT_CHANGE_EVENT,
  readHomeAgentQueue,
  type HomeAgentQueue,
} from '@/utils/homeDashboardAgents';

const EMPTY_HOME_BOUND_PANE_IDS: ReadonlySet<string> = new Set();

export function useHomeAgentQueue(): HomeAgentQueue {
  const [queue, setQueue] = useState(readHomeAgentQueue);

  useEffect(() => {
    const refresh = () => {
      setQueue(readHomeAgentQueue());
    };

    window.addEventListener(HOME_AGENT_CHANGE_EVENT, refresh);
    return () => {
      window.removeEventListener(HOME_AGENT_CHANGE_EVENT, refresh);
    };
  }, []);

  return queue;
}

export function useHomeBoundPaneIds(projectId: string | null): ReadonlySet<string> {
  const queue = useHomeAgentQueue();

  return useMemo(() => {
    if (!projectId) {
      return EMPTY_HOME_BOUND_PANE_IDS;
    }

    const paneIds = new Set<string>();

    for (const binding of queue) {
      if (binding.projectId === projectId) {
        paneIds.add(binding.paneId);
      }
    }

    return paneIds;
  }, [projectId, queue]);
}
