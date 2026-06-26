import { useCallback, useEffect, useState } from 'react';
import {
  buildGitBranchBarEntries,
  resolveActiveGitRepo,
  type GitBranchBarEntry,
} from '@/utils/gitRepoSelection';

const gitBranchCache = new Map<string, GitBranchBarEntry[]>();
const inflightRequests = new Map<string, Promise<GitBranchBarEntry[]>>();

function buildCacheKey(projectPath: string, terminalCwd: string | null): string {
  return `${projectPath}::${terminalCwd ?? ''}`;
}

function invalidateProjectGitBranchCache(projectPath: string): void {
  for (const key of gitBranchCache.keys()) {
    if (key.startsWith(`${projectPath}::`)) {
      gitBranchCache.delete(key);
    }
  }
}

async function fetchGitBranchEntries(
  projectPath: string,
  terminalCwd: string | null,
): Promise<GitBranchBarEntry[]> {
  const cacheKey = buildCacheKey(projectPath, terminalCwd);
  const existing = inflightRequests.get(cacheKey);

  if (existing) {
    return existing;
  }

  const request = window.nexus.git.discoverRepos(projectPath).then((repos) => {
    inflightRequests.delete(cacheKey);
    const activeRepo = resolveActiveGitRepo(repos, terminalCwd);
    const entries = buildGitBranchBarEntries(repos, activeRepo);
    gitBranchCache.set(cacheKey, entries);
    return entries;
  });

  inflightRequests.set(cacheKey, request);
  return request;
}

export function useGitBranch(
  projectPath: string | null,
  terminalCwd: string | null = null,
): {
  entries: GitBranchBarEntry[];
  refresh: () => void;
} {
  const [entries, setEntries] = useState<GitBranchBarEntry[]>(() => {
    if (!projectPath) {
      return [];
    }

    return gitBranchCache.get(buildCacheKey(projectPath, terminalCwd)) ?? [];
  });
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => {
    if (!projectPath) {
      return;
    }

    invalidateProjectGitBranchCache(projectPath);
    setRefreshToken((current) => current + 1);
  }, [projectPath]);

  useEffect(() => {
    if (!projectPath) {
      setEntries([]);
      return;
    }

    const cacheKey = buildCacheKey(projectPath, terminalCwd);
    const cached = gitBranchCache.get(cacheKey);

    if (cached !== undefined && refreshToken === 0) {
      setEntries(cached);
      return;
    }

    let cancelled = false;

    void fetchGitBranchEntries(projectPath, terminalCwd).then((nextEntries) => {
      if (!cancelled) {
        setEntries(nextEntries);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [projectPath, refreshToken, terminalCwd]);

  useEffect(() => {
    if (!projectPath) {
      return;
    }

    const unsubscribe = window.nexus.git.onRepoChange((changedPath) => {
      if (changedPath === projectPath || changedPath.startsWith(`${projectPath}/`)) {
        invalidateProjectGitBranchCache(projectPath);
        setRefreshToken((current) => current + 1);
      }
    });

    return unsubscribe;
  }, [projectPath]);

  return { entries, refresh };
}
