import type { AgentTurn } from '@/types';
import { useAgentShellTerminalStore } from '@/stores/useAgentShellTerminalStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { getAgentPaneLiveTranscript } from '@/utils/agentPaneRegistry';
import { readHomeAgentQueue } from '@/utils/homeDashboardAgents';
import { collectProjectPanes, findPaneTab } from '@/utils/tabGroups';

export function findProjectIdByPaneId(paneId: string): string | null {
  const { projects } = useProjectStore.getState();

  for (const project of projects) {
    for (const pane of collectProjectPanes(project.tabs)) {
      if (pane.id === paneId) {
        return project.id;
      }
    }
  }

  const homeBinding = readHomeAgentQueue().find((item) => item.paneId === paneId);
  if (homeBinding && projects.some((project) => project.id === homeBinding.projectId)) {
    return homeBinding.projectId;
  }

  return null;
}

export function resolveAgentFinishProject(input: {
  projectId: string;
  paneId?: string;
  fallbackName?: string;
  fallbackLogo?: string | null;
  projectPath?: string | null;
}): { projectId: string; projectName: string; projectLogo: string | null } {
  const { projects } = useProjectStore.getState();

  const toResult = (project: { id: string; name: string; logo?: string | null }) => ({
    projectId: project.id,
    projectName: project.name.trim(),
    projectLogo: project.logo?.trim() || null,
  });

  if (input.paneId) {
    const homeBinding = readHomeAgentQueue().find((item) => item.paneId === input.paneId);
    if (homeBinding) {
      const homeProject = projects.find((item) => item.id === homeBinding.projectId);
      if (homeProject?.name.trim()) {
        return toResult(homeProject);
      }
    }

    const paneProjectId = findProjectIdByPaneId(input.paneId);
    if (paneProjectId) {
      const paneProject = projects.find((item) => item.id === paneProjectId);
      if (paneProject?.name.trim()) {
        return toResult(paneProject);
      }
    }
  }

  if (input.projectId) {
    const given = projects.find((item) => item.id === input.projectId);
    if (given?.name.trim()) {
      return toResult(given);
    }
  }

  const projectPath = input.projectPath?.trim();
  if (projectPath) {
    const byPath = projects.find((item) => item.path === projectPath);
    if (byPath?.name.trim()) {
      return toResult(byPath);
    }
  }

  return {
    projectId: input.projectId,
    projectName: input.fallbackName?.trim() || 'Projeto',
    projectLogo: input.fallbackLogo?.trim() || null,
  };
}

export function findAgentPaneLatestTurn(paneId: string): AgentTurn | null {
  const live = getAgentPaneLiveTranscript(paneId);
  const liveLatest = live?.turns[live.turns.length - 1];
  if (liveLatest) {
    return liveLatest;
  }

  const { projects } = useProjectStore.getState();
  for (const project of projects) {
    const pane = findPaneTab(project.tabs, paneId);
    if (pane?.type === 'agent') {
      return pane.turns[pane.turns.length - 1] ?? null;
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
