import { extractCliAgentCommand } from '@/constants/cliAgentCommands';
import type { Project, Tab } from '@/types';
import { collectProjectPanes, findPaneTab } from '@/utils/tabGroups';

export function resolvePaneAgentCommand(
  pane: Tab,
  activeAgentByPane: Record<string, string | null>,
): string | null {
  if (pane.type !== 'terminal') {
    return null;
  }

  if (pane.agent !== 'shell') {
    return pane.agent;
  }

  const fromRestore = pane.restoreCommand ? extractCliAgentCommand(pane.restoreCommand) : null;

  return fromRestore ?? activeAgentByPane[pane.id] ?? null;
}

export function resolvePaneAgentForGitTurn(
  paneId: string,
  projects: Project[],
  activeAgentByPane: Record<string, string | null>,
): string | null {
  const stored = activeAgentByPane[paneId];

  if (stored) {
    return stored;
  }

  for (const project of projects) {
    const pane = findPaneTab(project.tabs, paneId);

    if (!pane) {
      continue;
    }

    const resolved = resolvePaneAgentCommand(pane, activeAgentByPane);

    if (resolved) {
      return resolved;
    }
  }

  return null;
}

export function hasLaunchedAgentCli(
  pane: Tab,
  activeAgentByPane: Record<string, string | null>,
): boolean {
  if (pane.type !== 'terminal') {
    return false;
  }

  if (activeAgentByPane[pane.id]) {
    return true;
  }

  return Boolean(pane.restoreCommand && extractCliAgentCommand(pane.restoreCommand));
}

export function shouldMarkAgentAwaiting(
  paneId: string,
  command: string,
  activeAgentByPane: Record<string, string | null>,
): boolean {
  if (extractCliAgentCommand(command)) {
    return true;
  }

  return Boolean(activeAgentByPane[paneId]);
}

export function isPaneAgentLoading(
  pane: Tab,
  awaitingResponseByPane: Record<string, boolean>,
  activeAgentByPane: Record<string, string | null>,
  agentBusyByPane: Record<string, boolean>,
): boolean {
  if (!hasLaunchedAgentCli(pane, activeAgentByPane)) {
    return false;
  }

  return Boolean(awaitingResponseByPane[pane.id] || agentBusyByPane[pane.id]);
}

function isPaneAgentRunning(
  pane: Tab,
  awaitingResponseByPane: Record<string, boolean>,
  activeAgentByPane: Record<string, string | null>,
  agentBusyByPane: Record<string, boolean>,
): boolean {
  return isPaneAgentLoading(pane, awaitingResponseByPane, activeAgentByPane, agentBusyByPane);
}

export function buildRunningAgentProjectIdSet(
  projects: Project[],
  awaitingResponseByPane: Record<string, boolean>,
  activeAgentByPane: Record<string, string | null>,
  agentBusyByPane: Record<string, boolean>,
): Set<string> {
  const runningProjectIds = new Set<string>();

  for (const project of projects) {
    for (const pane of collectProjectPanes(project.tabs)) {
      if (isPaneAgentRunning(pane, awaitingResponseByPane, activeAgentByPane, agentBusyByPane)) {
        runningProjectIds.add(project.id);
        break;
      }
    }
  }

  return runningProjectIds;
}
