import type { Project } from '@/types';

let projectSwitchInFlight = false;
let projectSwitchStartedAt = 0;
const PROJECT_SWITCH_STALE_MS = 8000;

export function resetProjectSwitchState(): void {
  projectSwitchInFlight = false;
  projectSwitchStartedAt = 0;
}

export function isProjectSwitching(): boolean {
  return projectSwitchInFlight;
}

export function beginProjectSwitch(): boolean {
  if (projectSwitchInFlight) {
    if (Date.now() - projectSwitchStartedAt < PROJECT_SWITCH_STALE_MS) {
      return false;
    }

    projectSwitchInFlight = false;
  }

  projectSwitchInFlight = true;
  projectSwitchStartedAt = Date.now();
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

export async function countBusyAgentPanes(): Promise<number> {
  const { useTerminalSessionStore } = await import('@/stores/useTerminalSessionStore');
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
      const [
        { flushPendingTerminalSessionsToDisk, saveScrollbacksForProject },
        { flushAgentGitGroupsForLeavingProject },
        { useProjectStore },
      ] = await Promise.all([
        import('@/utils/persistTerminalSession'),
        import('@/utils/persistAgentGitGroups'),
        import('@/stores/useProjectStore'),
      ]);

      const latestProjects = useProjectStore.getState().projects;
      const latestLeavingProject =
        latestProjects.find((project) => project.id === leavingProjectId) ?? leavingProject;

      await flushPendingTerminalSessionsToDisk(latestProjects);
      await Promise.all([
        saveScrollbacksForProject(latestLeavingProject),
        flushAgentGitGroupsForLeavingProject(leavingProjectId, latestProjects),
      ]);
      await window.nexus.projects.update(latestLeavingProject.id, {
        tabs: latestLeavingProject.tabs,
        activeTabId: latestLeavingProject.activeTabId,
        activePaneId: latestLeavingProject.activePaneId,
      });
    } catch (error) {
      console.error('[project-switch] background persist failed', {
        leavingProjectId,
        error,
      });
    }
  })();
}
