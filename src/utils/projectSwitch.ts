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
      // #region agent log
      fetch('http://127.0.0.1:7573/ingest/667eb7be-70f4-44cb-a19a-5ae8dc0f89e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f47fa1'},body:JSON.stringify({sessionId:'f47fa1',location:'projectSwitch.ts:beginProjectSwitch',message:'switch denied in flight',data:{ageMs:Date.now()-projectSwitchStartedAt},timestamp:Date.now(),hypothesisId:'H3',runId:'pre-fix'})}).catch(()=>{});
      // #endregion
      return false;
    }

    projectSwitchInFlight = false;
  }

  projectSwitchInFlight = true;
  projectSwitchStartedAt = Date.now();
  // #region agent log
  fetch('http://127.0.0.1:7573/ingest/667eb7be-70f4-44cb-a19a-5ae8dc0f89e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f47fa1'},body:JSON.stringify({sessionId:'f47fa1',location:'projectSwitch.ts:beginProjectSwitch',message:'switch allowed',data:{},timestamp:Date.now(),hypothesisId:'H3',runId:'pre-fix'})}).catch(()=>{});
  // #endregion
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
      ] = await Promise.all([
        import('@/utils/persistTerminalSession'),
        import('@/utils/persistAgentGitGroups'),
      ]);

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
