import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitBranchInfo, GitCommandResult, GitStatusResult, GitStashEntry } from '@/types/git';
import { createDebouncedCallback } from '@/utils/createDebouncedCallback';
import { subscribeGitRepoChange } from '@/utils/gitRepoChangeBus';
import { GIT_REPO_REFRESH_EVENT } from '@/utils/gitRepoRefresh';
import { requestGitStatus } from '@/utils/gitStatusRequest';

interface UseGitStatusResult {
  status: GitStatusResult | null;
  branches: GitBranchInfo[];
  stashes: GitStashEntry[];
  loading: boolean;
  actionLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  stage: (paths: string[]) => Promise<GitCommandResult>;
  unstage: (paths: string[]) => Promise<GitCommandResult>;
  discard: (paths: string[]) => Promise<GitCommandResult>;
  commit: (message: string) => Promise<GitCommandResult>;
  pull: () => Promise<GitCommandResult>;
  push: () => Promise<GitCommandResult>;
  checkout: (branch: string) => Promise<GitCommandResult>;
  createBranch: (branch: string) => Promise<GitCommandResult>;
  stash: (message?: string) => Promise<GitCommandResult>;
  stashPop: () => Promise<GitCommandResult>;
}

export function useGitStatus(repoPath: string | null, enabled: boolean): UseGitStatusResult {
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [stashes, setStashes] = useState<GitStashEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repoPathRef = useRef(repoPath);
  repoPathRef.current = repoPath;

  const refresh = useCallback(async () => {
    const path = repoPathRef.current;

    if (!path) {
      setStatus(null);
      setBranches([]);
      setStashes([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [nextStatus, nextBranches, nextStashes] = await Promise.all([
        requestGitStatus(path),
        window.nexus.git.listBranches(path),
        window.nexus.git.stashList(path),
      ]);

      setStatus(nextStatus);
      setBranches(nextBranches);
      setStashes(nextStashes);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Falha ao carregar Git';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const runMutation = useCallback(
    async (operation: () => Promise<GitCommandResult>) => {
      const path = repoPathRef.current;

      if (!path) {
        return { ok: false as const, error: 'Projeto indisponível' };
      }

      setActionLoading(true);
      setError(null);

      try {
        const result = await operation();

        if (!result.ok) {
          setError(result.error);
        } else {
          await refresh();
        }

        return result;
      } catch (mutationError) {
        const message =
          mutationError instanceof Error ? mutationError.message : 'Falha na operação Git';
        setError(message);
        return { ok: false as const, error: message };
      } finally {
        setActionLoading(false);
      }
    },
    [refresh],
  );

  useEffect(() => {
    if (!enabled || !repoPath) {
      return;
    }

    void refresh();

    const debouncedRefresh = createDebouncedCallback(() => {
      void refresh();
    }, 250);

    const unsubscribe = subscribeGitRepoChange((changedPath) => {
      if (changedPath === repoPath) {
        debouncedRefresh.schedule();
      }
    });

    const handleGitRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ repoPath: string }>).detail;

      if (detail.repoPath === repoPath) {
        debouncedRefresh.schedule();
      }
    };

    window.addEventListener(GIT_REPO_REFRESH_EVENT, handleGitRefresh);

    return () => {
      debouncedRefresh.cancel();
      unsubscribe();
      window.removeEventListener(GIT_REPO_REFRESH_EVENT, handleGitRefresh);
    };
  }, [enabled, refresh, repoPath]);

  const stage = useCallback(
    (paths: string[]) =>
      runMutation(() => window.nexus.git.stage(repoPathRef.current ?? '', paths)),
    [runMutation],
  );

  const unstage = useCallback(
    (paths: string[]) =>
      runMutation(() => window.nexus.git.unstage(repoPathRef.current ?? '', paths)),
    [runMutation],
  );

  const discard = useCallback(
    (paths: string[]) =>
      runMutation(() => window.nexus.git.discard(repoPathRef.current ?? '', paths)),
    [runMutation],
  );

  const commit = useCallback(
    (message: string) =>
      runMutation(() => window.nexus.git.commit(repoPathRef.current ?? '', message)),
    [runMutation],
  );

  const pull = useCallback(
    () => runMutation(() => window.nexus.git.pull(repoPathRef.current ?? '')),
    [runMutation],
  );

  const push = useCallback(
    () => runMutation(() => window.nexus.git.push(repoPathRef.current ?? '')),
    [runMutation],
  );

  const checkout = useCallback(
    (branch: string) =>
      runMutation(() => window.nexus.git.checkout(repoPathRef.current ?? '', branch)),
    [runMutation],
  );

  const createBranch = useCallback(
    (branch: string) =>
      runMutation(() => window.nexus.git.createBranch(repoPathRef.current ?? '', branch)),
    [runMutation],
  );

  const stash = useCallback(
    (message?: string) =>
      runMutation(() => window.nexus.git.stash(repoPathRef.current ?? '', message)),
    [runMutation],
  );

  const stashPop = useCallback(
    () => runMutation(() => window.nexus.git.stashPop(repoPathRef.current ?? '')),
    [runMutation],
  );

  return {
    status,
    branches,
    stashes,
    loading,
    actionLoading,
    error,
    refresh,
    stage,
    unstage,
    discard,
    commit,
    pull,
    push,
    checkout,
    createBranch,
    stash,
    stashPop,
  };
}
