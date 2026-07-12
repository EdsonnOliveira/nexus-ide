import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { resolveDirectoryPath } from './directoryListing';
import { shouldIgnoreWatchPath } from './watchIgnorePaths';

interface WatchState {
  watcher: FSWatcher;
  debounceTimer: NodeJS.Timeout | null;
  projectPath: string;
}

const watchStates = new Map<string, WatchState>();
let notifyWindow: (() => BrowserWindow | null) | null = null;

export function setProjectFileWatchWindow(getter: () => BrowserWindow | null): void {
  notifyWindow = getter;
}

function notifyProjectChanged(
  projectPath: string,
  changedPath?: string,
  structural = true,
): void {
  const win = notifyWindow?.();

  if (win && !win.isDestroyed()) {
    win.webContents.send('files:project-changed', { projectPath, changedPath, structural });
  }
}

export function watchProjectFiles(dirPath: string): void {
  const resolved = resolveDirectoryPath(dirPath);

  if (watchStates.has(resolved)) {
    return;
  }

  const scheduleNotify = (changedPath?: string, structural = true) => {
    const state = watchStates.get(resolved);

    if (!state) {
      return;
    }

    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
    }

    state.debounceTimer = setTimeout(() => {
      notifyProjectChanged(resolved, changedPath, structural);
    }, 1500);
  };

  try {
    const watcher = watch(resolved, { recursive: true }, (event, filename) => {
      const changedPath = filename ? path.join(resolved, filename) : undefined;

      if (shouldIgnoreWatchPath(resolved, changedPath)) {
        return;
      }

      const structural = event !== 'change';
      scheduleNotify(changedPath, structural);
    });

    watchStates.set(resolved, { watcher, debounceTimer: null, projectPath: resolved });
  } catch {
    return;
  }
}

export function unwatchProjectFiles(dirPath: string): void {
  const resolved = resolveDirectoryPath(dirPath);
  const state = watchStates.get(resolved);

  if (!state) {
    return;
  }

  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
  }

  state.watcher.close();
  watchStates.delete(resolved);
}
