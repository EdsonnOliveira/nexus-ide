import type { GitChangeStatus, GitStatusResult } from '@/types/git';

export interface GitFlatChange {
  path: string;
  status: GitChangeStatus;
  staged: boolean;
  additions: number;
  deletions: number;
}

export type GitChangesViewMode = 'list' | 'tree';

export interface GitChangeTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  change: GitFlatChange | null;
  children: GitChangeTreeNode[];
}

function sortGitChangeTreeNodes(nodes: GitChangeTreeNode[]): GitChangeTreeNode[] {
  return nodes
    .map((node) => ({
      ...node,
      children: sortGitChangeTreeNodes(node.children),
    }))
    .sort((left, right) => {
      if (left.isDirectory !== right.isDirectory) {
        return left.isDirectory ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
}

export function buildGitChangeTree(changes: GitFlatChange[]): GitChangeTreeNode[] {
  const root: GitChangeTreeNode[] = [];

  for (const change of changes) {
    const segments = change.path.replace(/\\/g, '/').split('/').filter(Boolean);
    let level = root;

    for (let index = 0; index < segments.length; index += 1) {
      const name = segments[index] ?? '';
      const isLast = index === segments.length - 1;
      const nodePath = segments.slice(0, index + 1).join('/');
      let node = level.find((item) => item.name === name);

      if (!node) {
        node = {
          name,
          path: nodePath,
          isDirectory: !isLast,
          change: isLast ? change : null,
          children: [],
        };
        level.push(node);
      } else if (isLast) {
        node.change = change;
        node.isDirectory = false;
      }

      level = node.children;
    }
  }

  return sortGitChangeTreeNodes(root);
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
