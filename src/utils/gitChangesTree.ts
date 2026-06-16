import type { GitChangeEntry } from '@/types/git';

export interface GitChangesTreeNode {
  name: string;
  path: string;
  type: 'directory' | 'file';
  change?: GitChangeEntry;
  children?: GitChangesTreeNode[];
}

function insertChangeNode(
  root: GitChangesTreeNode[],
  segments: string[],
  change: GitChangeEntry,
): void {
  if (segments.length === 0) {
    return;
  }

  const [head, ...rest] = segments;
  const currentPath = segments.join('/');

  if (rest.length === 0) {
    root.push({
      name: head,
      path: change.path,
      type: 'file',
      change,
    });
    return;
  }

  let directory = root.find((node) => node.type === 'directory' && node.name === head);

  if (!directory) {
    directory = {
      name: head,
      path: currentPath,
      type: 'directory',
      children: [],
    };
    root.push(directory);
  }

  insertChangeNode(directory.children ?? [], rest, change);
}

function sortNodes(nodes: GitChangesTreeNode[]): GitChangesTreeNode[] {
  return [...nodes]
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === 'directory' ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    })
    .map((node) =>
      node.children
        ? {
            ...node,
            children: sortNodes(node.children),
          }
        : node,
    );
}

export function buildGitChangesTree(changes: GitChangeEntry[]): GitChangesTreeNode[] {
  const root: GitChangesTreeNode[] = [];

  for (const change of changes) {
    const segments = change.path.split('/').filter(Boolean);
    insertChangeNode(root, segments, change);
  }

  return sortNodes(root);
}

export function collectChangePaths(nodes: GitChangesTreeNode[]): string[] {
  const paths: string[] = [];

  for (const node of nodes) {
    if (node.change) {
      paths.push(node.change.path);
      continue;
    }

    if (node.children) {
      paths.push(...collectChangePaths(node.children));
    }
  }

  return paths;
}
