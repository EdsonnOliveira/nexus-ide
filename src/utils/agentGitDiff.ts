import type { GitFlatChange } from '@/utils/gitFlatChanges';
import { buildFlatChanges } from '@/utils/gitFlatChanges';
import { useProjectStore } from '@/stores/useProjectStore';
import { resolveAgentPaneRootPath } from '@/utils/agentTabHelpers';
import { findPaneTab } from '@/utils/tabGroups';
import { findProjectIdByPaneId } from '@/utils/findProjectIdByPaneId';
import { resolveAgentActivityFilePath } from '@/utils/agentTranscriptParser';
import { isImageFileName } from '@/utils/fileViewMode';
import { expandUserPath, findGitFlatChangeByPath, resolveGitDiffContext } from '@/utils/gitPaths';
import {
  buildGitDiffLines,
  buildGitDiffPreviewHunks,
  buildSingleSidePreviewHunks,
  isBinaryGitPatch,
  looksLikeBinaryText,
  parseGitUnifiedDiff,
  shouldSkipGitDiffPreviewLcs,
  type GitDiffPreviewHunk,
} from '@/utils/gitDiffLines';

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
    pane?.type === 'agent'
      ? resolveAgentPaneRootPath(project?.path ?? projectPath)
      : pane?.type === 'terminal' && pane.terminalCwd
        ? pane.terminalCwd
        : (project?.path ?? projectPath);
  const normalizedCwd = cwd.replace(/\\/g, '/').replace(/\/+$/, '');

  const sortedRepos = [...repos].sort((left, right) => right.path.length - left.path.length);

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

export function diffGitSnapshots(
  before: GitFlatChange[],
  after: GitFlatChange[],
): GitSnapshotDelta {
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

export function diffGitSnapshotsLoose(
  before: GitFlatChange[],
  after: GitFlatChange[],
): GitSnapshotDelta {
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

export type AgentFileDiffPreviewKind = 'ok' | 'empty' | 'error' | 'image' | 'binary' | 'large';

export interface AgentFileDiffPreview {
  kind: AgentFileDiffPreviewKind;
  displayPath: string;
  hunks: GitDiffPreviewHunk[];
}

function getFileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return normalized.split('/').pop() ?? path;
}

async function readGitPatch(
  repoPath: string,
  relativePath: string,
  staged: boolean,
): Promise<string | null> {
  try {
    const result = await window.nexus.git.diff(repoPath, relativePath, staged);
    return result.patch;
  } catch {
    return null;
  }
}

function previewFromPatch(patch: string, displayPath: string): AgentFileDiffPreview | null {
  if (isBinaryGitPatch(patch)) {
    return { kind: 'binary', displayPath, hunks: [] };
  }

  const hunks = parseGitUnifiedDiff(patch);

  if (hunks.length === 0) {
    return null;
  }

  return { kind: 'ok', displayPath, hunks };
}

export async function loadAgentFileDiffPreview(
  projectPath: string,
  filePath: string,
): Promise<AgentFileDiffPreview> {
  const trimmed = filePath.trim();
  const displayPath = trimmed.replace(/\\/g, '/');
  const fileName = getFileNameFromPath(displayPath);

  if (!trimmed) {
    return { kind: 'error', displayPath, hunks: [] };
  }

  if (isImageFileName(fileName)) {
    return { kind: 'image', displayPath, hunks: [] };
  }

  if (!window.nexus?.git?.getFileDiffSides) {
    return { kind: 'error', displayPath, hunks: [] };
  }

  const expandedProject = expandUserPath(projectPath, projectPath);
  const expandedFromHome = expandUserPath(trimmed, expandedProject);
  const expandedFile = expandedFromHome.startsWith('~')
    ? (resolveAgentActivityFilePath(expandedProject || projectPath, trimmed) ?? trimmed)
    : expandedFromHome;

  try {
    const diffContext = await resolveGitDiffContext(expandedProject || projectPath, expandedFile);
    const repoPath = diffContext.repoPath;
    const gitRelativePath = diffContext.gitRelativePath;
    let staged = false;
    let untracked = false;
    let relativePath = gitRelativePath;
    let isRepo = true;

    try {
      const status = await window.nexus.git.getStatus(repoPath);
      isRepo = status.repo.isRepo;
      const change =
        findGitFlatChangeByPath(buildFlatChanges(status), gitRelativePath) ??
        findGitFlatChangeByPath(buildFlatChanges(status), expandedFile);

      if (change) {
        staged = change.staged;
        untracked = change.status === 'untracked';
        relativePath = change.path;
      } else if (!isRepo) {
        untracked = true;
        relativePath = diffContext.absoluteFilePath;
      }
    } catch {
      staged = false;
      untracked = true;
      relativePath = diffContext.absoluteFilePath;
    }

    const fileDir = diffContext.absoluteFilePath.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
    const diffDir = isRepo ? repoPath : fileDir || repoPath;
    const diffTarget = relativePath || diffContext.absoluteFilePath || expandedFile;

    if (!untracked) {
      const patch = await readGitPatch(diffDir, diffTarget, staged);
      if (patch) {
        const fromPatch = previewFromPatch(patch, displayPath);

        if (fromPatch) {
          return fromPatch;
        }
      }

      const otherPatch = await readGitPatch(diffDir, diffTarget, !staged);
      if (otherPatch) {
        const fromOther = previewFromPatch(otherPatch, displayPath);

        if (fromOther) {
          return fromOther;
        }
      }
    }

    const sides = await window.nexus.git.getFileDiffSides(diffDir, diffTarget, {
      staged,
      untracked,
    });

    if (looksLikeBinaryText(sides.before) || looksLikeBinaryText(sides.after)) {
      return { kind: 'binary', displayPath, hunks: [] };
    }

    if (!sides.before && sides.after) {
      return {
        kind: 'ok',
        displayPath,
        hunks: buildSingleSidePreviewHunks(sides.after, 'add'),
      };
    }

    if (sides.before && !sides.after) {
      return {
        kind: 'ok',
        displayPath,
        hunks: buildSingleSidePreviewHunks(sides.before, 'remove'),
      };
    }

    if (shouldSkipGitDiffPreviewLcs(sides.before, sides.after)) {
      return { kind: 'large', displayPath, hunks: [] };
    }

    const hunks = buildGitDiffPreviewHunks(buildGitDiffLines(sides.before, sides.after));

    if (hunks.length === 0) {
      if (!untracked && diffContext.absoluteFilePath) {
        const fallback = await window.nexus.git.getFileDiffSides(
          diffDir,
          diffContext.absoluteFilePath,
          {
            staged: false,
            untracked: true,
          },
        );

        if (fallback.after && fallback.after !== fallback.before) {
          if (!fallback.before) {
            return {
              kind: 'ok',
              displayPath,
              hunks: buildSingleSidePreviewHunks(fallback.after, 'add'),
            };
          }

          const fallbackHunks = buildGitDiffPreviewHunks(
            buildGitDiffLines(fallback.before, fallback.after),
          );

          if (fallbackHunks.length > 0) {
            return { kind: 'ok', displayPath, hunks: fallbackHunks };
          }
        }
      }

      return { kind: 'empty', displayPath, hunks: [] };
    }

    return { kind: 'ok', displayPath, hunks };
  } catch {
    return { kind: 'error', displayPath, hunks: [] };
  }
}
