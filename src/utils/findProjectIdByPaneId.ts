import { useAgentShellTerminalStore } from '@/stores/useAgentShellTerminalStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { collectProjectPanes } from '@/utils/tabGroups';

export function findProjectIdByPaneId(paneId: string): string | null {
  const { projects } = useProjectStore.getState();

  for (const project of projects) {
    for (const pane of collectProjectPanes(project.tabs)) {
      if (pane.id === paneId) {
        return project.id;
      }
    }
  }

  return null;
}

export function findProjectIdByPtyId(ptyId: string): string | null {
  if (!ptyId) {
    return null;
  }

  const { projects } = useProjectStore.getState();

  for (const project of projects) {
    for (const pane of collectProjectPanes(project.tabs)) {
      if ('ptyId' in pane && pane.ptyId === ptyId) {
        return project.id;
      }
    }
  }

  const { entriesByAgentPane } = useAgentShellTerminalStore.getState();

  for (const [agentPaneId, entries] of Object.entries(entriesByAgentPane)) {
    if (entries.some((entry) => entry.ptyId === ptyId)) {
      return findProjectIdByPaneId(agentPaneId);
    }
  }

  return null;
}
