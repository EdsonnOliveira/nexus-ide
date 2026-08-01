import { useEffect, useRef, useState } from 'react';
import { createDebouncedCallback } from '@/utils/createDebouncedCallback';
import { requestGitDiscoverRepos } from '@/utils/gitDiscoverRequest';
import { subscribeGitRepoChange } from '@/utils/gitRepoChangeBus';
import { GIT_REPO_REFRESH_EVENT } from '@/utils/gitRepoRefresh';

export interface GitChangeCounts {
  total: number;
  byRepo: Record<string, number>;
}

export interface UseGitChangeCountsOptions {
  watch?: boolean;
  enabled?: boolean;
  deferMs?: number;
}

async function fetchProjectChangeCounts(projectPath: string): Promise<GitChangeCounts> {
  if (typeof window.nexus.git.getChangeCounts === 'function') {
    return window.nexus.git.getChangeCounts(projectPath);
  }

  const repos = await requestGitDiscoverRepos(projectPath);
  const byRepo: Record<string, number> = {};

  for (const repo of repos) {
    byRepo[repo.path] = 0;
  }

  return {
    total: 0,
    byRepo,
  };
}

export function useGitChangeCounts(
  projectPath: string | null,
  options: UseGitChangeCountsOptions = {},
): GitChangeCounts {
  const watch = options.watch ?? true;
  const enabled = options.enabled ?? true;
  const deferMs = options.deferMs ?? 0;
  const [counts, setCounts] = useState<GitChangeCounts>({ total: 0, byRepo: {} });
  const repoPathsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!projectPath || !enabled) {
      repoPathsRef.current = [];
      setCounts({ total: 0, byRepo: {} });
      return;
    }

    let cancelled = false;
    let setupTimer: number | null = null;

    const refreshCounts = async () => {
      try {
        const next = await fetchProjectChangeCounts(projectPath);

        if (cancelled) {
          return;
        }

        repoPathsRef.current = Object.keys(next.byRepo);
        setCounts(next);
      } catch {
        if (cancelled) {
          return;
        }
      }
    };

    const setup = async () => {
      await refreshCounts();

      if (!cancelled && watch) {
        await Promise.all(repoPathsRef.current.map((repoPath) => window.nexus.git.watch(repoPath)));
      }
    };

    setupTimer = window.setTimeout(() => {
      void setup();
    }, deferMs);

    const debouncedRefresh = createDebouncedCallback(() => {
      void refreshCounts();
    }, 350);

    const unsubscribe = watch
      ? subscribeGitRepoChange((changedPath) => {
          if (
            !repoPathsRef.current.includes(changedPath) &&
            !changedPath.startsWith(`${projectPath}/`) &&
            changedPath !== projectPath
          ) {
            return;
          }

          debouncedRefresh.schedule();
        })
      : () => undefined;

    const handleGitRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ repoPath: string }>).detail;

      if (
        !repoPathsRef.current.includes(detail.repoPath) &&
        detail.repoPath !== projectPath &&
        !detail.repoPath.startsWith(`${projectPath}/`)
      ) {
        return;
      }

      debouncedRefresh.schedule();
    };

    if (watch) {
      window.addEventListener(GIT_REPO_REFRESH_EVENT, handleGitRefresh);
    }

    return () => {
      cancelled = true;

      if (setupTimer !== null) {
        window.clearTimeout(setupTimer);
      }

      unsubscribe();
      debouncedRefresh.cancel();

      if (watch) {
        window.removeEventListener(GIT_REPO_REFRESH_EVENT, handleGitRefresh);

        for (const repoPath of repoPathsRef.current) {
          void window.nexus.git.unwatch(repoPath);
        }
      }
    };
  }, [deferMs, enabled, projectPath, watch]);

  return counts;
}

export function useGitChangeCount(
  projectPath: string | null,
  options: UseGitChangeCountsOptions = {},
): number {
  return useGitChangeCounts(projectPath, options).total;
}
