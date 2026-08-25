import { readdirSync, statSync, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { resolveDirectoryPath } from './directoryListing';
import { notifyGitWatchersOfProjectChange } from './git';
import { shouldIgnoreWatchPath } from './watchIgnorePaths';

interface WatchState {
  watchers: FSWatcher[];
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
      notifyGitWatchersOfProjectChange(resolved, changedPath);
    }, 1500);
  };

  const watchers: FSWatcher[] = [];
  const watchedRoots = new Set<string>();

  const startWatch = (watchRoot: string, recursive: boolean) => {
    if (watchedRoots.has(watchRoot)) {
      return;
    }

    try {
      const watcher = watch(watchRoot, { recursive }, (event, filename) => {
        const changedPath = filename ? path.join(watchRoot, filename) : watchRoot;

        if (shouldIgnoreWatchPath(resolved, changedPath)) {
          return;
        }

        if (!recursive && filename) {
          try {
            if (statSync(changedPath).isDirectory()) {
              startWatch(changedPath, true);
            }
          } catch {
          }
        }

        const structural = event !== 'change';
        scheduleNotify(changedPath, structural);
      });

      watchedRoots.add(watchRoot);
      watchers.push(watcher);
    } catch {
    }
  };

  try {
    const entries = readdirSync(resolved, { withFileTypes: true });
    startWatch(resolved, false);

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const childPath = path.join(resolved, entry.name);

      if (shouldIgnoreWatchPath(resolved, childPath)) {
        continue;
      }

      startWatch(childPath, true);
    }
  } catch {
    startWatch(resolved, true);
  }

  if (watchers.length === 0) {
    return;
  }

  watchStates.set(resolved, { watchers, debounceTimer: null, projectPath: resolved });
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

  for (const watcher of state.watchers) {
    watcher.close();
  }

  watchStates.delete(resolved);
}
