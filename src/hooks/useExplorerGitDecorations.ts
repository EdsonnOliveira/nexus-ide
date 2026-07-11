import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { GitStatusResult } from '@/types/git';
import { createDebouncedCallback } from '@/utils/createDebouncedCallback';
import { buildFlatChanges, getGitChangeDecoration, type GitFlatChange } from '@/utils/gitFlatChanges';
import { findGitFlatChangeByPath, toGitRelativePath } from '@/utils/gitPaths';
import { GIT_REPO_REFRESH_EVENT } from '@/utils/gitRepoRefresh';
import { requestGitStatus } from '@/utils/gitStatusRequest';

export interface ExplorerGitDecoration {
  kind: 'modified' | 'new';
  badge: string;
}

function toDecoration(change: GitFlatChange): ExplorerGitDecoration {
  return getGitChangeDecoration(change);
}

function areGitFlatChangesEqual(left: GitFlatChange[], right: GitFlatChange[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => {
    const other = right[index];

    return (
      entry.path === other.path &&
      entry.status === other.status &&
      entry.staged === other.staged &&
      entry.additions === other.additions &&
      entry.deletions === other.deletions
    );
  });
}

function applyStatus(
  status: GitStatusResult,
  setChanges: Dispatch<SetStateAction<GitFlatChange[]>>,
): void {
  const nextChanges = buildFlatChanges(status);
  setChanges((current) => (areGitFlatChangesEqual(current, nextChanges) ? current : nextChanges));
}

export function useExplorerGitDecorations(
  projectPath: string | null,
): (absolutePath: string) => ExplorerGitDecoration | null {
  const [changes, setChanges] = useState<GitFlatChange[]>([]);
  const repoPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!projectPath) {
      repoPathRef.current = null;
      setChanges([]);
      return;
    }

    let cancelled = false;

    const refreshStatus = async () => {
      const activeRepo = repoPathRef.current;

      if (!activeRepo) {
        return;
      }

      const status = await requestGitStatus(activeRepo);

      if (!cancelled) {
        applyStatus(status, setChanges);
      }
    };

    const setup = async () => {
      const repos = await window.nexus.git.discoverRepos(projectPath);
      const primaryRepo = repos[0]?.path ?? null;
      repoPathRef.current = primaryRepo;

      if (!primaryRepo) {
        if (!cancelled) {
          setChanges([]);
        }

        return;
      }

      const status = await requestGitStatus(primaryRepo);

      if (!cancelled) {
        applyStatus(status, setChanges);
      }
    };

    void setup();

    const debouncedRefresh = createDebouncedCallback(() => {
      void refreshStatus();
    }, 250);

    const unsubscribe = window.nexus.git.onRepoChange((changedPath) => {
      const activeRepo = repoPathRef.current;

      if (!activeRepo || changedPath !== activeRepo) {
        return;
      }

      debouncedRefresh.schedule();
    });

    const handleGitRefresh = (event: Event) => {
      const activeRepo = repoPathRef.current;
      const detail = (event as CustomEvent<{ repoPath: string }>).detail;

      if (!activeRepo || detail.repoPath !== activeRepo) {
        return;
      }

      debouncedRefresh.schedule();
    };

    window.addEventListener(GIT_REPO_REFRESH_EVENT, handleGitRefresh);

    return () => {
      cancelled = true;
      debouncedRefresh.cancel();
      unsubscribe();
      window.removeEventListener(GIT_REPO_REFRESH_EVENT, handleGitRefresh);
    };
  }, [projectPath]);

  return useCallback(
    (absolutePath: string): ExplorerGitDecoration | null => {
      const repoPath = repoPathRef.current;

      if (!repoPath || changes.length === 0) {
        return null;
      }

      const relative = toGitRelativePath(repoPath, absolutePath);
      const change = findGitFlatChangeByPath(changes, relative);

      if (!change) {
        return null;
      }

      return toDecoration(change);
    },
    [changes],
  );
}
