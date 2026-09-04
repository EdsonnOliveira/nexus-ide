import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { getGitDailyStatsForRepo, type GitDailyStats } from './git';
import { formatLocalDateKeyFromMs } from './homeActivityStore';

export type DashboardAiProvider = 'cursor' | 'claude' | 'codex' | 'opencode' | 'antigravity';

export interface ProviderDayActivity {
  agentExecutions: number;
  prompts: number;
}

export interface ProviderActivityScan {
  gitPaths: string[];
  activityByDay: Record<string, ProviderDayActivity>;
}

const WORKSPACE_PATHS_TTL_MS = 5 * 60 * 1000;
const TIMESTAMP_TAG_PATTERN = /<timestamp>\s*([^<]+?)\s*<\/timestamp>/i;
const USER_QUERY_PATTERN = /<user_query>[\s\S]*?<\/user_query>/i;

let cachedCursorWorkspacePaths: { expiresAt: number; paths: string[] } | null = null;

function emptyDayActivity(): ProviderDayActivity {
  return { agentExecutions: 0, prompts: 0 };
}

function ensureDay(
  activityByDay: Record<string, ProviderDayActivity>,
  dayKey: string,
): ProviderDayActivity {
  const current = activityByDay[dayKey];

  if (current) {
    return current;
  }

  const created = emptyDayActivity();
  activityByDay[dayKey] = created;
  return created;
}

function resolveCursorUserDir(): string | null {
  const home = homedir();
  let userDir: string;

  if (platform() === 'darwin') {
    userDir = path.join(home, 'Library', 'Application Support', 'Cursor', 'User');
  } else if (platform() === 'win32') {
    userDir = path.join(
      process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'),
      'Cursor',
      'User',
    );
  } else {
    userDir = path.join(home, '.config', 'Cursor', 'User');
  }

  return existsSync(userDir) ? userDir : null;
}

function decodeFileUri(raw: string): string | null {
  const trimmed = raw.trim();

  if (!trimmed.startsWith('file://')) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(trimmed.replace(/^file:\/\//, ''));

    if (platform() === 'win32') {
      return decoded.replace(/^\//, '');
    }

    return decoded;
  } catch {
    return null;
  }
}

function collectCursorWorkspacePaths(): string[] {
  const now = Date.now();
  const cached = cachedCursorWorkspacePaths;

  if (cached && cached.expiresAt > now) {
    return cached.paths;
  }

  const userDir = resolveCursorUserDir();
  const paths = new Set<string>();

  if (userDir) {
    const storageDir = path.join(userDir, 'workspaceStorage');

    if (existsSync(storageDir)) {
      let entries: string[] = [];

      try {
        entries = readdirSync(storageDir);
      } catch {
        entries = [];
      }

      for (const entry of entries) {
        const workspaceFile = path.join(storageDir, entry, 'workspace.json');

        if (!existsSync(workspaceFile)) {
          continue;
        }

        try {
          const parsed = JSON.parse(readFileSync(workspaceFile, 'utf8')) as {
            folder?: unknown;
          };
          const folder =
            typeof parsed.folder === 'string' ? decodeFileUri(parsed.folder) : null;

          if (!folder || folder === homedir() || folder === '/') {
            continue;
          }

          if (existsSync(folder) && statSync(folder).isDirectory()) {
            paths.add(path.resolve(folder));
          }
        } catch {
          continue;
        }
      }
    }
  }

  const list = Array.from(paths);
  cachedCursorWorkspacePaths = {
    expiresAt: now + WORKSPACE_PATHS_TTL_MS,
    paths: list,
  };

  return list;
}

function collectClaudeWorkspacePaths(): string[] {
  const projectsDir = path.join(homedir(), '.claude', 'projects');

  if (!existsSync(projectsDir)) {
    return [];
  }

  let entries: string[] = [];

  try {
    entries = readdirSync(projectsDir);
  } catch {
    return [];
  }

  const paths = new Set<string>();

  for (const entry of entries) {
    if (!entry.startsWith('-')) {
      continue;
    }

    const candidate = `/${entry.slice(1).replace(/-/g, '/')}`;

    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      paths.add(path.resolve(candidate));
    }
  }

  return Array.from(paths);
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }

      if (part && typeof part === 'object' && 'text' in part) {
        const text = (part as { text?: unknown }).text;
        return typeof text === 'string' ? text : '';
      }

      return '';
    })
    .join('\n');
}

function hasToolResult(content: unknown): boolean {
  if (!Array.isArray(content)) {
    return false;
  }

  return content.some((part) => {
    if (!part || typeof part !== 'object') {
      return false;
    }

    const type = (part as { type?: unknown }).type;
    return type === 'tool_result' || type === 'tool_use';
  });
}

function parseTimestampMs(raw: string): number | null {
  const parsed = Date.parse(raw.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function extractPromptTimeMs(text: string, fallbackMs: number | null): number | null {
  const tagged = TIMESTAMP_TAG_PATTERN.exec(text);

  if (tagged?.[1]) {
    return parseTimestampMs(tagged[1]) ?? fallbackMs;
  }

  return fallbackMs;
}

function isCursorUserPrompt(role: string | undefined, text: string): boolean {
  if (role !== 'user' || !text.trim()) {
    return false;
  }

  return USER_QUERY_PATTERN.test(text) || TIMESTAMP_TAG_PATTERN.test(text);
}

function isClaudeUserPrompt(
  type: string | undefined,
  role: string | undefined,
  content: unknown,
  text: string,
): boolean {
  if (hasToolResult(content) || !text.trim()) {
    return false;
  }

  return type === 'user' || role === 'user';
}

async function collectPromptTimesFromJsonl(
  filePath: string,
  kind: DashboardAiProvider,
): Promise<number[]> {
  const times: number[] = [];
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let fileMtimeMs: number | null = null;

  try {
    fileMtimeMs = statSync(filePath).mtimeMs;
  } catch {
    fileMtimeMs = null;
  }

  for await (const line of reader) {
    const trimmed = line.trim();

    if (!trimmed.startsWith('{')) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as {
        role?: string;
        type?: string;
        timestamp?: string;
        message?: { role?: string; content?: unknown };
      };
      const content = parsed.message?.content;
      const text = extractTextContent(content);
      const isoTime = typeof parsed.timestamp === 'string' ? parseTimestampMs(parsed.timestamp) : null;
      const isPrompt =
        kind === 'cursor'
          ? isCursorUserPrompt(parsed.role ?? parsed.message?.role, text)
          : isClaudeUserPrompt(
              parsed.type,
              parsed.role ?? parsed.message?.role,
              content,
              text,
            );

      if (!isPrompt) {
        continue;
      }

      const timeMs = extractPromptTimeMs(text, isoTime ?? fileMtimeMs);

      if (timeMs !== null) {
        times.push(timeMs);
      }
    } catch {
      continue;
    }
  }

  return times;
}

async function listRecentJsonlFiles(rootDir: string, minMtimeMs: number): Promise<string[]> {
  if (!existsSync(rootDir)) {
    return [];
  }

  let entries: string[] = [];

  try {
    entries = readdirSync(rootDir);
  } catch {
    return [];
  }

  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry);
    let stats;

    try {
      stats = statSync(entryPath);
    } catch {
      continue;
    }

    if (stats.isFile() && entry.endsWith('.jsonl') && stats.mtimeMs >= minMtimeMs) {
      files.push(entryPath);
      continue;
    }

    if (!stats.isDirectory()) {
      continue;
    }

    let childNames: string[] = [];

    try {
      childNames = readdirSync(entryPath);
    } catch {
      continue;
    }

    for (const childName of childNames) {
      if (!childName.endsWith('.jsonl')) {
        continue;
      }

      const childPath = path.join(entryPath, childName);

      try {
        const childStats = statSync(childPath);

        if (childStats.isFile() && childStats.mtimeMs >= minMtimeMs) {
          files.push(childPath);
        }
      } catch {
        continue;
      }
    }
  }

  return files;
}

async function collectCursorTranscriptFiles(minMtimeMs: number): Promise<string[]> {
  const projectsDir = path.join(homedir(), '.cursor', 'projects');

  if (!existsSync(projectsDir)) {
    return [];
  }

  let projectNames: string[] = [];

  try {
    projectNames = readdirSync(projectsDir);
  } catch {
    return [];
  }

  const files: string[] = [];

  for (const name of projectNames) {
    const transcriptsDir = path.join(projectsDir, name, 'agent-transcripts');
    const found = await listRecentJsonlFiles(transcriptsDir, minMtimeMs);
    files.push(...found);
  }

  return files;
}

async function collectClaudeTranscriptFiles(minMtimeMs: number): Promise<string[]> {
  const projectsDir = path.join(homedir(), '.claude', 'projects');

  if (!existsSync(projectsDir)) {
    return [];
  }

  let projectNames: string[] = [];

  try {
    projectNames = readdirSync(projectsDir);
  } catch {
    return [];
  }

  const files: string[] = [];

  for (const name of projectNames) {
    const found = await listRecentJsonlFiles(path.join(projectsDir, name), minMtimeMs);
    files.push(...found);
  }

  return files;
}

export async function scanAiProviderActivity(
  provider: DashboardAiProvider,
  rangeStartMs: number,
  rangeEndMs: number,
): Promise<ProviderActivityScan> {
  if (provider === 'opencode' || provider === 'antigravity' || provider === 'codex') {
    return {
      gitPaths: [],
      activityByDay: {},
    };
  }

  const activityByDay: Record<string, ProviderDayActivity> = {};
  const files =
    provider === 'cursor'
      ? await collectCursorTranscriptFiles(rangeStartMs)
      : await collectClaudeTranscriptFiles(rangeStartMs);

  for (const filePath of files) {
    const promptTimes = await collectPromptTimesFromJsonl(filePath, provider);
    const countedDays = new Set<string>();

    for (const promptMs of promptTimes) {
      if (promptMs < rangeStartMs || promptMs >= rangeEndMs) {
        continue;
      }

      const dayKey = formatLocalDateKeyFromMs(promptMs);
      const day = ensureDay(activityByDay, dayKey);
      day.prompts += 1;
      countedDays.add(dayKey);
    }

    for (const dayKey of Array.from(countedDays)) {
      ensureDay(activityByDay, dayKey).agentExecutions += 1;
    }
  }

  return {
    gitPaths: provider === 'cursor' ? collectCursorWorkspacePaths() : collectClaudeWorkspacePaths(),
    activityByDay,
  };
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

export async function aggregateProviderGitDailyStats(
  projectPaths: string[],
  sinceMs: number,
  untilMs: number,
): Promise<GitDailyStats> {
  const uniquePaths = Array.from(new Set(projectPaths.map((item) => path.resolve(item))));
  const repoPaths = uniquePaths.filter((projectPath) =>
    existsSync(path.join(projectPath, '.git')),
  );
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
