import type { GitFlatChange } from '@/utils/gitFlatChanges';
import { buildFlatChanges } from '@/utils/gitFlatChanges';
import { useProjectStore } from '@/stores/useProjectStore';
import { findPaneTab } from '@/utils/tabGroups';
import { findProjectIdByPaneId } from '@/utils/findProjectIdByPaneId';

export interface GitSnapshotDelta {
  files: GitFlatChange[];
  additions: number;
  deletions: number;
  fileCount: number;
}

function changeSignature(change: GitFlatChange): string {
  return `${change.status}|${change.staged}|${change.additions}|${change.deletions}`;
}

export async function captureGitSnapshot(repoPath: string): Promise<GitFlatChange[]> {
  await window.nexus.git.invalidateCache(repoPath);
  const status = await window.nexus.git.getStatus(repoPath);
  return buildFlatChanges(status);
}

export async function resolvePrimaryRepoPath(projectPath: string): Promise<string | null> {
  const repos = await window.nexus.git.discoverRepos(projectPath);
  return repos[0]?.path ?? null;
}

export async function resolveRepoPathForAgentTurn(
  projectPath: string,
  paneId?: string | null,
): Promise<string | null> {
  const repos = await window.nexus.git.discoverRepos(projectPath);

  if (repos.length === 0) {
    return null;
  }

  if (!paneId) {
    return repos[0]?.path ?? null;
  }

  const projectId = findProjectIdByPaneId(paneId);
  const project =
    useProjectStore.getState().projects.find((entry) => entry.id === projectId) ?? null;
  const pane = project ? findPaneTab(project.tabs, paneId) : null;
  const cwd =
    pane?.type === 'agent' && pane.workingDirectory
      ? pane.workingDirectory
      : pane?.type === 'terminal' && pane.terminalCwd
        ? pane.terminalCwd
        : (project?.path ?? projectPath);
  const normalizedCwd = cwd.replace(/\\/g, '/').replace(/\/+$/, '');

  const sortedRepos = [...repos].sort(
    (left, right) => right.path.length - left.path.length,
  );

  for (const repo of sortedRepos) {
    const normalizedRepo = repo.path.replace(/\\/g, '/').replace(/\/+$/, '');

    if (normalizedCwd === normalizedRepo || normalizedCwd.startsWith(`${normalizedRepo}/`)) {
      return repo.path;
    }
  }

  return repos[0]?.path ?? null;
}

function buildSnapshotDelta(files: GitFlatChange[]): GitSnapshotDelta {
  const additions = files.reduce((sum, change) => sum + change.additions, 0);
  const deletions = files.reduce((sum, change) => sum + change.deletions, 0);

  return {
    files,
    additions,
    deletions,
    fileCount: files.length,
  };
}

export function diffGitSnapshots(before: GitFlatChange[], after: GitFlatChange[]): GitSnapshotDelta {
  const beforeByPath = new Map(before.map((change) => [change.path, change]));
  const files: GitFlatChange[] = [];

  for (const change of after) {
    const previous = beforeByPath.get(change.path);

    if (!previous || changeSignature(previous) !== changeSignature(change)) {
      files.push(change);
    }
  }

  return buildSnapshotDelta(files);
}

export function toIncrementalDeltaFiles(
  before: GitFlatChange[],
  files: GitFlatChange[],
): GitFlatChange[] {
  const beforeByPath = new Map(before.map((change) => [change.path, change]));

  return files.map((change) => {
    const previous = beforeByPath.get(change.path);

    if (!previous) {
      return change;
    }

    return {
      ...change,
      additions: Math.max(0, change.additions - previous.additions),
      deletions: Math.max(0, change.deletions - previous.deletions),
    };
  });
}

export function diffGitSnapshotsLoose(before: GitFlatChange[], after: GitFlatChange[]): GitSnapshotDelta {
  const beforeByPath = new Map(before.map((change) => [change.path, change]));
  const files: GitFlatChange[] = [];

  for (const change of after) {
    const previous = beforeByPath.get(change.path);

    if (!previous || previous.status !== change.status || previous.staged !== change.staged) {
      files.push(change);
      continue;
    }

    if (previous.additions !== change.additions || previous.deletions !== change.deletions) {
      files.push(change);
    }
  }

  return buildSnapshotDelta(files);
}
