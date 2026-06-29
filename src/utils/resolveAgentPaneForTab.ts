import type { AgentTab, Project, Tab, TabBarItem, TerminalTab } from '@/types';
import { isAgentPaneTab } from '@/utils/agentTabHelpers';
import { resolvePaneAgentCommand } from '@/utils/projectAgentStatus';
import { getPanesFromItem, isSplitTab, resolveActiveTabBarItem } from '@/utils/tabGroups';

function isCursorAgentTerminalPane(
  pane: TerminalTab,
  activeAgentByPane: Record<string, string | null>,
): boolean {
  const command = resolvePaneAgentCommand(pane, activeAgentByPane);

  return command === 'cursor-agent' || pane.agent === 'cursor';
}

export function tabHasAgentSession(
  tab: TabBarItem,
  activeAgentByPane: Record<string, string | null>,
): boolean {
  return getPanesFromItem(tab).some((pane) => {
    if (isAgentPaneTab(pane)) {
      return true;
    }

    if (pane.type !== 'terminal') {
      return false;
    }

    return isCursorAgentTerminalPane(pane, activeAgentByPane);
  });
}

const DEFAULT_TERMINAL_TITLE = /^(Terminal|Agent) (\d+)$/;

export function resolveTabDisplayTitle(
  tab: TabBarItem,
  activeAgentByPane: Record<string, string | null>,
): string {
  const match = tab.title.match(DEFAULT_TERMINAL_TITLE);

  if (!match) {
    return tab.title;
  }

  const number = match[2];
  const isCursorAgent = getPanesFromItem(tab).some((pane) => {
    if (isAgentPaneTab(pane)) {
      return true;
    }

    if (pane.type !== 'terminal') {
      return false;
    }

    return resolvePaneAgentCommand(pane, activeAgentByPane) === 'cursor-agent';
  });

  return isCursorAgent ? `Agent ${number}` : `Terminal ${number}`;
}

function isAgentTerminalPane(
  pane: TerminalTab,
  activeAgentByPane: Record<string, string | null>,
): boolean {
  return isCursorAgentTerminalPane(pane, activeAgentByPane);
}

function isAgentPane(
  pane: Tab,
  activeAgentByPane: Record<string, string | null>,
): pane is AgentTab | TerminalTab {
  if (isAgentPaneTab(pane)) {
    return true;
  }

  if (pane.type !== 'terminal') {
    return false;
  }

  return isAgentTerminalPane(pane, activeAgentByPane);
}

export function resolveAgentPaneForTab(
  tab: TabBarItem,
  project: Project,
  activeAgentByPane: Record<string, string | null>,
): AgentTab | TerminalTab | null {
  const agentPanes = getPanesFromItem(tab).filter((pane): pane is AgentTab | TerminalTab =>
    isAgentPane(pane, activeAgentByPane),
  );

  if (agentPanes.length === 0) {
    return null;
  }

  const activeItem = resolveActiveTabBarItem(project.tabs, project.activeTabId);

  if (activeItem?.id === tab.id) {
    const activePaneId = isSplitTab(tab)
      ? (project.activePaneId ?? tab.activePaneId)
      : project.activePaneId;

    if (activePaneId) {
      const activePane = agentPanes.find((pane) => pane.id === activePaneId);

      if (activePane) {
        return activePane;
      }
    }
  }

  return agentPanes[0] ?? null;
}
