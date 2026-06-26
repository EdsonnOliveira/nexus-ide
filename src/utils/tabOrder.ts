import type { TabBarItem } from '@/types';

export const MAX_PINNED_TABS = 5;

export function isTabPinned(tab: TabBarItem): boolean {
  return Boolean(tab.pinned);
}

export function countPinnedTabs(tabs: TabBarItem[]): number {
  return tabs.filter(isTabPinned).length;
}

export function reorderTabBarItems(
  tabs: TabBarItem[],
  sourceId: string,
  targetIndex: number,
): TabBarItem[] {
  const sourceIndex = tabs.findIndex((tab) => tab.id === sourceId);

  if (sourceIndex === -1) {
    return tabs;
  }

  const source = tabs[sourceIndex];
  const pinnedCount = countPinnedTabs(tabs);
  const sourcePinned = isTabPinned(source);
  let toIndex = targetIndex;

  if (sourcePinned) {
    toIndex = Math.min(Math.max(0, toIndex), Math.max(0, pinnedCount - 1));
  } else {
    toIndex = Math.min(Math.max(pinnedCount, toIndex), tabs.length - 1);
  }

  if (sourceIndex === toIndex) {
    return tabs;
  }

  const next = [...tabs];
  const [item] = next.splice(sourceIndex, 1);
  const insertAt = Math.min(toIndex, next.length);

  next.splice(insertAt, 0, item);

  return next;
}

export function toggleTabPinned(
  tabs: TabBarItem[],
  tabId: string,
): { tabs: TabBarItem[]; ok: boolean } {
  const index = tabs.findIndex((tab) => tab.id === tabId);

  if (index === -1) {
    return { tabs, ok: false };
  }

  const tab = tabs[index];
  const currentlyPinned = isTabPinned(tab);

  if (!currentlyPinned && countPinnedTabs(tabs) >= MAX_PINNED_TABS) {
    return { tabs, ok: false };
  }

  const updatedTab: TabBarItem = { ...tab, pinned: !currentlyPinned };
  const without = tabs.filter((entry) => entry.id !== tabId);
  const pinnedCount = without.filter(isTabPinned).length;
  const insertAt = currentlyPinned ? pinnedCount : 0;

  return {
    tabs: [...without.slice(0, insertAt), updatedTab, ...without.slice(insertAt)],
    ok: true,
  };
}

export function updateTabBarItemPinned(
  tabs: TabBarItem[],
  tabId: string,
  pinned: boolean,
): { tabs: TabBarItem[]; ok: boolean } {
  const tab = tabs.find((entry) => entry.id === tabId);

  if (!tab) {
    return { tabs, ok: false };
  }

  if (pinned === isTabPinned(tab)) {
    return { tabs, ok: true };
  }

  return toggleTabPinned(tabs, tabId);
}
