import type { FileTab, TabBarItem } from '@/types';

export function findFileTabByPath(tabs: TabBarItem[], filePath: string): FileTab | null {
  for (const item of tabs) {
    if (
      item.type === 'file' &&
      item.filePath === filePath &&
      item.viewMode !== 'diff' &&
      item.viewMode !== 'preview'
    ) {
      return item;
    }

    if (item.type === 'split') {
      for (const pane of item.panes) {
        if (
          pane.type === 'file' &&
          pane.filePath === filePath &&
          pane.viewMode !== 'diff' &&
          pane.viewMode !== 'preview'
        ) {
          return pane;
        }
      }
    }
  }

  return null;
}

export function findFilePreviewTabByPath(tabs: TabBarItem[], filePath: string): FileTab | null {
  for (const item of tabs) {
    if (item.type === 'file' && item.filePath === filePath && item.viewMode === 'preview') {
      return item;
    }

    if (item.type === 'split') {
      for (const pane of item.panes) {
        if (pane.type === 'file' && pane.filePath === filePath && pane.viewMode === 'preview') {
          return pane;
        }
      }
    }
  }

  return null;
}

function diffTabMatchesPath(
  tab: FileTab,
  filePath: string,
  options: { staged: boolean; untracked: boolean },
): boolean {
  return (
    tab.viewMode === 'diff' &&
    tab.filePath === filePath &&
    tab.diffStaged === options.staged &&
    (tab.diffUntracked ?? false) === options.untracked
  );
}

function diffTabMatchesBasename(
  tab: FileTab,
  fileName: string,
  options: { staged: boolean; untracked: boolean },
): boolean {
  if (
    tab.viewMode !== 'diff' ||
    tab.diffStaged !== options.staged ||
    (tab.diffUntracked ?? false) !== options.untracked
  ) {
    return false;
  }

  const normalized = tab.filePath.replace(/\\/g, '/');
  return normalized === fileName || normalized.endsWith(`/${fileName}`);
}

export function findDiffTabByPath(
  tabs: TabBarItem[],
  filePath: string,
  options: { staged: boolean; untracked?: boolean },
): FileTab | null {
  const untracked = options.untracked ?? false;
  const matchOptions = { staged: options.staged, untracked };
  const fileName = filePath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? filePath;
  let basenameMatch: FileTab | null = null;

  for (const item of tabs) {
    if (item.type === 'file') {
      if (diffTabMatchesPath(item, filePath, matchOptions)) {
        return item;
      }

      if (!basenameMatch && diffTabMatchesBasename(item, fileName, matchOptions)) {
        basenameMatch = item;
      }
    }

    if (item.type === 'split') {
      for (const pane of item.panes) {
        if (pane.type !== 'file') {
          continue;
        }

        if (diffTabMatchesPath(pane, filePath, matchOptions)) {
          return pane;
        }

        if (!basenameMatch && diffTabMatchesBasename(pane, fileName, matchOptions)) {
          basenameMatch = pane;
        }
      }
    }
  }

  return basenameMatch;
}
