import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import type { Project } from '@/types';
import { flushAgentGitGroupsForLeavingProject } from '@/utils/persistAgentGitGroups';
import {
  flushPendingTerminalSessionsToDisk,
  saveScrollbacksForProject,
} from '@/utils/persistTerminalSession';

let projectSwitchInFlight = false;

export function isProjectSwitching(): boolean {
  return projectSwitchInFlight;
}

export function beginProjectSwitch(): boolean {
  if (projectSwitchInFlight) {
    return false;
  }

  projectSwitchInFlight = true;
  return true;
}

export async function endProjectSwitch(): Promise<void> {
  if (!projectSwitchInFlight) {
    return;
  }

  projectSwitchInFlight = false;
  void import('@/utils/agentGitTurn').then(({ drainDeferredAgentGitTurns }) =>
    drainDeferredAgentGitTurns(),
  );
}

export function countBusyAgentPanes(): number {
  const session = useTerminalSessionStore.getState();
  const counted = new Set<string>();

  for (const [paneId, busy] of Object.entries(session.agentBusyByPane)) {
    if (busy) {
      counted.add(paneId);
    }
  }

  for (const [paneId, awaiting] of Object.entries(session.awaitingResponseByPane)) {
    if (awaiting) {
      counted.add(paneId);
    }
  }

  return counted.size;
}

export function persistLeavingProjectState(projects: Project[], leavingProjectId: string): void {
  const leavingProject = projects.find((project) => project.id === leavingProjectId);

  if (!leavingProject) {
    return;
  }

  void (async () => {
    try {
      await flushPendingTerminalSessionsToDisk(projects);
      await Promise.all([
        saveScrollbacksForProject(leavingProject),
        flushAgentGitGroupsForLeavingProject(leavingProjectId, projects),
      ]);
      await window.nexus.projects.update(leavingProject.id, {
        tabs: leavingProject.tabs,
        activeTabId: leavingProject.activeTabId,
        activePaneId: leavingProject.activePaneId,
      });
    } catch (error) {
      console.error('[project-switch] background persist failed', {
        leavingProjectId,
        error,
      });
    }
  })();
}
