import type { FileTab, TabBarItem } from '@/types';

export function findFileTabByPath(tabs: TabBarItem[], filePath: string): FileTab | null {
  for (const item of tabs) {
    if (item.type === 'file' && item.filePath === filePath && item.viewMode !== 'diff') {
      return item;
    }

    if (item.type === 'split') {
      for (const pane of item.panes) {
        if (pane.type === 'file' && pane.filePath === filePath && pane.viewMode !== 'diff') {
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
  staged: boolean,
): FileTab | null {
  for (const item of tabs) {
    if (
      item.type === 'file' &&
      item.viewMode === 'diff' &&
      item.filePath === filePath &&
      item.diffStaged === staged
    ) {
      return item;
    }

    if (item.type === 'split') {
      for (const pane of item.panes) {
        if (
          pane.type === 'file' &&
          pane.viewMode === 'diff' &&
          pane.filePath === filePath &&
          pane.diffStaged === staged
        ) {
          return pane;
        }
      }
    }
  }

  return null;
}
