import { useEffect, useRef, useState } from 'react';
import { buildFlatChanges, type GitFlatChange } from '@/utils/gitFlatChanges';
import { GIT_REPO_REFRESH_EVENT } from '@/utils/gitRepoRefresh';

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
      const status = await window.nexus.git.getStatus(repo.path);
      return buildFlatChanges(status).map((change) => ({
        ...change,
        path: prefixGitChangePath(repo.relativePath, change.path),
      }));
    }),
  );

  return entries.flat().sort((left, right) => left.path.localeCompare(right.path));
}

export function useProjectGitFlatChanges(projectPath: string | null): {
  changes: GitFlatChange[];
  loading: boolean;
} {
  const [changes, setChanges] = useState<GitFlatChange[]>([]);
  const [loading, setLoading] = useState(Boolean(projectPath));
  const repoPathsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!projectPath) {
      repoPathsRef.current = [];
      setChanges([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const refresh = async () => {
      setLoading(true);

      try {
        const repos = await window.nexus.git.discoverRepos(projectPath);
        const repoPaths = repos.map((repo) => repo.path);
        repoPathsRef.current = repoPaths;

        if (repoPaths.length === 0) {
          if (!cancelled) {
            setChanges([]);
          }

          return;
        }

        const nextChanges = await fetchProjectGitFlatChanges(projectPath);

        if (!cancelled) {
          setChanges(nextChanges);
        }

        await Promise.all(repoPaths.map((repoPath) => window.nexus.git.watch(repoPath)));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void refresh();

    const updateChanges = () => {
      void fetchProjectGitFlatChanges(projectPath).then((nextChanges) => {
        if (!cancelled) {
          setChanges(nextChanges);
        }
      });
    };

    const unsubscribe = window.nexus.git.onRepoChange((changedPath) => {
      if (!repoPathsRef.current.includes(changedPath)) {
        return;
      }

      void window.nexus.git.invalidateCache(changedPath).then(updateChanges);
    });

    const handleGitRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ repoPath: string }>).detail;

      if (!repoPathsRef.current.includes(detail.repoPath)) {
        return;
      }

      updateChanges();
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

  return { changes, loading };
}
