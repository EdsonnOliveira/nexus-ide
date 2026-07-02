import type { SplitLayoutNode, SplitTab, Tab, TabBarItem } from '@/types';
import { migrateLegacyAgentTerminalTab, isLegacyAgentTerminalTab, resolveAgentPaneRootPath } from '@/utils/agentTabHelpers';
import { migrateMessagesToTurns } from '@/utils/agentTranscriptParser';
import { sanitizeAgentTurnHistory } from '@/utils/trimAgentTurnHistory';
import { getVisibleTabIds } from '@/utils/splitLayout';
import { ensureTabBarBadgeColorIndexes } from '@/utils/tabBadge';
import { reconcileSplitLayout } from '@/utils/tabGroups';

export function migrateLegacyProjectTabs(
  tabs: TabBarItem[],
  layout: SplitLayoutNode | null | undefined,
  activeTabId: string | null,
  projectPath?: string,
): { tabs: TabBarItem[]; activeTabId: string | null; activePaneId: string | null } {
  const normalizedTabs = ensureTabBarBadgeColorIndexes(
    tabs.map((tab) => normalizeTabBarItem(tab, projectPath)),
  );

  if (!layout) {
    return {
      tabs: normalizedTabs,
      activeTabId,
      activePaneId: null,
    };
  }

  const paneIds = getVisibleTabIds(layout);

  if (paneIds.length <= 1) {
    return {
      tabs: normalizedTabs,
      activeTabId,
      activePaneId: null,
    };
  }

  const panes: Tab[] = [];
  const remaining: TabBarItem[] = [];

  for (const item of normalizedTabs) {
    if (
      (item.type === 'terminal' ||
        item.type === 'agent' ||
        item.type === 'browser' ||
        item.type === 'emulator' ||
        item.type === 'api') &&
      paneIds.includes(item.id)
    ) {
      panes.push(item);
      continue;
    }

    remaining.push(item);
  }

  if (panes.length <= 1) {
    return {
      tabs: normalizedTabs,
      activeTabId,
      activePaneId: null,
    };
  }

  const splitTab: SplitTab = {
    id: crypto.randomUUID(),
    title: panes[0]?.title ?? 'Agrupado',
    type: 'split',
    layout,
    activePaneId:
      activeTabId && paneIds.includes(activeTabId) ? activeTabId : (panes[0]?.id ?? null),
    panes,
    badgeColorIndex: panes[0]?.badgeColorIndex,
  };

  return {
    tabs: ensureTabBarBadgeColorIndexes([...remaining, splitTab]),
    activeTabId: splitTab.id,
    activePaneId: splitTab.activePaneId,
  };
}

function normalizeTabBarItem(tab: TabBarItem, projectPath?: string): TabBarItem {
  if (tab.type === 'split') {
    const panes = tab.panes.map((pane) => normalizePane(pane, projectPath));
    const layout = reconcileSplitLayout(panes, tab.layout);

    return {
      ...tab,
      panes,
      layout,
      activePaneId: tab.activePaneId ?? panes[0]?.id ?? null,
    };
  }

  if (
    tab.type === 'browser' ||
    tab.type === 'terminal' ||
    tab.type === 'agent' ||
    tab.type === 'emulator' ||
    tab.type === 'api'
  ) {
    return normalizePane(tab, projectPath);
  }

  if (tab.type === 'file') {
    return normalizePane(tab, projectPath);
  }

  return normalizePane(tab as Tab, projectPath);
}

function normalizePane(tab: Tab, projectPath?: string): Tab {
  if (tab.type === 'agent') {
    const legacyMessages = tab.messages ?? [];
    const rawTurns =
      tab.turns && tab.turns.length > 0
        ? tab.turns
        : legacyMessages.length > 0
          ? migrateMessagesToTurns(legacyMessages)
          : [];
    const turns = sanitizeAgentTurnHistory(rawTurns);

    return {
      ...tab,
      turns,
      messages: [],
      cliAgent: tab.cliAgent ?? 'cursor-agent',
      ptyId: null,
      ...(projectPath ? { workingDirectory: resolveAgentPaneRootPath(projectPath) } : {}),
    };
  }

  if (tab.type === 'terminal') {
    if (isLegacyAgentTerminalTab(tab)) {
      return migrateLegacyAgentTerminalTab(tab);
    }

    return {
      ...tab,
      ptyId: null,
      agent: tab.agent ?? 'shell',
    };
  }

  if (tab.type === 'browser') {
    return {
      ...tab,
      url: tab.url ?? 'https://www.google.com',
    };
  }

  if (tab.type === 'file') {
    return {
      ...tab,
      viewMode: tab.viewMode ?? 'code',
    };
  }

  if (tab.type === 'emulator') {
    return {
      ...tab,
      platform: tab.platform ?? 'android',
      deviceId: tab.deviceId ?? null,
      sessionId: null,
    };
  }

  if (tab.type === 'api') {
    return {
      ...tab,
      requestId: tab.requestId ?? null,
      collectionId: tab.collectionId ?? null,
    };
  }

  return tab;
}
