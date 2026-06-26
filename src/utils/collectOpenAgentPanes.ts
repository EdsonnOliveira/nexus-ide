import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import type { Project, Tab } from '@/types';
import { resolvePaneAgentCommand } from '@/utils/projectAgentStatus';
import { collectProjectPanes } from '@/utils/tabGroups';
import { resolveTabBadgeColor } from '@/utils/tabBadge';

export interface OpenAgentPaneEntry {
  pane: Tab;
  paneTitle: string;
  badgeIndex: number;
  badgeColor: string;
}

export function collectOpenAgentPanes(project: Project): OpenAgentPaneEntry[] {
  const activeAgentByPane = useTerminalSessionStore.getState().activeAgentByPane;
  const panes = collectProjectPanes(project.tabs);
  const entries: OpenAgentPaneEntry[] = [];

  panes.forEach((pane, index) => {
    if (!resolvePaneAgentCommand(pane, activeAgentByPane)) {
      return;
    }

    entries.push({
      pane,
      paneTitle: pane.title,
      badgeIndex: index + 1,
      badgeColor: resolveTabBadgeColor(pane, index),
    });
  });

  return entries;
}

export function collectOpenTerminalPanes(project: Project): OpenAgentPaneEntry[] {
  const activeAgentByPane = useTerminalSessionStore.getState().activeAgentByPane;
  const panes = collectProjectPanes(project.tabs);
  const entries: OpenAgentPaneEntry[] = [];

  panes.forEach((pane, index) => {
    if (pane.type !== 'terminal') {
      return;
    }

    if (resolvePaneAgentCommand(pane, activeAgentByPane)) {
      return;
    }

    entries.push({
      pane,
      paneTitle: pane.title,
      badgeIndex: index + 1,
      badgeColor: resolveTabBadgeColor(pane, index),
    });
  });

  return entries;
}
