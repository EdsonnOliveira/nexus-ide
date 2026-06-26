export type GitChangeStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted';

export interface GitChangeEntry {
  path: string;
  previousPath?: string;
  status: GitChangeStatus;
  additions?: number;
  deletions?: number;
}

export interface GitRepoInfo {
  isRepo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
}

export interface GitStatusResult {
  repo: GitRepoInfo;
  staged: GitChangeEntry[];
  unstaged: GitChangeEntry[];
  untracked: GitChangeEntry[];
}

export interface GitDiffResult {
  path: string;
  patch: string;
}

export interface GitFileDiffSidesResult {
  path: string;
  before: string;
  after: string;
}

export interface GitFileDiffImageSidesResult {
  path: string;
  before: string | null;
  after: string | null;
}

export interface GitBranchInfo {
  name: string;
  current: boolean;
  remote: boolean;
}

export interface GitStashEntry {
  index: number;
  message: string;
}

export type GitCommandResult = { ok: true } | { ok: false; error: string };

export interface GitRepoDiscovery {
  path: string;
  relativePath: string;
  branch: string | null;
}
