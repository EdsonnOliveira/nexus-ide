import { useEffect, useMemo, useRef, useState } from 'react';
import { createDebouncedCallback } from '@/utils/createDebouncedCallback';
import { countGitStatusChanges } from '@/utils/gitFlatChanges';
import { GIT_REPO_REFRESH_EVENT } from '@/utils/gitRepoRefresh';
import { requestGitStatus } from '@/utils/gitStatusRequest';

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
          const status = await requestGitStatus(repoPath);
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
        .then(() => requestGitStatus(repoPath))
        .then((status) => {
          if (!cancelled) {
            setByRepo((current) => ({
              ...current,
              [repoPath]: countGitStatusChanges(status),
            }));
          }
        });
    };

    const debouncedUpdates = new Map<string, ReturnType<typeof createDebouncedCallback>>();

    const scheduleRepoUpdate = (repoPath: string) => {
      let debounced = debouncedUpdates.get(repoPath);

      if (!debounced) {
        debounced = createDebouncedCallback(() => {
          updateRepoCount(repoPath);
        }, 250);
        debouncedUpdates.set(repoPath, debounced);
      }

      debounced.schedule();
    };

    const unsubscribe = window.nexus.git.onRepoChange((changedPath) => {
      if (!repoPathsRef.current.includes(changedPath)) {
        return;
      }

      scheduleRepoUpdate(changedPath);
    });

    const handleGitRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ repoPath: string }>).detail;

      if (!repoPathsRef.current.includes(detail.repoPath)) {
        return;
      }

      scheduleRepoUpdate(detail.repoPath);
    };

    window.addEventListener(GIT_REPO_REFRESH_EVENT, handleGitRefresh);

    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener(GIT_REPO_REFRESH_EVENT, handleGitRefresh);

      for (const debounced of debouncedUpdates.values()) {
        debounced.cancel();
      }

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
