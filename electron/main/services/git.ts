import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { BrowserWindow } from 'electron';
import { resolveDirectoryPath } from './directoryListing';

const execFileAsync = promisify(execFile);

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

export interface GitBranchInfo {
  name: string;
  current: boolean;
  remote: boolean;
}

export interface GitStashEntry {
  index: number;
  message: string;
}

export interface GitRepoDiscovery {
  path: string;
  relativePath: string;
  branch: string | null;
}

export type GitCommandResult = { ok: true } | { ok: false; error: string };

const statusCache = new Map<string, { expiresAt: number; result: GitStatusResult }>();
const CACHE_TTL_MS = 2_000;
const MAX_GIT_DISCOVERY_DEPTH = 6;

const GIT_DISCOVERY_IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.turbo',
  '.cache',
  '.idea',
  '.vscode',
  '__pycache__',
  'coverage',
  'dist',
  'dist-electron',
  'node_modules',
  'release',
  'build',
  'vendor',
  'target',
]);

interface WatchState {
  watcher: FSWatcher;
  debounceTimer: NodeJS.Timeout | null;
  repoPath: string;
}

const watchStates = new Map<string, WatchState>();
let notifyWindow: (() => BrowserWindow | null) | null = null;

export function setGitWatchWindow(getter: () => BrowserWindow | null): void {
  notifyWindow = getter;
}

function resolveRepo(dirPath: string): string {
  return resolveDirectoryPath(dirPath);
}

function isGitRepo(dirPath: string): boolean {
  return existsSync(path.join(dirPath, '.git'));
}

function shouldSkipGitDiscoveryDir(name: string): boolean {
  return GIT_DISCOVERY_IGNORED_DIRS.has(name);
}

function readGitBranchForRepo(resolved: string): string | null {
  try {
    const output = execFileSync('git', ['-C', resolved, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    if (!output || output === 'HEAD') {
      return null;
    }

    return output;
  } catch {
    return null;
  }
}

function findNestedGitRepos(projectPath: string): GitRepoDiscovery[] {
  const resolved = resolveRepo(projectPath);
  const repos: GitRepoDiscovery[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: resolved, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      continue;
    }

    let entries;

    try {
      entries = readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || shouldSkipGitDiscoveryDir(entry.name)) {
        continue;
      }

      const childPath = path.join(current.dir, entry.name);

      if (isGitRepo(childPath)) {
        const relativePath = path.relative(resolved, childPath) || '.';

        repos.push({
          path: childPath,
          relativePath,
          branch: readGitBranchForRepo(childPath),
        });
        continue;
      }

      if (current.depth < MAX_GIT_DISCOVERY_DEPTH) {
        queue.push({ dir: childPath, depth: current.depth + 1 });
      }
    }
  }

  return repos.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function discoverGitRepos(projectPath: string): GitRepoDiscovery[] {
  const resolved = resolveRepo(projectPath);
  const repos: GitRepoDiscovery[] = [];

  if (isGitRepo(resolved)) {
    repos.push({
      path: resolved,
      relativePath: '.',
      branch: readGitBranchForRepo(resolved),
    });
  }

  repos.push(...findNestedGitRepos(resolved));

  return repos.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function resolveProjectGitRepo(projectPath: string): string | null {
  const resolved = resolveRepo(projectPath);

  if (isGitRepo(resolved)) {
    return resolved;
  }

  return findNestedGitRepos(resolved)[0]?.path ?? null;
}

function invalidateCache(dirPath: string): void {
  statusCache.delete(resolveRepo(dirPath));
}

function mapIndexStatus(code: string): GitChangeStatus {
  if (code === 'A') {
    return 'added';
  }

  if (code === 'D') {
    return 'deleted';
  }

  if (code === 'R' || code === 'C') {
    return 'renamed';
  }

  if (code === 'U') {
    return 'conflicted';
  }

  return 'modified';
}

function mapWorktreeStatus(code: string): GitChangeStatus {
  if (code === 'D') {
    return 'deleted';
  }

  if (code === 'R') {
    return 'renamed';
  }

  if (code === 'U') {
    return 'conflicted';
  }

  return 'modified';
}

function parseBranchLine(line: string): Pick<GitRepoInfo, 'branch' | 'upstream' | 'ahead' | 'behind' | 'detached'> {
  const branchPart = line.slice(3).trim();
  const detached = branchPart.startsWith('HEAD (no branch)') || branchPart === 'HEAD';

  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;

  if (detached) {
    return { branch: null, upstream: null, ahead: 0, behind: 0, detached: true };
  }

  const main = branchPart.split(' [')[0] ?? '';
  const parts = main.split('...');
  branch = parts[0]?.trim() || null;
  upstream = parts[1]?.trim() || null;

  const metaMatch = branchPart.match(/\[(?:[^,\]]+,\s*)?ahead (\d+)(?:,\s*behind (\d+))?\]/);

  if (metaMatch) {
    ahead = Number(metaMatch[1] ?? 0);
    behind = Number(metaMatch[2] ?? 0);
  } else {
    const behindOnly = branchPart.match(/\[behind (\d+)\]/);

    if (behindOnly) {
      behind = Number(behindOnly[1] ?? 0);
    }

    const aheadOnly = branchPart.match(/\[ahead (\d+)\]/);

    if (aheadOnly) {
      ahead = Number(aheadOnly[1] ?? 0);
    }
  }

  return { branch, upstream, ahead, behind, detached: false };
}

function parseStatusOutput(output: string, repoPath: string): GitStatusResult {
  const staged: GitChangeEntry[] = [];
  const unstaged: GitChangeEntry[] = [];
  const untracked: GitChangeEntry[] = [];
  let repo: GitRepoInfo = {
    isRepo: true,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    detached: false,
  };

  for (const line of output.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    if (line.startsWith('##')) {
      repo = { ...repo, ...parseBranchLine(line) };
      continue;
    }

    if (line.startsWith('??')) {
      const filePath = line.slice(3).trim();
      untracked.push({ path: filePath, status: 'untracked' });
      continue;
    }

    const indexStatus = line[0] ?? ' ';
    const worktreeStatus = line[1] ?? ' ';
    const rawPath = line.slice(3).trim();
    const renamedParts = rawPath.split('\t');
    const filePath = renamedParts[renamedParts.length - 1] ?? rawPath;
    const previousPath = renamedParts.length > 1 ? renamedParts[0] : undefined;

    if (indexStatus !== ' ' && indexStatus !== '?') {
      staged.push({
        path: filePath,
        previousPath,
        status: mapIndexStatus(indexStatus),
      });
    }

    if (worktreeStatus !== ' ' && worktreeStatus !== '?') {
      unstaged.push({
        path: filePath,
        previousPath,
        status: mapWorktreeStatus(worktreeStatus),
      });
    }
  }

  return { repo, staged, unstaged, untracked };
}

async function runGit(
  dirPath: string,
  args: string[],
  options?: { maxBuffer?: number },
): Promise<string> {
  const resolved = resolveRepo(dirPath);
  const { stdout } = await execFileAsync('git', ['-C', resolved, ...args], {
    encoding: 'utf8',
    maxBuffer: options?.maxBuffer ?? 10 * 1024 * 1024,
    timeout: 120_000,
  });

  return stdout;
}

function toCommandResult(error: unknown): GitCommandResult {
  if (error instanceof Error) {
    const execError = error as Error & { stderr?: string };
    const message = execError.stderr?.trim() || execError.message;
    return { ok: false, error: message };
  }

  return { ok: false, error: 'Erro desconhecido' };
}

export function getGitBranch(dirPath: string): string | null {
  const resolved = resolveProjectGitRepo(dirPath);

  if (!resolved) {
    return null;
  }

  return readGitBranchForRepo(resolved);
}

export async function getGitStatus(dirPath: string): Promise<GitStatusResult> {
  const resolved = resolveRepo(dirPath);
  const now = Date.now();
  const cached = statusCache.get(resolved);

  if (cached && cached.expiresAt > now) {
    return cached.result;
  }

  if (!isGitRepo(resolved)) {
    const empty: GitStatusResult = {
      repo: {
        isRepo: false,
        branch: null,
        upstream: null,
        ahead: 0,
        behind: 0,
        detached: false,
      },
      staged: [],
      unstaged: [],
      untracked: [],
    };

    return empty;
  }

  const output = await runGit(resolved, ['status', '--porcelain=1', '-b']);
  const result = parseStatusOutput(output, resolved);
  statusCache.set(resolved, { expiresAt: now + CACHE_TTL_MS, result });

  return result;
}

export async function stageGitPaths(dirPath: string, paths: string[]): Promise<GitCommandResult> {
  const resolved = resolveRepo(dirPath);

  try {
    if (paths.length === 0) {
      await runGit(resolved, ['add', '-A']);
    } else {
      await runGit(resolved, ['add', '--', ...paths]);
    }

    invalidateCache(resolved);
    return { ok: true };
  } catch (error) {
    return toCommandResult(error);
  }
}

export async function unstageGitPaths(dirPath: string, paths: string[]): Promise<GitCommandResult> {
  const resolved = resolveRepo(dirPath);

  try {
    if (paths.length === 0) {
      await runGit(resolved, ['restore', '--staged', '.']);
    } else {
      await runGit(resolved, ['restore', '--staged', '--', ...paths]);
    }

    invalidateCache(resolved);
    return { ok: true };
  } catch (error) {
    return toCommandResult(error);
  }
}

export async function discardGitPaths(dirPath: string, paths: string[]): Promise<GitCommandResult> {
  const resolved = resolveRepo(dirPath);

  try {
    if (paths.length === 0) {
      return { ok: false, error: 'Nenhum arquivo selecionado' };
    }

    await runGit(resolved, ['restore', '--', ...paths]);
    invalidateCache(resolved);
    return { ok: true };
  } catch (error) {
    return toCommandResult(error);
  }
}

export async function commitGit(dirPath: string, message: string): Promise<GitCommandResult> {
  const resolved = resolveRepo(dirPath);
  const trimmed = message.trim();

  if (!trimmed) {
    return { ok: false, error: 'Mensagem de commit obrigatória' };
  }

  try {
    await runGit(resolved, ['commit', '-m', trimmed]);
    invalidateCache(resolved);
    return { ok: true };
  } catch (error) {
    return toCommandResult(error);
  }
}

export async function getGitDiff(
  dirPath: string,
  filePath: string,
  staged: boolean,
): Promise<GitDiffResult> {
  const resolved = resolveRepo(dirPath);
  const args = staged ? ['diff', '--cached', '--', filePath] : ['diff', '--', filePath];
  const patch = await runGit(resolved, args);

  return { path: filePath, patch };
}

export async function pullGit(dirPath: string): Promise<GitCommandResult> {
  const resolved = resolveRepo(dirPath);

  try {
    await runGit(resolved, ['pull']);
    invalidateCache(resolved);
    return { ok: true };
  } catch (error) {
    return toCommandResult(error);
  }
}

export async function pushGit(dirPath: string): Promise<GitCommandResult> {
  const resolved = resolveRepo(dirPath);

  try {
    await runGit(resolved, ['push']);
    invalidateCache(resolved);
    return { ok: true };
  } catch (error) {
    return toCommandResult(error);
  }
}

export async function listGitBranches(dirPath: string): Promise<GitBranchInfo[]> {
  const resolved = resolveRepo(dirPath);

  if (!isGitRepo(resolved)) {
    return [];
  }

  const output = await runGit(resolved, ['branch', '--list', '--all']);
  const currentBranch = getGitBranch(resolved);

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const current = line.startsWith('*');
      const remote = line.includes('remotes/');
      let name = line.replace(/^\*\s*/, '').trim();

      if (remote) {
        name = name.replace(/^remotes\//, '');
      }

      return {
        name,
        current: current || name === currentBranch,
        remote,
      };
    });
}

export async function checkoutGitBranch(dirPath: string, branch: string): Promise<GitCommandResult> {
  const resolved = resolveRepo(dirPath);

  try {
    await runGit(resolved, ['checkout', branch]);
    invalidateCache(resolved);
    return { ok: true };
  } catch (error) {
    return toCommandResult(error);
  }
}

export async function createGitBranch(
  dirPath: string,
  branch: string,
): Promise<GitCommandResult> {
  const resolved = resolveRepo(dirPath);

  try {
    await runGit(resolved, ['checkout', '-b', branch]);
    invalidateCache(resolved);
    return { ok: true };
  } catch (error) {
    return toCommandResult(error);
  }
}

export async function stashGit(dirPath: string, message?: string): Promise<GitCommandResult> {
  const resolved = resolveRepo(dirPath);

  try {
    const args = message?.trim() ? ['stash', 'push', '-m', message.trim()] : ['stash', 'push'];
    await runGit(resolved, args);
    invalidateCache(resolved);
    return { ok: true };
  } catch (error) {
    return toCommandResult(error);
  }
}

export async function stashPopGit(dirPath: string): Promise<GitCommandResult> {
  const resolved = resolveRepo(dirPath);

  try {
    await runGit(resolved, ['stash', 'pop']);
    invalidateCache(resolved);
    return { ok: true };
  } catch (error) {
    return toCommandResult(error);
  }
}

export async function listGitStashes(dirPath: string): Promise<GitStashEntry[]> {
  const resolved = resolveRepo(dirPath);

  if (!isGitRepo(resolved)) {
    return [];
  }

  try {
    const output = await runGit(resolved, ['stash', 'list']);
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => ({
        index,
        message: line.replace(/^stash@\{\d+\}:\s*/, ''),
      }));
  } catch {
    return [];
  }
}

function notifyRepoChanged(repoPath: string): void {
  const win = notifyWindow?.();

  if (win && !win.isDestroyed()) {
    win.webContents.send('git:repo-changed', { repoPath });
  }
}

export function watchGitRepo(dirPath: string): void {
  const resolved = resolveRepo(dirPath);

  if (!isGitRepo(resolved) || watchStates.has(resolved)) {
    return;
  }

  const scheduleNotify = () => {
    const state = watchStates.get(resolved);

    if (!state) {
      return;
    }

    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
    }

    state.debounceTimer = setTimeout(() => {
      invalidateCache(resolved);
      notifyRepoChanged(resolved);
    }, 300);
  };

  const watcher = watch(resolved, { recursive: true }, scheduleNotify);
  watchStates.set(resolved, { watcher, debounceTimer: null, repoPath: resolved });
}

export function unwatchGitRepo(dirPath: string): void {
  const resolved = resolveRepo(dirPath);
  const state = watchStates.get(resolved);

  if (!state) {
    return;
  }

  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
  }

  state.watcher.close();
  watchStates.delete(resolved);
}
