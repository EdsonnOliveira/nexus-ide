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

export function findDiffTabByPath(
  tabs: TabBarItem[],
  filePath: string,
  options: { staged: boolean; untracked?: boolean },
): FileTab | null {
  const untracked = options.untracked ?? false;

  for (const item of tabs) {
    if (
      item.type === 'file' &&
      item.viewMode === 'diff' &&
      item.filePath === filePath &&
      item.diffStaged === options.staged &&
      (item.diffUntracked ?? false) === untracked
    ) {
      return item;
    }

    if (item.type === 'split') {
      for (const pane of item.panes) {
        if (
          pane.type === 'file' &&
          pane.viewMode === 'diff' &&
          pane.filePath === filePath &&
          pane.diffStaged === options.staged &&
          (pane.diffUntracked ?? false) === untracked
        ) {
          return pane;
        }
      }
    }
  }

  return null;
}
