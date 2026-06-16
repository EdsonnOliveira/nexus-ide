import type { SplitLayoutNode, SplitTab, Tab, TabBarItem } from '@/types';
import { getVisibleTabIds } from '@/utils/splitLayout';
import { ensureTabBarBadgeColorIndexes } from '@/utils/tabBadge';

export function migrateLegacyProjectTabs(
  tabs: TabBarItem[],
  layout: SplitLayoutNode | null | undefined,
  activeTabId: string | null,
): { tabs: TabBarItem[]; activeTabId: string | null; activePaneId: string | null } {
  const normalizedTabs = ensureTabBarBadgeColorIndexes(
    tabs.map((tab) => normalizeTabBarItem(tab)),
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
    if ((item.type === 'terminal' || item.type === 'browser') && paneIds.includes(item.id)) {
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

function normalizeTabBarItem(tab: TabBarItem): TabBarItem {
  if (tab.type === 'split') {
    return {
      ...tab,
      panes: tab.panes.map((pane) => normalizePane(pane)),
      activePaneId: tab.activePaneId ?? tab.panes[0]?.id ?? null,
    };
  }

  if (tab.type === 'browser' || tab.type === 'terminal') {
    return normalizePane(tab);
  }

  if (tab.type === 'file') {
    return normalizePane(tab);
  }

  return normalizePane(tab as Tab);
}

function normalizePane(tab: Tab): Tab {
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

  return {
    ...tab,
    ptyId: null,
    agent: tab.agent ?? 'cursor',
  };
}
