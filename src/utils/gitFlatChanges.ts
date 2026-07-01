import type { GitChangeStatus, GitStatusResult } from '@/types/git';

export interface GitFlatChange {
  path: string;
  status: GitChangeStatus;
  staged: boolean;
  additions: number;
  deletions: number;
}

export function buildFlatChanges(status: GitStatusResult): GitFlatChange[] {
  const unstagedByPath = new Map(status.unstaged.map((entry) => [entry.path, entry]));
  const rows: GitFlatChange[] = [];

  for (const entry of status.unstaged) {
    rows.push({
      path: entry.path,
      status: entry.status,
      staged: false,
      additions: entry.additions ?? 0,
      deletions: entry.deletions ?? 0,
    });
  }

  for (const entry of status.staged) {
    if (unstagedByPath.has(entry.path)) {
      continue;
    }

    rows.push({
      path: entry.path,
      status: entry.status,
      staged: true,
      additions: entry.additions ?? 0,
      deletions: entry.deletions ?? 0,
    });
  }

  for (const entry of status.untracked) {
    rows.push({
      path: entry.path,
      status: 'untracked',
      staged: false,
      additions: entry.additions ?? 0,
      deletions: 0,
    });
  }

  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

export function countGitStatusChanges(status: GitStatusResult): number {
  return buildFlatChanges(status).length;
}
