import { PROJECT_COLORS, type Tab, type TabBarItem } from '@/types';

function hashTabIdToColorIndex(id: string): number {
  let hash = 0;

  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }

  return Math.abs(hash) % PROJECT_COLORS.length;
}

export function resolveTabBadgeColorIndex(tab: TabBarItem | Tab, fallbackIndex = 0): number {
  if (tab.badgeColorIndex !== undefined) {
    return tab.badgeColorIndex % PROJECT_COLORS.length;
  }

  if (tab.id) {
    return hashTabIdToColorIndex(tab.id);
  }

  return fallbackIndex % PROJECT_COLORS.length;
}

export function resolveTabBadgeColor(tab: TabBarItem | Tab, fallbackIndex = 0): string {
  return PROJECT_COLORS[resolveTabBadgeColorIndex(tab, fallbackIndex)];
}

export function createBadgeColorIndex(existingTabs: TabBarItem[]): number {
  return existingTabs.length % PROJECT_COLORS.length;
}

export function ensureTabBarBadgeColorIndexes(tabs: TabBarItem[]): TabBarItem[] {
  let barCounter = 0;
  let paneCounter = 0;

  const nextBarIndex = () => {
    const index = barCounter % PROJECT_COLORS.length;
    barCounter += 1;
    return index;
  };

  const nextPaneIndex = () => {
    const index = paneCounter % PROJECT_COLORS.length;
    paneCounter += 1;
    return index;
  };

  return tabs.map((tab) => {
    if (tab.type === 'split') {
      return {
        ...tab,
        badgeColorIndex: tab.badgeColorIndex ?? nextBarIndex(),
        panes: tab.panes.map((pane) => ({
          ...pane,
          badgeColorIndex: pane.badgeColorIndex ?? nextPaneIndex(),
        })),
      };
    }

    const badgeColorIndex = tab.badgeColorIndex ?? nextBarIndex();

    return {
      ...tab,
      badgeColorIndex,
    };
  });
}
