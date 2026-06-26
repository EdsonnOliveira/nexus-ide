import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { GitStatusResult } from '@/types/git';
import { buildFlatChanges, type GitFlatChange } from '@/utils/gitFlatChanges';
import { findGitFlatChangeByPath, toGitRelativePath } from '@/utils/gitPaths';
import { GIT_REPO_REFRESH_EVENT } from '@/utils/gitRepoRefresh';

export interface ExplorerGitDecoration {
  kind: 'modified' | 'new';
  badge: string;
}

function toDecoration(change: GitFlatChange): ExplorerGitDecoration {
  if (change.status === 'untracked' || change.status === 'added') {
    return {
      kind: 'new',
      badge: change.status === 'added' ? 'A' : 'U',
    };
  }

  return {
    kind: 'modified',
    badge: 'M',
  };
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

      const status = await window.nexus.git.getStatus(activeRepo);

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

      const status = await window.nexus.git.getStatus(primaryRepo);

      if (!cancelled) {
        applyStatus(status, setChanges);
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

      void refreshStatus();
    });

    const handleGitRefresh = (event: Event) => {
      const activeRepo = repoPathRef.current;
      const detail = (event as CustomEvent<{ repoPath: string }>).detail;

      if (!activeRepo || detail.repoPath !== activeRepo) {
        return;
      }

      void refreshStatus();
    };

    window.addEventListener(GIT_REPO_REFRESH_EVENT, handleGitRefresh);

    return () => {
      cancelled = true;
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
