import type { BrowserTab, TabBarItem } from '@/types';
import { normalizeBrowserUrl } from '@/utils/browserUrl';
import { isBrowserErrorPageUrl } from '@/utils/browserSiteStatus';
import {
  collectProjectPanes,
  getPanesFromItem,
  resolveActiveTabBarItem,
} from '@/utils/tabGroups';

export function resolveOpenBrowserUrl(
  tabs: TabBarItem[],
  activeTabId: string | null,
): string {
  const activeItem = resolveActiveTabBarItem(tabs, activeTabId);
  const browserInActive = activeItem
    ? getPanesFromItem(activeItem).find((pane): pane is BrowserTab => pane.type === 'browser')
    : undefined;
  const browser =
    browserInActive ??
    collectProjectPanes(tabs).find((pane): pane is BrowserTab => pane.type === 'browser');
  const rawUrl = browser?.url?.trim() ?? '';

  if (!rawUrl || isBrowserErrorPageUrl(rawUrl)) {
    return '';
  }

  return normalizeBrowserUrl(rawUrl);
}

export function passwordBrowserUrlsMatch(currentUrl: string, targetUrl: string): boolean {
  const normalizedCurrent = normalizeBrowserUrl(currentUrl);
  const normalizedTarget = normalizeBrowserUrl(targetUrl);

  if (!normalizedCurrent || !normalizedTarget) {
    return false;
  }

  if (normalizedCurrent === normalizedTarget) {
    return true;
  }

  try {
    const current = new URL(normalizedCurrent);
    const target = new URL(normalizedTarget);

    return current.origin === target.origin && current.pathname === target.pathname;
  } catch {
    return false;
  }
}
