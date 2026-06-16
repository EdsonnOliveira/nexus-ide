import type { Project } from '@/types';
import type { GitRepoDiscovery } from '@/types/git';

function normalizeComparablePath(value: string): string {
  return value.replace(/\/+$/, '');
}

export function getActiveTerminalCwd(project: Project): string {
  const { activeTabId, activePaneId, tabs, path } = project;

  if (!activeTabId) {
    return path;
  }

  const activeItem = tabs.find((item) => item.id === activeTabId);

  if (!activeItem) {
    return path;
  }

  if (activeItem.type === 'split') {
    const paneId = activePaneId ?? activeItem.activePaneId ?? activeItem.panes[0]?.id;
    const pane = activeItem.panes.find((entry) => entry.id === paneId) ?? activeItem.panes[0];

    if (pane?.type === 'terminal') {
      return pane.terminalCwd ?? path;
    }

    return path;
  }

  if (activeItem.type === 'terminal') {
    return activeItem.terminalCwd ?? path;
  }

  return path;
}

export function resolveActiveGitRepo(
  repos: GitRepoDiscovery[],
  cwd: string | null,
): GitRepoDiscovery | null {
  if (repos.length === 0) {
    return null;
  }

  if (repos.length === 1) {
    return repos[0];
  }

  const referenceCwd = normalizeComparablePath(cwd ?? '');

  if (referenceCwd) {
    const exactMatch = repos.find(
      (repo) => normalizeComparablePath(repo.path) === referenceCwd,
    );

    if (exactMatch) {
      return exactMatch;
    }

    const prefixMatches = repos
      .filter((repo) => {
        const repoPath = normalizeComparablePath(repo.path);
        return referenceCwd === repoPath || referenceCwd.startsWith(`${repoPath}/`);
      })
      .sort((left, right) => right.path.length - left.path.length);

    if (prefixMatches[0]) {
      return prefixMatches[0];
    }
  }

  return repos[0];
}

function formatRepoBranchEntry(repo: GitRepoDiscovery): string | null {
  if (!repo.branch) {
    return null;
  }

  if (repo.relativePath === '.') {
    return repo.branch;
  }

  return `${repo.branch} (${repo.relativePath})`;
}

export function formatGitBranchLabel(
  repos: GitRepoDiscovery[],
  activeRepo: GitRepoDiscovery | null,
): string | null {
  const withBranch = repos.filter((repo) => repo.branch);

  if (withBranch.length === 0) {
    return null;
  }

  if (withBranch.length === 1) {
    return formatRepoBranchEntry(withBranch[0]);
  }

  const ordered = activeRepo?.branch
    ? [
        activeRepo,
        ...withBranch.filter((repo) => repo.path !== activeRepo.path),
      ]
    : withBranch;

  return ordered
    .map((repo) => formatRepoBranchEntry(repo))
    .filter((entry): entry is string => entry !== null)
    .join(' · ');
}
