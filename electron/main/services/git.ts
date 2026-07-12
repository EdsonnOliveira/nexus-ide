import { execFile, execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  watch,
  type FSWatcher,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { BrowserWindow } from 'electron';
import { shouldIgnoreWatchPath } from './watchIgnorePaths';
import { bufferToDataUrlIfWithinLimit, MAX_IMAGE_DATA_URL_BYTES } from './imageLoader';
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

export interface GitRepoDiscovery {
  path: string;
  relativePath: string;
  branch: string | null;
}

export interface GitDailyStats {
  commits: number;
  linesChanged: number;
}

export type GitCommandResult = { ok: true } | { ok: false; error: string };

const statusCache = new Map<string, { expiresAt: number; result: GitStatusResult }>();
const discoveryCache = new Map<string, { expiresAt: number; repos: GitRepoDiscovery[] }>();
const CACHE_TTL_MS = 5_000;
const DISCOVERY_CACHE_TTL_MS = 30_000;
const WATCH_DEBOUNCE_MS = 1_500;
const MAX_GIT_DISCOVERY_DEPTH = 6;
const MAX_UNTRACKED_LINE_COUNT_BYTES = 128 * 1024;
const MAX_UNTRACKED_LINE_STATS = 80;
const MAX_DIFF_TEXT_CHARS = 1_500_000;
const MAX_GIT_BLOB_BUFFER_BYTES = MAX_IMAGE_DATA_URL_BYTES;

function buildGitPorcelainStatusArgs(): string[] {
  return ['status', '--porcelain=1', '-b', '--untracked-files=all'];
}

function buildGitStatusArgs(): string[] {
  return [
    ...buildGitPorcelainStatusArgs(),
    '--',
    '.',
    ...Array.from(GIT_DISCOVERY_IGNORED_DIRS).map((segment) => `:(exclude)${segment}/**`),
  ];
}

const GIT_DISCOVERY_IGNORED_DIRS = new Set([
  '.cursor',
  '.cxx',
  '.nexus',
  '.expo',
  '.git',
  '.gradle',
  '.hg',
  '.kotlin',
  '.netlify',
  '.nuxt',
  '.output',
  '.parcel-cache',
  '.svn',
  '.temp',
  '.terraform',
  '.turbo',
  '.vercel',
  '.vscode',
  '.idea',
  '.cache',
  '.next',
  '__pycache__',
  'DerivedData',
  'Pods',
  'build',
  'coverage',
  'dist',
  'dist-electron',
  'intermediates',
  'node_modules',
  'out',
  'release',
  'target',
  'temp',
  'tmp',
  'vendor',
  'xcuserdata',
]);

const GIT_STATUS_EXCLUDED_BASENAME_PATTERNS = [
  /^\.DS_Store$/,
  /\.tsbuildinfo$/,
  /^worker-[a-f0-9]{8,}\.js$/,
  /^\.env\.local$/,
  /^\.env\..+\.local$/,
];

interface WatchState {
  watcher: FSWatcher;
  metaWatchers: FSWatcher[];
  debounceTimer: NodeJS.Timeout | null;
  repoPath: string;
}

const watchStates = new Map<string, WatchState>();
const watchRefCounts = new Map<string, number>();
let notifyWindow: (() => BrowserWindow | null) | null = null;

export function setGitWatchWindow(getter: () => BrowserWindow | null): void {
  notifyWindow = getter;
}

function resolveRepo(dirPath: string): string {
  return resolveDirectoryPath(dirPath);
}

function resolveGitRepoRoot(dirPath: string): string {
  const resolved = resolveRepo(dirPath);

  if (isGitRepo(resolved)) {
    return resolved;
  }

  try {
    const output = execFileSync('git', ['-C', resolved, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    if (output) {
      return output;
    }
  } catch {
    const nestedRepos = discoverGitRepos(resolved);

    if (nestedRepos.length === 1) {
      return nestedRepos[0].path;
    }
  }

  const nestedRepos = discoverGitRepos(resolved);

  if (nestedRepos.length === 1) {
    return nestedRepos[0].path;
  }

  return resolved;
}

function resolveGitRepoForFilePath(dirPath: string, filePath: string): string {
  const resolved = resolveRepo(dirPath);

  if (isGitRepo(resolved)) {
    return resolved;
  }

  try {
    const output = execFileSync('git', ['-C', resolved, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    if (output) {
      return output;
    }
  } catch {
    // fall through to nested repo discovery
  }

  const repos = discoverGitRepos(resolved);

  if (repos.length === 0) {
    return resolved;
  }

  if (repos.length === 1) {
    return repos[0].path;
  }

  const normalizedInput = filePath.replace(/\\/g, '/');

  if (path.isAbsolute(filePath)) {
    const absolute = path.resolve(filePath);
    const sortedRepos = [...repos].sort((left, right) => right.path.length - left.path.length);

    for (const repo of sortedRepos) {
      const relative = path.relative(repo.path, absolute).replace(/\\/g, '/');

      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        return repo.path;
      }
    }
  } else {
    const relative = normalizedInput.replace(/^\/+/, '').replace(/^\.\/+/, '');
    const sortedRepos = [...repos].sort((left, right) => right.path.length - left.path.length);

    for (const repo of sortedRepos) {
      if (repo.relativePath !== '.' && relative.startsWith(`${repo.relativePath}/`)) {
        return repo.path;
      }

      const candidate = path.join(repo.path, relative);

      if (existsSync(candidate)) {
        return repo.path;
      }
    }
  }

  return repos[0].path;
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
  const now = Date.now();
  const cached = discoveryCache.get(resolved);

  if (cached && cached.expiresAt > now) {
    return cached.repos;
  }

  const repos: GitRepoDiscovery[] = [];

  if (isGitRepo(resolved)) {
    repos.push({
      path: resolved,
      relativePath: '.',
      branch: readGitBranchForRepo(resolved),
    });
  }

  repos.push(...findNestedGitRepos(resolved));

  const sorted = repos.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  discoveryCache.set(resolved, { expiresAt: now + DISCOVERY_CACHE_TTL_MS, repos: sorted });

  return sorted;
}

function resolveProjectGitRepo(projectPath: string): string | null {
  const resolved = resolveRepo(projectPath);

  if (isGitRepo(resolved)) {
    return resolved;
  }

  return findNestedGitRepos(resolved)[0]?.path ?? null;
}

function invalidateCache(dirPath: string): void {
  const resolved = resolveRepo(dirPath);
  statusCache.delete(resolved);
  discoveryCache.delete(resolved);
}

function invalidateCacheAndNotify(dirPath: string): void {
  const resolved = resolveRepo(dirPath);
  invalidateCache(resolved);
  notifyRepoChanged(resolved);
}

export function invalidateGitStatusCache(dirPath: string): void {
  invalidateCache(dirPath);
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

async function getGitIgnoredPathSet(repoPath: string, paths: string[]): Promise<Set<string>> {
  const uniquePaths = [...new Set(paths.filter(Boolean))];

  if (uniquePaths.length === 0) {
    return new Set();
  }

  const ignored = new Set<string>();
  const batchSize = 200;

  for (let index = 0; index < uniquePaths.length; index += batchSize) {
    const batch = uniquePaths.slice(index, index + batchSize);

    try {
      const { stdout } = await execFileAsync(
        'git',
        ['-C', repoPath, 'check-ignore', '--', ...batch],
        {
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024,
          timeout: 30_000,
        },
      );

      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();

        if (trimmed) {
          ignored.add(trimmed);
        }
      }
    } catch (error) {
      const execError = error as NodeJS.ErrnoException & { stdout?: string };
      const stdout = execError.stdout ?? '';

      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();

        if (trimmed) {
          ignored.add(trimmed);
        }
      }

      if (execError.code !== 1 && execError.code !== 'ENOENT') {
        continue;
      }
    }
  }

  return ignored;
}

function isGitStatusExcludedPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  const basename = normalized.split('/').pop() ?? normalized;

  if (GIT_STATUS_EXCLUDED_BASENAME_PATTERNS.some((pattern) => pattern.test(basename))) {
    return true;
  }

  return normalized
    .split('/')
    .some((segment) => segment && GIT_DISCOVERY_IGNORED_DIRS.has(segment));
}

function applyGitStatusPathExclusions(result: GitStatusResult): GitStatusResult {
  const shouldInclude = (entryPath: string) => !isGitStatusExcludedPath(entryPath);

  return {
    ...result,
    staged: result.staged.filter((entry) => shouldInclude(entry.path)),
    unstaged: result.unstaged.filter((entry) => shouldInclude(entry.path)),
    untracked: result.untracked.filter((entry) => shouldInclude(entry.path)),
  };
}

async function filterCommitRelevantStatus(
  repoPath: string,
  result: GitStatusResult,
): Promise<GitStatusResult> {
  const allPaths = [
    ...result.staged.map((entry) => entry.path),
    ...result.unstaged.map((entry) => entry.path),
    ...result.untracked.map((entry) => entry.path),
  ];

  if (allPaths.length === 0) {
    return result;
  }

  const ignoredPaths = await getGitIgnoredPathSet(repoPath, allPaths);
  const shouldInclude = (entryPath: string) => !ignoredPaths.has(entryPath);

  return {
    ...result,
    staged: result.staged.filter((entry) => shouldInclude(entry.path)),
    unstaged: result.unstaged.filter((entry) => shouldInclude(entry.path)),
    untracked: result.untracked.filter((entry) => shouldInclude(entry.path)),
  };
}

function isUntrackedDirectoryEntry(repoPath: string, entryPath: string): boolean {
  const normalized = entryPath.replace(/\\/g, '/');

  if (normalized.endsWith('/')) {
    return true;
  }

  try {
    return statSync(path.join(repoPath, normalized)).isDirectory();
  } catch {
    return false;
  }
}

function collectUntrackedFilesUnderDirectory(repoPath: string, directoryPath: string): string[] {
  const normalizedDir = directoryPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const absoluteDir = path.join(repoPath, normalizedDir);
  const files: string[] = [];
  const queue: string[] = [absoluteDir];

  while (queue.length > 0) {
    const currentDir = queue.shift();

    if (!currentDir) {
      continue;
    }

    let entries;

    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (shouldSkipGitDiscoveryDir(entry.name)) {
        continue;
      }

      const absoluteEntry = path.join(currentDir, entry.name);
      const relativeEntry = path.relative(repoPath, absoluteEntry).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (!isGitStatusExcludedPath(relativeEntry)) {
          queue.push(absoluteEntry);
        }

        continue;
      }

      if (entry.isFile() && !isGitStatusExcludedPath(relativeEntry)) {
        files.push(relativeEntry);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function expandUntrackedDirectoryEntries(
  repoPath: string,
  untracked: GitChangeEntry[],
): GitChangeEntry[] {
  const expanded: GitChangeEntry[] = [];

  for (const entry of untracked) {
    if (!isUntrackedDirectoryEntry(repoPath, entry.path)) {
      expanded.push(entry);
      continue;
    }

    const normalized = entry.path.replace(/\\/g, '/').replace(/\/+$/, '');
    const files = collectUntrackedFilesUnderDirectory(repoPath, normalized);

    if (files.length === 0) {
      expanded.push({ ...entry, path: normalized });
      continue;
    }

    for (const filePath of files) {
      expanded.push({ path: filePath, status: 'untracked' });
    }
  }

  return expanded;
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

function parseNumstatOutput(output: string): Map<string, { additions: number; deletions: number }> {
  const stats = new Map<string, { additions: number; deletions: number }>();

  for (const line of output.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    const parts = line.split('\t');

    if (parts.length < 3) {
      continue;
    }

    const [additionsRaw, deletionsRaw, ...pathParts] = parts;
    const filePath = pathParts.join('\t');
    const additions = additionsRaw === '-' ? 0 : Number(additionsRaw) || 0;
    const deletions = deletionsRaw === '-' ? 0 : Number(deletionsRaw) || 0;

    stats.set(filePath, { additions, deletions });
  }

  return stats;
}

function sumNumstatLines(output: string): number {
  let total = 0;

  for (const line of output.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    const parts = line.split('\t');

    if (parts.length < 3) {
      continue;
    }

    const additions = parts[0] === '-' ? 0 : Number(parts[0]) || 0;
    const deletions = parts[1] === '-' ? 0 : Number(parts[1]) || 0;
    total += additions + deletions;
  }

  return total;
}

function formatGitTimestampArg(unixMs: number): string {
  return `@${Math.floor(unixMs / 1000)}`;
}

async function getGitDailyStatsForRepo(
  repoPath: string,
  sinceMs: number,
  untilMs: number,
): Promise<GitDailyStats> {
  if (!isGitRepo(repoPath)) {
    return { commits: 0, linesChanged: 0 };
  }

  try {
    const since = formatGitTimestampArg(sinceMs);
    const until = formatGitTimestampArg(untilMs);
    const commitCountOutput = await runGit(repoPath, [
      'rev-list',
      '--count',
      `--since=${since}`,
      `--until=${until}`,
      'HEAD',
    ]);
    const commits = Number.parseInt(commitCountOutput.trim(), 10) || 0;
    const numstatOutput = await runGit(
      repoPath,
      ['log', `--since=${since}`, `--until=${until}`, '--pretty=tformat:', '--numstat'],
      { maxBuffer: 20 * 1024 * 1024 },
    );

    return {
      commits,
      linesChanged: sumNumstatLines(numstatOutput),
    };
  } catch {
    return { commits: 0, linesChanged: 0 };
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  });

  await Promise.all(workers);
  return results;
}

export async function aggregateGitDailyStats(
  projectPaths: string[],
  sinceMs: number,
  untilMs: number,
): Promise<GitDailyStats> {
  const seenRepos = new Set<string>();
  const repoPaths: string[] = [];

  for (const projectPath of projectPaths) {
    const repos = discoverGitRepos(projectPath);

    for (const repo of repos) {
      const resolved = path.resolve(repo.path);

      if (seenRepos.has(resolved)) {
        continue;
      }

      seenRepos.add(resolved);
      repoPaths.push(resolved);
    }
  }

  const results = await mapWithConcurrency(repoPaths, 8, (repoPath) =>
    getGitDailyStatsForRepo(repoPath, sinceMs, untilMs),
  );

  return results.reduce<GitDailyStats>(
    (totals, stats) => ({
      commits: totals.commits + stats.commits,
      linesChanged: totals.linesChanged + stats.linesChanged,
    }),
    { commits: 0, linesChanged: 0 },
  );
}

async function getNumstatMap(
  dirPath: string,
  staged: boolean,
): Promise<Map<string, { additions: number; deletions: number }>> {
  const resolved = resolveRepo(dirPath);

  if (!isGitRepo(resolved)) {
    return new Map();
  }

  try {
    const args = staged ? ['diff', '--cached', '--numstat'] : ['diff', '--numstat'];
    const output = await runGit(resolved, args);
    return parseNumstatOutput(output);
  } catch {
    return new Map();
  }
}

function countUntrackedLines(resolved: string, filePath: string): number {
  const absolutePath = path.join(resolved, filePath);

  try {
    const stats = statSync(absolutePath);

    if (!stats.isFile() || stats.size > MAX_UNTRACKED_LINE_COUNT_BYTES) {
      return 0;
    }

    const content = readFileSync(absolutePath, 'utf8');

    if (!content || content.includes('\0')) {
      return 0;
    }

    return content.split('\n').length;
  } catch {
    return 0;
  }
}

function applyStatsToEntry(
  entry: GitChangeEntry,
  stats: Map<string, { additions: number; deletions: number }>,
): GitChangeEntry {
  const fileStats = stats.get(entry.path);

  if (!fileStats) {
    return entry;
  }

  return {
    ...entry,
    additions: fileStats.additions,
    deletions: fileStats.deletions,
  };
}

async function enrichStatusWithStats(
  resolved: string,
  result: GitStatusResult,
): Promise<GitStatusResult> {
  const [stagedStats, unstagedStats] = await Promise.all([
    getNumstatMap(resolved, true),
    getNumstatMap(resolved, false),
  ]);

  return {
    ...result,
    staged: result.staged.map((entry) => applyStatsToEntry(entry, stagedStats)),
    unstaged: result.unstaged.map((entry) => applyStatsToEntry(entry, unstagedStats)),
    untracked: result.untracked.map((entry, index) => ({
      ...entry,
      additions:
        index < MAX_UNTRACKED_LINE_STATS ? countUntrackedLines(resolved, entry.path) : 0,
      deletions: 0,
    })),
  };
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

  const output = await runGit(resolved, buildGitStatusArgs());
  const parsed = parseStatusOutput(output, resolved);
  const expandedUntracked = {
    ...parsed,
    untracked: expandUntrackedDirectoryEntries(resolved, parsed.untracked),
  };
  const pathFiltered = applyGitStatusPathExclusions(expandedUntracked);
  const enriched = await enrichStatusWithStats(resolved, pathFiltered);
  const result = await filterCommitRelevantStatus(resolved, enriched);
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

    invalidateCacheAndNotify(resolved);
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

    invalidateCacheAndNotify(resolved);
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

    const statusOutput = await runGit(resolved, buildGitPorcelainStatusArgs());
    const status = await enrichStatusWithStats(
      resolved,
      parseStatusOutput(statusOutput, resolved),
    );
    const untrackedPaths = new Set(status.untracked.map((entry) => entry.path));
    const trackedPaths: string[] = [];
    const cleanPaths: string[] = [];

    for (const filePath of paths) {
      if (untrackedPaths.has(filePath)) {
        cleanPaths.push(filePath);
        continue;
      }

      trackedPaths.push(filePath);
    }

    if (trackedPaths.length > 0) {
      await runGit(resolved, ['restore', '--staged', '--worktree', '--', ...trackedPaths]);
    }

    if (cleanPaths.length > 0) {
      await runGit(resolved, ['clean', '-fd', '--', ...cleanPaths]);
    }

    invalidateCacheAndNotify(resolved);
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
    invalidateCacheAndNotify(resolved);
    return { ok: true };
  } catch (error) {
    return toCommandResult(error);
  }
}

function resolveGitFileInRepo(
  repoRoot: string,
  filePath: string,
): { relativePath: string; absolutePath: string } {
  const resolvedRoot = path.resolve(repoRoot);
  const normalizedInput = filePath.replace(/\\/g, '/');

  let relativePath: string;
  let absolutePath: string;

  if (path.isAbsolute(filePath)) {
    absolutePath = path.resolve(filePath);
    relativePath = path.relative(resolvedRoot, absolutePath).replace(/\\/g, '/');
  } else {
    relativePath = normalizedInput.replace(/^\/+/, '').replace(/^\.\/+/, '');
    absolutePath = path.resolve(resolvedRoot, relativePath);
    relativePath = path.relative(resolvedRoot, absolutePath).replace(/\\/g, '/');
  }

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    const fileName = path.basename(normalizedInput);
    relativePath = fileName;
    absolutePath = path.resolve(resolvedRoot, fileName);
  }

  return { relativePath, absolutePath };
}

async function readGitBlobBuffer(repoRoot: string, spec: string): Promise<Buffer | null> {
  try {
    const resolved = resolveRepo(repoRoot);
    const { stdout } = await execFileAsync('git', ['-C', resolved, 'show', spec], {
      encoding: 'buffer',
      maxBuffer: MAX_GIT_BLOB_BUFFER_BYTES,
      timeout: 120_000,
    });

    if (stdout.length > MAX_GIT_BLOB_BUFFER_BYTES) {
      return null;
    }

    return stdout;
  } catch {
    return null;
  }
}

async function readWorktreeFileBuffer(absolutePath: string): Promise<Buffer | null> {
  try {
    const fileStats = statSync(absolutePath);

    if (!fileStats.isFile() || fileStats.size > MAX_GIT_BLOB_BUFFER_BYTES) {
      return null;
    }

    return await readFile(absolutePath);
  } catch {
    return null;
  }
}

function toImageDataUrl(buffer: Buffer | null, absolutePath: string): string | null {
  return bufferToDataUrlIfWithinLimit(buffer, absolutePath);
}

function truncateDiffText(content: string): string {
  if (content.length <= MAX_DIFF_TEXT_CHARS) {
    return content;
  }

  return `${content.slice(0, MAX_DIFF_TEXT_CHARS)}\n\n… (diff truncado para manter o app estável)`;
}

async function readGitBlob(repoRoot: string, spec: string): Promise<string | null> {
  try {
    return await runGit(repoRoot, ['show', spec]);
  } catch {
    return null;
  }
}

function readWorktreeFile(absolutePath: string): string {
  try {
    return readFileSync(absolutePath, 'utf8');
  } catch {
    return '';
  }
}

export async function getGitDiff(
  dirPath: string,
  filePath: string,
  staged: boolean,
): Promise<GitDiffResult> {
  const resolved = resolveRepo(dirPath);
  const { relativePath } = resolveGitFileInRepo(resolved, filePath);
  const args = staged ? ['diff', '--cached', '--', relativePath] : ['diff', '--', relativePath];
  const patch = await runGit(resolved, args);

  return { path: relativePath, patch };
}

export async function getGitFileDiffSides(
  dirPath: string,
  filePath: string,
  options: { staged: boolean; untracked?: boolean },
): Promise<GitFileDiffSidesResult> {
  const resolved = resolveGitRepoForFilePath(dirPath, filePath);
  const { relativePath, absolutePath } = resolveGitFileInRepo(resolved, filePath);

  if (options.untracked) {
    return {
      path: relativePath,
      before: '',
      after: truncateDiffText(readWorktreeFile(absolutePath)),
    };
  }

  if (options.staged) {
    const before = (await readGitBlob(resolved, `HEAD:${relativePath}`)) ?? '';
    const indexContent = await readGitBlob(resolved, `:${relativePath}`);
    const after = indexContent ?? readWorktreeFile(absolutePath);

    return {
      path: relativePath,
      before: truncateDiffText(before),
      after: truncateDiffText(after),
    };
  }

  const indexContent = await readGitBlob(resolved, `:${relativePath}`);
  const headContent = await readGitBlob(resolved, `HEAD:${relativePath}`);
  const before = indexContent ?? headContent ?? '';
  const after = readWorktreeFile(absolutePath);

  return {
    path: relativePath,
    before: truncateDiffText(before),
    after: truncateDiffText(after),
  };
}

export async function getGitFileDiffImageSides(
  dirPath: string,
  filePath: string,
  options: { staged: boolean; untracked?: boolean },
): Promise<GitFileDiffImageSidesResult> {
  const resolved = resolveGitRepoForFilePath(dirPath, filePath);
  const { relativePath, absolutePath } = resolveGitFileInRepo(resolved, filePath);

  if (options.untracked) {
    const afterBuffer = await readWorktreeFileBuffer(absolutePath);

    return {
      path: relativePath,
      before: null,
      after: toImageDataUrl(afterBuffer, absolutePath),
    };
  }

  if (options.staged) {
    const beforeBuffer = await readGitBlobBuffer(resolved, `HEAD:${relativePath}`);
    const indexBuffer = await readGitBlobBuffer(resolved, `:${relativePath}`);
    const afterBuffer = indexBuffer ?? (await readWorktreeFileBuffer(absolutePath));

    return {
      path: relativePath,
      before: toImageDataUrl(beforeBuffer, absolutePath),
      after: toImageDataUrl(afterBuffer, absolutePath),
    };
  }

  const indexBuffer = await readGitBlobBuffer(resolved, `:${relativePath}`);
  const headBuffer = await readGitBlobBuffer(resolved, `HEAD:${relativePath}`);
  const beforeBuffer = indexBuffer ?? headBuffer;
  const afterBuffer = await readWorktreeFileBuffer(absolutePath);

  return {
    path: relativePath,
    before: toImageDataUrl(beforeBuffer, absolutePath),
    after: toImageDataUrl(afterBuffer, absolutePath),
  };
}

export async function pullGit(dirPath: string): Promise<GitCommandResult> {
  const resolved = resolveRepo(dirPath);

  try {
    await runGit(resolved, ['pull']);
    invalidateCacheAndNotify(resolved);
    return { ok: true };
  } catch (error) {
    return toCommandResult(error);
  }
}

export async function pushGit(dirPath: string): Promise<GitCommandResult> {
  const resolved = resolveRepo(dirPath);

  try {
    await runGit(resolved, ['push']);
    invalidateCacheAndNotify(resolved);
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
    invalidateCacheAndNotify(resolved);
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
    invalidateCacheAndNotify(resolved);
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
    invalidateCacheAndNotify(resolved);
    return { ok: true };
  } catch (error) {
    return toCommandResult(error);
  }
}

export async function stashPopGit(dirPath: string): Promise<GitCommandResult> {
  const resolved = resolveRepo(dirPath);

  try {
    await runGit(resolved, ['stash', 'pop']);
    invalidateCacheAndNotify(resolved);
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

  if (!isGitRepo(resolved)) {
    return;
  }

  const nextRefCount = (watchRefCounts.get(resolved) ?? 0) + 1;
  watchRefCounts.set(resolved, nextRefCount);

  if (watchStates.has(resolved)) {
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
      discoveryCache.delete(resolved);
      notifyRepoChanged(resolved);
    }, WATCH_DEBOUNCE_MS);
  };

  const metaWatchers: FSWatcher[] = [];
  const gitDir = path.join(resolved, '.git');

  if (existsSync(gitDir) && statSync(gitDir).isDirectory()) {
    for (const metaFile of ['HEAD', 'index'] as const) {
      const metaPath = path.join(gitDir, metaFile);

      if (!existsSync(metaPath) || !statSync(metaPath).isFile()) {
        continue;
      }

      try {
        metaWatchers.push(watch(metaPath, scheduleNotify));
      } catch {
        // ignore metadata watch failures
      }
    }
  }

  try {
    const watcher = watch(resolved, { recursive: true }, (_event, filename) => {
      if (typeof filename !== 'string' || filename.length === 0) {
        return;
      }

      const changedPath = path.join(resolved, filename);

      if (shouldIgnoreWatchPath(resolved, changedPath)) {
        return;
      }

      scheduleNotify();
    });
    watchStates.set(resolved, { watcher, metaWatchers, debounceTimer: null, repoPath: resolved });
  } catch {
    for (const metaWatcher of metaWatchers) {
      metaWatcher.close();
    }
    watchRefCounts.set(resolved, Math.max(0, (watchRefCounts.get(resolved) ?? 1) - 1));

    if ((watchRefCounts.get(resolved) ?? 0) === 0) {
      watchRefCounts.delete(resolved);
    }
  }
}

export function unwatchGitRepo(dirPath: string): void {
  const resolved = resolveRepo(dirPath);
  const nextRefCount = Math.max(0, (watchRefCounts.get(resolved) ?? 0) - 1);

  if (nextRefCount > 0) {
    watchRefCounts.set(resolved, nextRefCount);
    return;
  }

  watchRefCounts.delete(resolved);

  const state = watchStates.get(resolved);

  if (!state) {
    return;
  }

  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
  }

  state.watcher.close();

  for (const metaWatcher of state.metaWatchers) {
    metaWatcher.close();
  }

  watchStates.delete(resolved);
}
