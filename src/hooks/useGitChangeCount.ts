import { useEffect, useMemo, useRef, useState } from 'react';
import { countGitStatusChanges } from '@/utils/gitFlatChanges';
import { GIT_REPO_REFRESH_EVENT } from '@/utils/gitRepoRefresh';

export interface GitChangeCounts {
  total: number;
  byRepo: Record<string, number>;
}

export function useGitChangeCounts(projectPath: string | null): GitChangeCounts {
  const [byRepo, setByRepo] = useState<Record<string, number>>({});
  const repoPathsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!projectPath) {
      repoPathsRef.current = [];
      setByRepo({});
      return;
    }

    let cancelled = false;

    const syncRepoCounts = async (repoPaths: string[]) => {
      const entries = await Promise.all(
        repoPaths.map(async (repoPath) => {
          const status = await window.nexus.git.getStatus(repoPath);
          return [repoPath, countGitStatusChanges(status)] as const;
        }),
      );

      if (!cancelled) {
        setByRepo(Object.fromEntries(entries));
      }
    };

    const setup = async () => {
      const repos = await window.nexus.git.discoverRepos(projectPath);
      const repoPaths = repos.map((repo) => repo.path);
      repoPathsRef.current = repoPaths;

      if (repoPaths.length === 0) {
        if (!cancelled) {
          setByRepo({});
        }

        return;
      }

      await syncRepoCounts(repoPaths);

      if (!cancelled) {
        await Promise.all(repoPaths.map((repoPath) => window.nexus.git.watch(repoPath)));
      }
    };

    void setup();

    const updateRepoCount = (repoPath: string) => {
      void window.nexus.git
        .invalidateCache(repoPath)
        .then(() => window.nexus.git.getStatus(repoPath))
        .then((status) => {
          if (!cancelled) {
            setByRepo((current) => ({
              ...current,
              [repoPath]: countGitStatusChanges(status),
            }));
          }
        });
    };

    const unsubscribe = window.nexus.git.onRepoChange((changedPath) => {
      if (!repoPathsRef.current.includes(changedPath)) {
        return;
      }

      updateRepoCount(changedPath);
    });

    const handleGitRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ repoPath: string }>).detail;

      if (!repoPathsRef.current.includes(detail.repoPath)) {
        return;
      }

      updateRepoCount(detail.repoPath);
    };

    window.addEventListener(GIT_REPO_REFRESH_EVENT, handleGitRefresh);

    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener(GIT_REPO_REFRESH_EVENT, handleGitRefresh);

      for (const repoPath of repoPathsRef.current) {
        void window.nexus.git.unwatch(repoPath);
      }
    };
  }, [projectPath]);

  const total = useMemo(
    () => Object.values(byRepo).reduce((sum, count) => sum + count, 0),
    [byRepo],
  );

  return { total, byRepo };
}

export function useGitChangeCount(projectPath: string | null): number {
  return useGitChangeCounts(projectPath).total;
}
