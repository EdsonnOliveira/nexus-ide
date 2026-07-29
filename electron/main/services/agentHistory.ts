import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveDirectoryPath } from './directoryListing';

export interface CursorAgentHistoryEntry {
  id: string;
  title: string;
  updatedAtMs: number;
  fromWeb: boolean;
}

interface CursorAgentSessionMeta {
  hasConversation?: boolean;
  title?: string;
  updatedAtMs?: number;
}

const MAX_HISTORY_ENTRIES = 5;
const HISTORY_META_PROBE_COUNT = 8;
const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;
const HISTORY_TITLE_PROBE_BYTES = 64 * 1024;
const USER_QUERY_PATTERN = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/i;

function readWebAgentChatIdSet(): Set<string> {
  const filePath = join(homedir(), '.nexus', 'runtime', 'web-agent-chat-ids.json');

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;

    if (!Array.isArray(parsed)) {
      return new Set();
    }

    return new Set(
      parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0),
    );
  } catch {
    return new Set();
  }
}

function normalizeHistoryTitle(raw: string): string {
  const cleaned = raw.replace(/\s+/g, ' ').trim();

  if (!cleaned) {
    return '';
  }

  if (cleaned.length <= 80) {
    return cleaned;
  }

  return `${cleaned.slice(0, 79)}…`;
}

function isPlaceholderHistoryTitle(title: string, sessionId: string): boolean {
  const trimmed = title.trim();

  if (!trimmed) {
    return true;
  }

  if (/^new agent$/i.test(trimmed)) {
    return true;
  }

  if (trimmed === sessionId.slice(0, 8)) {
    return true;
  }

  return /^[0-9a-f]{8}$/i.test(trimmed);
}

async function readTranscriptHead(filePath: string): Promise<string | null> {
  try {
    const fileStats = await stat(filePath);

    if (!fileStats.isFile() || fileStats.size <= 0) {
      return null;
    }

    const handle = await open(filePath, 'r');

    try {
      const size = Math.min(fileStats.size, HISTORY_TITLE_PROBE_BYTES);
      const buffer = Buffer.alloc(size);
      await handle.read(buffer, 0, size, 0);
      return buffer.toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

function extractTitleFromTranscriptHead(raw: string): string | null {
  const lines = raw.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as {
        role?: string;
        message?: { content?: Array<{ type?: string; text?: string }> };
      };

      if (parsed.role !== 'user') {
        continue;
      }

      const text = (parsed.message?.content ?? [])
        .filter((part) => part.type === 'text')
        .map((part) => part.text ?? '')
        .join('')
        .trim();

      if (!text) {
        continue;
      }

      const queryMatch = USER_QUERY_PATTERN.exec(text);
      const title = normalizeHistoryTitle(queryMatch?.[1] ?? text);

      if (title) {
        return title;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function readTranscriptWithinLimit(filePath: string): Promise<string | null> {
  try {
    const fileStats = await stat(filePath);

    if (!fileStats.isFile()) {
      return null;
    }

    if (fileStats.size <= MAX_TRANSCRIPT_BYTES) {
      return await readFile(filePath, 'utf8');
    }

    const handle = await open(filePath, 'r');

    try {
      const buffer = Buffer.alloc(MAX_TRANSCRIPT_BYTES);
      await handle.read(buffer, 0, MAX_TRANSCRIPT_BYTES, fileStats.size - MAX_TRANSCRIPT_BYTES);
      return buffer.toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

function resolveWorkspaceHash(workspacePath: string): string {
  const resolved = resolveDirectoryPath(workspacePath);

  return createHash('md5').update(resolved).digest('hex');
}

export async function listCursorAgentHistory(
  workspacePath: string,
): Promise<CursorAgentHistoryEntry[]> {
  const hash = resolveWorkspaceHash(workspacePath);
  const chatsDir = join(homedir(), '.cursor', 'chats', hash);
  let sessionIds: string[] = [];

  try {
    sessionIds = await readdir(chatsDir);
  } catch {
    return [];
  }

  const rankedSessions = (
    await Promise.all(
      sessionIds.map(async (sessionId) => {
        const metaPath = join(chatsDir, sessionId, 'meta.json');

        try {
          const fileStat = await stat(metaPath);
          return { sessionId, mtimeMs: fileStat.mtimeMs };
        } catch {
          return null;
        }
      }),
    )
  )
    .filter((entry): entry is { sessionId: string; mtimeMs: number } => entry !== null)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, HISTORY_META_PROBE_COUNT);

  const sessions: CursorAgentHistoryEntry[] = [];
  const webChatIds = readWebAgentChatIdSet();

  for (const { sessionId } of rankedSessions) {
    const metaPath = join(chatsDir, sessionId, 'meta.json');

    try {
      const raw = await readFile(metaPath, 'utf8');
      const meta = JSON.parse(raw) as CursorAgentSessionMeta;

      if (!meta.hasConversation) {
        continue;
      }

      const metaTitle = normalizeHistoryTitle(meta.title ?? '');
      let title = metaTitle;

      if (isPlaceholderHistoryTitle(title, sessionId)) {
        const transcriptPath =
          resolveCursorAgentTranscriptPath(workspacePath, sessionId) ??
          resolveCursorAgentTranscriptPathFallback(
            join(homedir(), '.cursor', 'projects', resolveCursorProjectSlug(workspacePath), 'agent-transcripts'),
            sessionId,
          );

        if (transcriptPath) {
          const transcriptHead = await readTranscriptHead(transcriptPath);
          const transcriptTitle = transcriptHead
            ? extractTitleFromTranscriptHead(transcriptHead)
            : null;

          if (transcriptTitle) {
            title = transcriptTitle;
          }
        }
      }

      if (isPlaceholderHistoryTitle(title, sessionId)) {
        title = sessionId.slice(0, 8);
      }

      sessions.push({
        id: sessionId,
        title,
        updatedAtMs: meta.updatedAtMs ?? 0,
        fromWeb: webChatIds.has(sessionId),
      });
    } catch {
      continue;
    }
  }

  return sessions.sort((left, right) => right.updatedAtMs - left.updatedAtMs).slice(0, MAX_HISTORY_ENTRIES);
}

function resolveCursorProjectSlug(workspacePath: string): string {
  return resolveDirectoryPath(workspacePath)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\//g, '-');
}

function resolveCursorAgentTranscriptPath(workspacePath: string, sessionId: string): string | null {
  const slug = resolveCursorProjectSlug(workspacePath);
  const baseDir = join(homedir(), '.cursor', 'projects', slug, 'agent-transcripts');
  const trimmed = sessionId.trim();
  const candidates = [
    join(baseDir, trimmed, `${trimmed}.jsonl`),
    join(baseDir, `${trimmed}.jsonl`),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveCursorAgentTranscriptPathFallback(
  baseDir: string,
  sessionId: string,
): string | null {
  const trimmed = sessionId.trim();

  let sessionDirs: string[] = [];

  try {
    sessionDirs = readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return null;
  }

  const matchedDir =
    sessionDirs.find((dir) => dir === trimmed) ??
    sessionDirs.find((dir) => dir.startsWith(trimmed) || trimmed.startsWith(dir)) ??
    sessionDirs.find((dir) => dir.slice(0, 8) === trimmed.slice(0, 8));

  if (!matchedDir) {
    return null;
  }

  const candidate = join(baseDir, matchedDir, `${matchedDir}.jsonl`);

  return existsSync(candidate) ? candidate : null;
}

export async function loadCursorAgentSessionTranscript(
  workspacePath: string,
  sessionId: string,
): Promise<string | null> {
  const trimmed = sessionId.trim();

  if (!trimmed) {
    return null;
  }

  const directPath = resolveCursorAgentTranscriptPath(workspacePath, trimmed);

  if (directPath) {
    return readTranscriptWithinLimit(directPath);
  }

  const slug = resolveCursorProjectSlug(workspacePath);
  const baseDir = join(homedir(), '.cursor', 'projects', slug, 'agent-transcripts');
  const fallbackPath = resolveCursorAgentTranscriptPathFallback(baseDir, trimmed);

  if (!fallbackPath) {
    return null;
  }

  return readTranscriptWithinLimit(fallbackPath);
}
