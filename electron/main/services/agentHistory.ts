import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
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

const MAX_HISTORY_ENTRIES = 40;

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

  const sessions: CursorAgentHistoryEntry[] = [];

  for (const sessionId of sessionIds) {
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
