import { extractCliAgentCommand } from '@/constants/cliAgentCommands';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import type { Project } from '@/types';
import { resolveAgentTabCli } from '@/utils/agentTabHelpers';
import { collectProjectPanes } from '@/utils/tabGroups';

export function hydrateTerminalSessionFromProjects(projects: Project[]): void {
  const lastRestartCommands: Record<string, string> = {};
  const activeAgentByPane: Record<string, string | null> = {};
  const activeAgentSinceByPane: Record<string, number> = {};
  const pendingLaunchCommands: Record<string, string> = {};

  for (const project of projects) {
    for (const pane of collectProjectPanes(project.tabs)) {
      if (pane.type === 'agent') {
        const cliAgent = resolveAgentTabCli(pane);
        activeAgentByPane[pane.id] = cliAgent;
        activeAgentSinceByPane[pane.id] = Date.now();
        continue;
      }

      if (pane.type !== 'terminal') {
        continue;
      }

      if (pane.lastCommand) {
        lastRestartCommands[pane.id] = pane.lastCommand;
      }

      if (pane.restoreCommand) {
        pendingLaunchCommands[pane.id] = pane.restoreCommand;

        const agentCommand = extractCliAgentCommand(pane.restoreCommand);

        if (agentCommand) {
          activeAgentByPane[pane.id] = agentCommand;
          activeAgentSinceByPane[pane.id] = Date.now();
        }
      }
    }
  }

  useTerminalSessionStore.setState({
    lastRestartCommands,
    activeAgentByPane,
    activeAgentSinceByPane,
    pendingLaunchCommands,
    lastAgentCommand: Object.values(activeAgentByPane).find(Boolean) ?? null,
    awaitingResponseByPane: {},
    agentNotifyEligibleByPane: {},
    agentBusyByPane: {},
  });
}

export function restoreActiveAgentsFromProjects(projects: Project[]): void {
  useTerminalSessionStore.setState((state) => {
    const activeAgentByPane = { ...state.activeAgentByPane };
    const activeAgentSinceByPane = { ...state.activeAgentSinceByPane };

    for (const project of projects) {
      for (const pane of collectProjectPanes(project.tabs)) {
        if (pane.type === 'agent') {
          activeAgentByPane[pane.id] = resolveAgentTabCli(pane);
          activeAgentSinceByPane[pane.id] = state.activeAgentSinceByPane[pane.id] ?? Date.now();
          continue;
        }

        if (pane.type !== 'terminal' || !pane.restoreCommand) {
          continue;
        }

        const agentCommand = extractCliAgentCommand(pane.restoreCommand);

        if (!agentCommand) {
          continue;
        }

        activeAgentByPane[pane.id] = agentCommand;
        activeAgentSinceByPane[pane.id] = state.activeAgentSinceByPane[pane.id] ?? Date.now();
      }
    }

    return {
      activeAgentByPane,
      activeAgentSinceByPane,
      lastAgentCommand: Object.values(activeAgentByPane).find(Boolean) ?? state.lastAgentCommand,
    };
  });
}
