import type { SplitLayoutNode, SplitTab, Tab, TabBarItem } from '@/types';
import { createTabLayout, getVisibleTabIds } from '@/utils/splitLayout';

export function isSplitTab(item: TabBarItem): item is SplitTab {
  return item.type === 'split';
}

export function isPaneTab(item: TabBarItem): item is Tab {
  return (
    item.type === 'terminal' ||
    item.type === 'browser' ||
    item.type === 'file' ||
    item.type === 'emulator' ||
    item.type === 'api'
  );
}

export function getPanesFromItem(item: TabBarItem): Tab[] {
  if (isSplitTab(item)) {
    return item.panes;
  }

  return [item];
}

export function getLayoutFromItem(item: TabBarItem): SplitLayoutNode {
  if (isSplitTab(item)) {
    return item.layout;
  }

  return createTabLayout(item.id);
}

function dedupePanes(panes: Tab[]): Tab[] {
  const seen = new Set<string>();

  return panes.filter((pane) => {
    if (seen.has(pane.id)) {
      return false;
    }

    seen.add(pane.id);
    return true;
  });
}

function mergeLayouts(
  targetLayout: SplitLayoutNode,
  sourceLayout: SplitLayoutNode,
  side: 'left' | 'right',
): SplitLayoutNode {
  if (side === 'left') {
    return {
      type: 'split',
      orientation: 'horizontal',
      left: sourceLayout,
      right: targetLayout,
      ratio: 0.5,
    };
  }

  return {
    type: 'split',
    orientation: 'horizontal',
    left: targetLayout,
    right: sourceLayout,
    ratio: 0.5,
  };
}

function buildSplitTabTitle(panes: Tab[], layout: SplitLayoutNode): string {
  const paneIds = getVisibleTabIds(layout);

  return paneIds
    .map((paneId) => panes.find((pane) => pane.id === paneId)?.title)
    .filter((title): title is string => Boolean(title))
    .join(' + ');
}

export function reconcileSplitLayout(panes: Tab[], layout: SplitLayoutNode): SplitLayoutNode {
  const paneIds = new Set(panes.map((pane) => pane.id));
  const layoutIds = getVisibleTabIds(layout);

  if (
    layoutIds.length === panes.length &&
    layoutIds.length > 0 &&
    layoutIds.every((paneId) => paneIds.has(paneId))
  ) {
    return layout;
  }

  if (panes.length === 0) {
    return layout;
  }

  if (panes.length === 1) {
    return createTabLayout(panes[0].id);
  }

  return panes.slice(1).reduce<SplitLayoutNode>(
    (left, pane) => ({
      type: 'split',
      orientation: 'horizontal',
      left,
      right: createTabLayout(pane.id),
      ratio: 0.5,
    }),
    createTabLayout(panes[0].id),
  );
}

export function mergeTabItems(
  tabs: TabBarItem[],
  sourceId: string,
  targetId: string,
  side: 'left' | 'right',
): { nextTabs: TabBarItem[]; activeTabId: string; activePaneId: string | null } {
  const sourceItem = tabs.find((item) => item.id === sourceId);
  const targetItem = tabs.find((item) => item.id === targetId);

  if (!sourceItem || !targetItem || sourceId === targetId) {
    return {
      nextTabs: tabs,
      activeTabId: sourceId,
      activePaneId: null,
    };
  }

  const sourcePanes = getPanesFromItem(sourceItem);
  const targetPanes = getPanesFromItem(targetItem);
  const mergedPanes = dedupePanes([...targetPanes, ...sourcePanes]);
  const mergedLayout = reconcileSplitLayout(
    mergedPanes,
    mergeLayouts(getLayoutFromItem(targetItem), getLayoutFromItem(sourceItem), side),
  );
  const activePaneId = sourcePanes[0]?.id ?? targetPanes[0]?.id ?? null;

  const splitTab: SplitTab = {
    id: isSplitTab(targetItem) ? targetItem.id : crypto.randomUUID(),
    title: buildSplitTabTitle(mergedPanes, mergedLayout),
    type: 'split',
    layout: mergedLayout,
    activePaneId,
    panes: mergedPanes,
    badgeColorIndex: targetItem.badgeColorIndex ?? sourceItem.badgeColorIndex,
    pinned: targetItem.pinned ?? sourceItem.pinned,
  };

  const nextTabs = tabs
    .filter((item) => item.id !== sourceId && item.id !== targetId)
    .concat(splitTab);

  return {
    nextTabs,
    activeTabId: splitTab.id,
    activePaneId,
  };
}

export function unsplitTabItem(splitTab: SplitTab): Tab[] {
  const paneIds = getVisibleTabIds(splitTab.layout);

  return paneIds
    .map((paneId) => splitTab.panes.find((pane) => pane.id === paneId))
    .filter((pane): pane is Tab => Boolean(pane));
}

export function unsplitTabItems(
  tabs: TabBarItem[],
  splitTabId: string,
): { nextTabs: TabBarItem[]; activeTabId: string | null; activePaneId: string | null } {
  const splitTab = tabs.find((item) => item.id === splitTabId);

  if (!splitTab || !isSplitTab(splitTab)) {
    return {
      nextTabs: tabs,
      activeTabId: splitTabId,
      activePaneId: null,
    };
  }

  const panes = unsplitTabItem(splitTab);
  const nextTabs = tabs.filter((item) => item.id !== splitTabId).concat(panes);
  const activePaneId = splitTab.activePaneId ?? panes[0]?.id ?? null;
  const activeTabId = activePaneId;

  return {
    nextTabs,
    activeTabId,
    activePaneId,
  };
}

export function findPaneTab(tabs: TabBarItem[], paneId: string): Tab | null {
  for (const item of tabs) {
    if (isPaneTab(item) && item.id === paneId) {
      return item;
    }

    if (isSplitTab(item)) {
      const pane = item.panes.find((entry) => entry.id === paneId);

      if (pane) {
        return pane;
      }
    }
  }

  return null;
}

export function findSplitTabByPaneId(tabs: TabBarItem[], paneId: string): SplitTab | null {
  for (const item of tabs) {
    if (isSplitTab(item) && item.panes.some((pane) => pane.id === paneId)) {
      return item;
    }
  }

  return null;
}

export function resolveActiveTabBarItem(
  tabs: TabBarItem[],
  activeTabId: string | null,
): TabBarItem | null {
  if (!activeTabId) {
    return null;
  }

  const directMatch = tabs.find((item) => item.id === activeTabId);

  if (directMatch) {
    return directMatch;
  }

  return findSplitTabByPaneId(tabs, activeTabId);
}

export function collectProjectPanes(tabs: TabBarItem[]): Tab[] {
  const paneMap = new Map<string, Tab>();

  for (const item of tabs) {
    for (const pane of getPanesFromItem(item)) {
      paneMap.set(pane.id, pane);
    }
  }

  return Array.from(paneMap.values());
}

export function collectTerminalPanes(tabs: TabBarItem[]): Tab[] {
  return tabs.flatMap((item) =>
    getPanesFromItem(item).filter((pane) => pane.type === 'terminal'),
  );
}

export function updatePaneInTabs(
  tabs: TabBarItem[],
  paneId: string,
  updater: (pane: Tab) => Tab,
): TabBarItem[] {
  return tabs.map((item) => {
    if (isPaneTab(item) && item.id === paneId) {
      return updater(item);
    }

    if (isSplitTab(item)) {
      return {
        ...item,
        panes: item.panes.map((pane) => (pane.id === paneId ? updater(pane) : pane)),
      };
    }

    return item;
  });
}

export function renameTabBarItem(tabs: TabBarItem[], tabId: string, title: string): TabBarItem[] {
  return tabs.map((item) => (item.id === tabId ? { ...item, title } : item));
}

export function removePaneFromSplit(
  tabs: TabBarItem[],
  splitTabId: string,
  paneId: string,
): TabBarItem[] {
  const splitTab = tabs.find((item) => item.id === splitTabId);

  if (!splitTab || !isSplitTab(splitTab)) {
    return tabs;
  }

  const remainingPanes = splitTab.panes.filter((pane) => pane.id !== paneId);

  if (remainingPanes.length <= 1) {
    const remaining = tabs.filter((item) => item.id !== splitTabId);

    if (remainingPanes.length === 1) {
      return [...remaining, remainingPanes[0]];
    }

    return remaining;
  }

  return tabs.map((item) => {
    if (item.id !== splitTabId || !isSplitTab(item)) {
      return item;
    }

    return {
      ...item,
      panes: remainingPanes,
      activePaneId:
        item.activePaneId === paneId ? (remainingPanes[0]?.id ?? null) : item.activePaneId,
    };
  });
}

export function updateSplitTabLayout(
  tabs: TabBarItem[],
  splitTabId: string,
  layout: SplitLayoutNode,
): TabBarItem[] {
  return tabs.map((item) =>
    item.id === splitTabId && isSplitTab(item) ? { ...item, layout } : item,
  );
}
