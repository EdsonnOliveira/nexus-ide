import type { AgentTurn, Project } from '@/types';
import { readHomeAgentMap } from '@/utils/homeDashboardAgents';
import { isAgentTurnActivelyRunning } from '@/utils/projectAgentStatus';
import { collectProjectPanes, findPaneTab } from '@/utils/tabGroups';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';

function turnHasResponse(turn: AgentTurn): boolean {
  return turn.activities.some((entry) => entry.kind === 'response');
}

export interface PaneAgentSessionSnapshot {
  agentPrintRunTokenByPane: Record<string, string>;
  agentBusyByPane: Record<string, boolean>;
  awaitingResponseByPane: Record<string, boolean>;
}

export function isPaneAgentSessionLive(
  paneId: string,
  session: PaneAgentSessionSnapshot,
): boolean {
  return Boolean(
    session.agentPrintRunTokenByPane[paneId] ||
      session.agentBusyByPane[paneId] ||
      session.awaitingResponseByPane[paneId],
  );
}

export function readPaneAgentSessionSnapshot(): PaneAgentSessionSnapshot {
  const session = useTerminalSessionStore.getState();

  return {
    agentPrintRunTokenByPane: session.agentPrintRunTokenByPane,
    agentBusyByPane: session.agentBusyByPane,
    awaitingResponseByPane: session.awaitingResponseByPane,
  };
}

export function shouldPreferLocalAgentTurnHistory(
  localTurns: AgentTurn[],
  incomingTurns: AgentTurn[],
): boolean {
  if (localTurns.length === 0) {
    return false;
  }

  if (incomingTurns.length === 0) {
    return false;
  }

  const localRunning = localTurns.some((turn) => turn.running);
  const incomingRunning = incomingTurns.some((turn) => turn.running);

  if (!localRunning && incomingRunning) {
    return true;
  }

  if (localRunning && !incomingRunning && localTurns.length >= incomingTurns.length) {
    return true;
  }

  const localLatest = localTurns[localTurns.length - 1];
  const incomingLatest = incomingTurns[incomingTurns.length - 1];

  if (!localLatest || !incomingLatest || localLatest.id !== incomingLatest.id) {
    return false;
  }

  const localCompletedAt = localLatest.completedAt ?? 0;
  const incomingCompletedAt = incomingLatest.completedAt ?? 0;

  if (localCompletedAt > incomingCompletedAt) {
    return true;
  }

  if (
    localCompletedAt === incomingCompletedAt &&
    localLatest.activities.length > incomingLatest.activities.length
  ) {
    return true;
  }

  if (turnHasResponse(localLatest) && !turnHasResponse(incomingLatest)) {
    return true;
  }

  const localHasPlan = localLatest.activities.some(
    (entry) => entry.kind === 'plan' && entry.planStatus === 'pending',
  );
  const incomingHasPlan = incomingLatest.activities.some(
    (entry) => entry.kind === 'plan' && entry.planStatus === 'pending',
  );

  if (localHasPlan && !incomingHasPlan) {
    return true;
  }

  return false;
}

export function projectHasLiveAgentSession(
  project: Project,
  session: PaneAgentSessionSnapshot,
): boolean {
  for (const pane of collectProjectPanes(project.tabs)) {
    if (pane.type !== 'agent') {
      continue;
    }

    if (pane.turns?.some((turn) => isAgentTurnActivelyRunning(turn))) {
      return true;
    }

    if (isPaneAgentSessionLive(pane.id, session)) {
      return true;
    }
  }

  return false;
}

const MAX_HOSTED_PROJECTS = 10;

export function resolveHostedAgentProjects(
  projects: Project[],
  activeProjectId: string | null,
  session: PaneAgentSessionSnapshot,
): Project[] {
  const essentialIds = new Set<string>();
  const homeOnlyIds = new Set<string>();

  if (activeProjectId) {
    const activeProject = projects.find((project) => project.id === activeProjectId);

    if (activeProject) {
      essentialIds.add(activeProject.id);
    }
  }

  const homeAgentMap = activeProjectId === null ? readHomeAgentMap() : null;

  for (const project of projects) {
    if (project.id === activeProjectId) {
      continue;
    }

    if (projectHasLiveAgentSession(project, session)) {
      essentialIds.add(project.id);
      continue;
    }

    if (!homeAgentMap) {
      continue;
    }

    const homePaneIds = homeAgentMap[project.id] ?? [];

    if (
      homePaneIds.some((homePaneId) => findPaneTab(project.tabs, homePaneId)?.type === 'agent')
    ) {
      homeOnlyIds.add(project.id);
    }
  }

  const hostedIds = new Set(essentialIds);
  const remainingSlots = Math.max(0, MAX_HOSTED_PROJECTS - essentialIds.size);

  if (remainingSlots > 0 && homeOnlyIds.size > 0) {
    let added = 0;

    for (const project of projects) {
      if (added >= remainingSlots) {
        break;
      }

      if (homeOnlyIds.has(project.id)) {
        hostedIds.add(project.id);
        added += 1;
      }
    }
  }

  return projects
    .filter((project) => hostedIds.has(project.id))
    .sort((left, right) => left.id.localeCompare(right.id));
}
