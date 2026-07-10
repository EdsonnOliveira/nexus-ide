import { extractCliAgentCommand } from '@/constants/cliAgentCommands';
import type { AgentTurn, Project, Tab } from '@/types';
import { isAgentPaneTab, resolveAgentTabCli } from '@/utils/agentTabHelpers';
import { isAgentSetupCommand } from '@/utils/parseAgentModeCommand';
import { collectProjectPanes, findPaneTab } from '@/utils/tabGroups';

export function resolvePaneAgentCommand(
  pane: Tab,
  activeAgentByPane: Record<string, string | null>,
): string | null {
  if (pane.type === 'agent') {
    return resolveAgentTabCli(pane);
  }

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
  if (isAgentPaneTab(pane)) {
    return true;
  }

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
  if (isAgentSetupCommand(command)) {
    return false;
  }

  if (extractCliAgentCommand(command)) {
    return true;
  }

  return Boolean(activeAgentByPane[paneId]);
}

export function isAgentTurnActivelyRunning(turn: AgentTurn): boolean {
  if (!turn.running || turn.pendingFollowUp) {
    return false;
  }

  if (turn.completedAt) {
    return false;
  }

  return !turn.activities.some(
    (entry) =>
      entry.kind === 'response' &&
      entry.streaming !== true &&
      entry.label.trim().length > 0,
  );
}

export function isAgentPaneTabLoading(
  pane: Tab,
  pendingLaunchCommands: Record<string, string> = {},
  agentPrintRunTokenByPane: Record<string, string> = {},
): boolean {
  if (pane.type !== 'agent') {
    return false;
  }

  if ((pane.turns ?? []).some((turn) => isAgentTurnActivelyRunning(turn))) {
    return true;
  }

  if (!pane.ptyId && Boolean(pendingLaunchCommands[pane.id])) {
    return true;
  }

  return Boolean(agentPrintRunTokenByPane[pane.id]);
}

export function isPaneAgentLoading(
  pane: Tab,
  awaitingResponseByPane: Record<string, boolean>,
  activeAgentByPane: Record<string, string | null>,
  agentBusyByPane: Record<string, boolean>,
  agentPrintRunTokenByPane: Record<string, string> = {},
  pendingLaunchCommands: Record<string, string> = {},
): boolean {
  if (pane.type === 'agent') {
    return isAgentPaneTabLoading(pane, pendingLaunchCommands, agentPrintRunTokenByPane);
  }

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
  agentPrintRunTokenByPane: Record<string, string>,
  pendingLaunchCommands: Record<string, string>,
): boolean {
  return isPaneAgentLoading(
    pane,
    awaitingResponseByPane,
    activeAgentByPane,
    agentBusyByPane,
    agentPrintRunTokenByPane,
    pendingLaunchCommands,
  );
}

export function buildRunningAgentProjectIdSet(
  projects: Project[],
  awaitingResponseByPane: Record<string, boolean>,
  activeAgentByPane: Record<string, string | null>,
  agentBusyByPane: Record<string, boolean>,
  agentPrintRunTokenByPane: Record<string, string> = {},
  pendingLaunchCommands: Record<string, string> = {},
): Set<string> {
  const runningProjectIds = new Set<string>();

  for (const project of projects) {
    for (const pane of collectProjectPanes(project.tabs)) {
      if (
        isPaneAgentRunning(
          pane,
          awaitingResponseByPane,
          activeAgentByPane,
          agentBusyByPane,
          agentPrintRunTokenByPane,
          pendingLaunchCommands,
        )
      ) {
        runningProjectIds.add(project.id);
        break;
      }
    }
  }

  return runningProjectIds;
}
