import { DEFAULT_CLI_AGENT_COMMAND, extractCliAgentCommand } from '@/constants/cliAgentCommands';
import type { AgentTab, Tab, TerminalAgent, TerminalTab } from '@/types';

export function terminalAgentToCli(agent: TerminalAgent): string {
  if (agent === 'claude') {
    return 'claude';
  }

  if (agent === 'composer') {
    return 'cursor-agent';
  }

  if (agent === 'cursor') {
    return 'cursor-agent';
  }

  return DEFAULT_CLI_AGENT_COMMAND;
}

export function cliAgentToTerminalAgent(cliAgent: string): TerminalAgent {
  const base = cliAgent.trim().split(/\s+/)[0] ?? DEFAULT_CLI_AGENT_COMMAND;

  if (base === 'claude') {
    return 'claude';
  }

  if (base === 'composer') {
    return 'composer';
  }

  return 'cursor';
}

export function isAgentPaneTab(tab: Tab): tab is AgentTab {
  return tab.type === 'agent';
}

export function isLegacyAgentTerminalTab(tab: Tab): boolean {
  if (tab.type !== 'terminal') {
    return false;
  }

  if (tab.agent !== 'shell') {
    return true;
  }

  return Boolean(tab.restoreCommand && extractCliAgentCommand(tab.restoreCommand));
}

export function resolveAgentPaneRootPath(projectPath: string): string {
  const trimmed = projectPath.trim();

  if (!trimmed) {
    return projectPath;
  }

  return trimmed.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function migrateLegacyAgentTerminalTab(tab: TerminalTab): AgentTab {
  const cliFromRestore = tab.restoreCommand ? extractCliAgentCommand(tab.restoreCommand) : null;
  const cliAgent = cliFromRestore ?? terminalAgentToCli(tab.agent);

  return {
    id: tab.id,
    title: tab.title,
    type: 'agent',
    cliAgent,
    ptyId: null,
    messages: [],
    turns: [],
    restoreCommand: tab.restoreCommand ?? cliAgent,
    workingDirectory: null,
    pinned: tab.pinned,
    badgeColorIndex: tab.badgeColorIndex,
  };
}

export function resolveAgentTabCli(tab: AgentTab): string {
  const fromRestore = tab.restoreCommand ? extractCliAgentCommand(tab.restoreCommand) : null;

  return fromRestore ?? tab.cliAgent ?? DEFAULT_CLI_AGENT_COMMAND;
}
