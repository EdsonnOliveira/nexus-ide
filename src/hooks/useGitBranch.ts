import { useEffect, useState } from 'react';
import {
  formatGitBranchLabel,
  resolveActiveGitRepo,
} from '@/utils/gitRepoSelection';

const gitBranchCache = new Map<string, string | null>();
const inflightRequests = new Map<string, Promise<string | null>>();

function buildCacheKey(projectPath: string, terminalCwd: string | null): string {
  return `${projectPath}::${terminalCwd ?? ''}`;
}

async function fetchGitBranchLabel(
  projectPath: string,
  terminalCwd: string | null,
): Promise<string | null> {
  const cacheKey = buildCacheKey(projectPath, terminalCwd);
  const existing = inflightRequests.get(cacheKey);

  if (existing) {
    return existing;
  }

  const request = window.nexus.git.discoverRepos(projectPath).then((repos) => {
    inflightRequests.delete(cacheKey);
    const activeRepo = resolveActiveGitRepo(repos, terminalCwd);
    const label = formatGitBranchLabel(repos, activeRepo);
    gitBranchCache.set(cacheKey, label);
    return label;
  });

  inflightRequests.set(cacheKey, request);
  return request;
}

export function useGitBranch(
  projectPath: string | null,
  terminalCwd: string | null = null,
): string | null {
  const [branch, setBranch] = useState<string | null>(() => {
    if (!projectPath) {
      return null;
    }

    return gitBranchCache.get(buildCacheKey(projectPath, terminalCwd)) ?? null;
  });

  useEffect(() => {
    if (!projectPath) {
      setBranch(null);
      return;
    }

    const cacheKey = buildCacheKey(projectPath, terminalCwd);
    const cached = gitBranchCache.get(cacheKey);

    if (cached !== undefined) {
      setBranch(cached);
      return;
    }

    let cancelled = false;

    void fetchGitBranchLabel(projectPath, terminalCwd).then((nextBranch) => {
      if (!cancelled) {
        setBranch(nextBranch);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [projectPath, terminalCwd]);

  return branch;
}
