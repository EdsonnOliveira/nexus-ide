import type { FileTab, Tab, TabBarItem } from '@/types';
import { isImageFileName } from '@/utils/fileViewMode';

export const MAX_PERSISTED_DIFF_CHARS = 200_000;

function fileNameFromPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
}

function looksLikeBinaryPayload(value: string): boolean {
  if (value.startsWith('data:image/') || value.startsWith('data:application/octet-stream')) {
    return true;
  }

  const sample = value.slice(0, 4096);

  if (sample.includes('\u0000')) {
    return true;
  }

  let suspicious = 0;

  for (let index = 0; index < sample.length; index += 1) {
    const code = sample.charCodeAt(index);

    if (code < 9 || (code > 13 && code < 32)) {
      suspicious += 1;
    }
  }

  return suspicious > sample.length * 0.05;
}

export function shouldPersistFileDiffPayload(
  filePath: string,
  before?: string,
  after?: string,
): boolean {
  const fileName = fileNameFromPath(filePath);

  if (isImageFileName(fileName)) {
    return false;
  }

  const beforeLength = before?.length ?? 0;
  const afterLength = after?.length ?? 0;

  if (beforeLength + afterLength > MAX_PERSISTED_DIFF_CHARS) {
    return false;
  }

  if (before && looksLikeBinaryPayload(before)) {
    return false;
  }

  if (after && looksLikeBinaryPayload(after)) {
    return false;
  }

  return true;
}

export function stripHeavyDiffPayloadFromFileTab(tab: FileTab): FileTab {
  if (tab.viewMode !== 'diff') {
    return tab;
  }

  if (shouldPersistFileDiffPayload(tab.filePath, tab.diffBefore, tab.diffAfter)) {
    return tab;
  }

  if (tab.diffBefore === undefined && tab.diffAfter === undefined) {
    return tab;
  }

  const next: FileTab = { ...tab };
  delete next.diffBefore;
  delete next.diffAfter;
  return next;
}

function stripHeavyDiffPayloadFromPane(tab: Tab): Tab {
  if (tab.type !== 'file') {
    return tab;
  }

  return stripHeavyDiffPayloadFromFileTab(tab);
}

export function stripHeavyDiffPayloadsFromTabBarItems(tabs: TabBarItem[]): TabBarItem[] {
  return tabs.map((item) => {
    if (item.type === 'split') {
      return {
        ...item,
        panes: item.panes.map((pane) => stripHeavyDiffPayloadFromPane(pane)),
      };
    }

    return stripHeavyDiffPayloadFromPane(item);
  });
}

export function measurePersistedDiffPayloadBytes(tabs: TabBarItem[]): number {
  let total = 0;

  const visit = (tab: Tab) => {
    if (tab.type !== 'file') {
      return;
    }

    total += tab.diffBefore?.length ?? 0;
    total += tab.diffAfter?.length ?? 0;
  };

  for (const item of tabs) {
    if (item.type === 'split') {
      for (const pane of item.panes) {
        visit(pane);
      }
      continue;
    }

    visit(item);
  }

  return total;
}
