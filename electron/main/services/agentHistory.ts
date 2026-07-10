import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveDirectoryPath } from './directoryListing';

export interface CursorAgentHistoryEntry {
  id: string;
  title: string;
  updatedAtMs: number;
}

interface CursorAgentSessionMeta {
  hasConversation?: boolean;
  title?: string;
  updatedAtMs?: number;
}

const MAX_HISTORY_ENTRIES = 5;
const HISTORY_META_PROBE_COUNT = 8;

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

  for (const { sessionId } of rankedSessions) {
    const metaPath = join(chatsDir, sessionId, 'meta.json');

    try {
      const raw = await readFile(metaPath, 'utf8');
      const meta = JSON.parse(raw) as CursorAgentSessionMeta;

      if (!meta.hasConversation) {
        continue;
      }

      const title = meta.title?.trim();

      sessions.push({
        id: sessionId,
        title: title || sessionId.slice(0, 8),
        updatedAtMs: meta.updatedAtMs ?? 0,
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
    try {
      return await readFile(directPath, 'utf8');
    } catch {
      return null;
    }
  }

  const slug = resolveCursorProjectSlug(workspacePath);
  const baseDir = join(homedir(), '.cursor', 'projects', slug, 'agent-transcripts');
  const fallbackPath = resolveCursorAgentTranscriptPathFallback(baseDir, trimmed);

  if (!fallbackPath) {
    return null;
  }

  try {
    return await readFile(fallbackPath, 'utf8');
  } catch {
    return null;
  }
}
