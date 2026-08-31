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
  pendingStructural: boolean;
}

const MAX_WATCHERS = 256;
const watchStates = new Map<string, WatchState>();
let notifyWindow: (() => BrowserWindow | null) | null = null;

export function setProjectFileWatchWindow(getter: () => BrowserWindow | null): void {
  notifyWindow = getter;
}

function notifyProjectChanged(projectPath: string, changedPath?: string, structural = true): void {
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

    if (structural) {
      state.pendingStructural = true;
    }

    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
    }

    state.debounceTimer = setTimeout(() => {
      const nextStructural = state.pendingStructural;
      state.pendingStructural = false;
      notifyProjectChanged(resolved, changedPath, nextStructural);
      notifyGitWatchersOfProjectChange(resolved, changedPath);
    }, 1500);
  };

  const watchers: FSWatcher[] = [];
  const watchedRoots = new Set<string>();

  const startWatch = (watchRoot: string, recursive: boolean) => {
    if (watchedRoots.has(watchRoot) || watchers.length >= MAX_WATCHERS) {
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
              startWatchTree(changedPath);
            }
          } catch {}
        }

        const structural = event !== 'change';
        scheduleNotify(changedPath, structural);
      });

      watchedRoots.add(watchRoot);
      watchers.push(watcher);
    } catch {}
  };

  const startWatchTree = (watchRoot: string) => {
    if (watchedRoots.has(watchRoot)) {
      return;
    }

    if (watchRoot !== resolved && shouldIgnoreWatchPath(resolved, watchRoot)) {
      return;
    }

    if (watchers.length >= MAX_WATCHERS) {
      startWatch(watchRoot, true);
      return;
    }

    let entries;

    try {
      entries = readdirSync(watchRoot, { withFileTypes: true });
    } catch {
      startWatch(watchRoot, true);
      return;
    }

    const childDirs = entries.filter((entry) => entry.isDirectory());
    const hasIgnoredChild = childDirs.some((entry) =>
      shouldIgnoreWatchPath(resolved, path.join(watchRoot, entry.name)),
    );

    if (!hasIgnoredChild) {
      startWatch(watchRoot, true);
      return;
    }

    startWatch(watchRoot, false);

    for (const entry of childDirs) {
      const childPath = path.join(watchRoot, entry.name);

      if (shouldIgnoreWatchPath(resolved, childPath)) {
        continue;
      }

      startWatchTree(childPath);
    }
  };

  watchStates.set(resolved, {
    watchers,
    debounceTimer: null,
    projectPath: resolved,
    pendingStructural: false,
  });

  startWatchTree(resolved);

  if (watchers.length === 0) {
    watchStates.delete(resolved);
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

  for (const watcher of state.watchers) {
    watcher.close();
  }

  watchStates.delete(resolved);
}
