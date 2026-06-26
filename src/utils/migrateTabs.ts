import type { SplitLayoutNode, SplitTab, Tab, TabBarItem } from '@/types';
import { getVisibleTabIds } from '@/utils/splitLayout';
import { ensureTabBarBadgeColorIndexes } from '@/utils/tabBadge';
import { reconcileSplitLayout } from '@/utils/tabGroups';

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
    if (
      (item.type === 'terminal' ||
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

function normalizeTabBarItem(tab: TabBarItem): TabBarItem {
  if (tab.type === 'split') {
    const panes = tab.panes.map((pane) => normalizePane(pane));
    const layout = reconcileSplitLayout(panes, tab.layout);

    return {
      ...tab,
      panes,
      layout,
      activePaneId: tab.activePaneId ?? panes[0]?.id ?? null,
    };
  }

  if (tab.type === 'browser' || tab.type === 'terminal' || tab.type === 'emulator' || tab.type === 'api') {
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

  return {
    ...tab,
    ptyId: null,
    agent: tab.agent ?? 'cursor',
  };
}
