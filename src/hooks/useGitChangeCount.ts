import { useEffect, useRef, useState } from 'react';
import { GIT_REPO_REFRESH_EVENT } from '@/utils/gitRepoRefresh';

export function useGitChangeCount(projectPath: string | null): number {
  const [count, setCount] = useState(0);
  const repoPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!projectPath) {
      repoPathRef.current = null;
      setCount(0);
      return;
    }

    let cancelled = false;

    const setup = async () => {
      const repos = await window.nexus.git.discoverRepos(projectPath);
      const primaryRepo = repos[0]?.path ?? null;
      repoPathRef.current = primaryRepo;

      if (!primaryRepo) {
        if (!cancelled) {
          setCount(0);
        }

        return;
      }

      const status = await window.nexus.git.getStatus(primaryRepo);

      if (!cancelled) {
        setCount(status.staged.length + status.unstaged.length + status.untracked.length);
      }

      if (!cancelled) {
        void window.nexus.git.watch(primaryRepo);
      }
    };

    void setup();

    const unsubscribe = window.nexus.git.onRepoChange((changedPath) => {
      const activeRepo = repoPathRef.current;

      if (!activeRepo || changedPath !== activeRepo) {
        return;
      }

      void window.nexus.git.getStatus(activeRepo).then((status) => {
        if (!cancelled) {
          setCount(status.staged.length + status.unstaged.length + status.untracked.length);
        }
      });
    });

    const handleGitRefresh = (event: Event) => {
      const activeRepo = repoPathRef.current;
      const detail = (event as CustomEvent<{ repoPath: string }>).detail;

      if (!activeRepo || detail.repoPath !== activeRepo) {
        return;
      }

      void window.nexus.git.getStatus(activeRepo).then((status) => {
        if (!cancelled) {
          setCount(status.staged.length + status.unstaged.length + status.untracked.length);
        }
      });
    };

    window.addEventListener(GIT_REPO_REFRESH_EVENT, handleGitRefresh);

    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener(GIT_REPO_REFRESH_EVENT, handleGitRefresh);

      const activeRepo = repoPathRef.current;

      if (activeRepo) {
        void window.nexus.git.unwatch(activeRepo);
      }
    };
  }, [projectPath]);

  return count;
}
