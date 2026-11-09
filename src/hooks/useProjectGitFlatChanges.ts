import { useEffect, useState } from 'react';
import { buildFlatChanges, type GitFlatChange } from '@/utils/gitFlatChanges';
import { requestGitStatus } from '@/utils/gitStatusRequest';
import { subscribeGitRepoChange } from '@/utils/gitRepoChangeBus';
import { GIT_REPO_REFRESH_EVENT } from '@/utils/gitRepoRefresh';

const REFRESH_DEBOUNCE_MS = 2_500;

function prefixGitChangePath(relativePath: string, changePath: string): string {
  if (!relativePath || relativePath === '.') {
    return changePath;
  }

  return `${relativePath}/${changePath}`;
}

export async function fetchProjectGitFlatChanges(projectPath: string): Promise<GitFlatChange[]> {
  const repos = await window.nexus.git.discoverRepos(projectPath);

  if (repos.length === 0) {
    return [];
  }

  const entries = await Promise.all(
    repos.map(async (repo) => {
      const status = await requestGitStatus(repo.path);
      return buildFlatChanges(status).map((change) => ({
        ...change,
        path: prefixGitChangePath(repo.relativePath, change.path),
      }));
    }),
  );

  return entries.flat().sort((left, right) => left.path.localeCompare(right.path));
}

export interface UseProjectGitFlatChangesOptions {
  enabled?: boolean;
  watch?: boolean;
}

interface SharedProjectGitState {
  changes: GitFlatChange[];
  loading: boolean;
  repoPaths: string[];
  watchers: number;
  subscribers: Set<() => void>;
  refreshTimer: number | null;
  inFlight: Promise<void> | null;
  watchedPaths: Set<string>;
  unsubscribeBus: (() => void) | null;
}

const sharedByPath = new Map<string, SharedProjectGitState>();

function getSharedState(projectPath: string): SharedProjectGitState {
  const existing = sharedByPath.get(projectPath);

  if (existing) {
    return existing;
  }

  const created: SharedProjectGitState = {
    changes: [],
    loading: false,
    repoPaths: [],
    watchers: 0,
    subscribers: new Set(),
    refreshTimer: null,
    inFlight: null,
    watchedPaths: new Set(),
    unsubscribeBus: null,
  };
  sharedByPath.set(projectPath, created);
  return created;
}

function notifyShared(projectPath: string): void {
  const shared = sharedByPath.get(projectPath);

  if (!shared) {
    return;
  }

  for (const listener of shared.subscribers) {
    listener();
  }
}

async function refreshShared(projectPath: string, options?: { silent?: boolean }): Promise<void> {
  const shared = getSharedState(projectPath);

  if (shared.inFlight) {
    await shared.inFlight;
    return;
  }

  if (!options?.silent) {
    shared.loading = true;
    notifyShared(projectPath);
  }

  const task = (async () => {
    try {
      const repos = await window.nexus.git.discoverRepos(projectPath);
      const repoPaths = repos.map((repo) => repo.path);
      shared.repoPaths = repoPaths;

      if (repoPaths.length === 0) {
        shared.changes = [];
        return;
      }

      shared.changes = await fetchProjectGitFlatChanges(projectPath);

      if (shared.watchers > 0) {
        await Promise.all(
          repoPaths.map(async (repoPath) => {
            if (shared.watchedPaths.has(repoPath)) {
              return;
            }

            await window.nexus.git.watch(repoPath);
            shared.watchedPaths.add(repoPath);
          }),
        );
      }
    } finally {
      shared.loading = false;
      shared.inFlight = null;
      notifyShared(projectPath);
    }
  })();

  shared.inFlight = task;
  await task;
}

function scheduleSharedRefresh(projectPath: string): void {
  const shared = getSharedState(projectPath);

  if (shared.refreshTimer !== null) {
    window.clearTimeout(shared.refreshTimer);
  }

  shared.refreshTimer = window.setTimeout(() => {
    shared.refreshTimer = null;
    void refreshShared(projectPath, { silent: true });
  }, REFRESH_DEBOUNCE_MS);
}

function ensureSharedBus(projectPath: string): void {
  const shared = getSharedState(projectPath);

  if (shared.unsubscribeBus) {
    return;
  }

  const unsubscribe = subscribeGitRepoChange((changedPath) => {
    if (!shared.repoPaths.includes(changedPath)) {
      return;
    }

    void window.nexus.git.invalidateCache(changedPath).then(() => {
      scheduleSharedRefresh(projectPath);
    });
  });

  const handleGitRefresh = (event: Event) => {
    const detail = (event as CustomEvent<{ repoPath: string }>).detail;

    if (!shared.repoPaths.includes(detail.repoPath)) {
      return;
    }

    scheduleSharedRefresh(projectPath);
  };

  window.addEventListener(GIT_REPO_REFRESH_EVENT, handleGitRefresh);
  shared.unsubscribeBus = () => {
    unsubscribe();
    window.removeEventListener(GIT_REPO_REFRESH_EVENT, handleGitRefresh);
  };
}

async function retainSharedWatch(projectPath: string): Promise<void> {
  const shared = getSharedState(projectPath);
  shared.watchers += 1;
  ensureSharedBus(projectPath);

  if (shared.watchers === 1) {
    await refreshShared(projectPath);
  }
}

async function releaseSharedWatch(projectPath: string): Promise<void> {
  const shared = sharedByPath.get(projectPath);

  if (!shared) {
    return;
  }

  shared.watchers = Math.max(0, shared.watchers - 1);

  if (shared.watchers > 0) {
    return;
  }

  if (shared.refreshTimer !== null) {
    window.clearTimeout(shared.refreshTimer);
    shared.refreshTimer = null;
  }

  shared.unsubscribeBus?.();
  shared.unsubscribeBus = null;

  for (const repoPath of shared.watchedPaths) {
    void window.nexus.git.unwatch(repoPath);
  }

  shared.watchedPaths.clear();
}

export function useProjectGitFlatChanges(
  projectPath: string | null,
  options: UseProjectGitFlatChangesOptions = {},
): {
  changes: GitFlatChange[];
  loading: boolean;
} {
  const enabled = options.enabled ?? true;
  const watch = options.watch ?? true;
  const [changes, setChanges] = useState<GitFlatChange[]>([]);
  const [loading, setLoading] = useState(Boolean(projectPath) && enabled);

  useEffect(() => {
    if (!projectPath || !enabled) {
      setChanges([]);
      setLoading(false);
      return;
    }

    const shared = getSharedState(projectPath);
    let cancelled = false;

    const sync = () => {
      if (cancelled) {
        return;
      }

      setChanges(shared.changes);
      setLoading(shared.loading);
    };

    shared.subscribers.add(sync);
    sync();

    if (watch) {
      void retainSharedWatch(projectPath).then(sync);
    } else {
      void refreshShared(projectPath).then(sync);
    }

    return () => {
      cancelled = true;
      shared.subscribers.delete(sync);

      if (watch) {
        void releaseSharedWatch(projectPath);
      }

      if (shared.subscribers.size === 0 && shared.watchers === 0) {
        if (shared.refreshTimer !== null) {
          window.clearTimeout(shared.refreshTimer);
          shared.refreshTimer = null;
        }

        sharedByPath.delete(projectPath);
      }
    };
  }, [enabled, projectPath, watch]);

  return { changes, loading };
}
