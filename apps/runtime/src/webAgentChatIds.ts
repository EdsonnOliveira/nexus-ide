import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function webAgentChatIdsPath(): string {
  const dir = path.join(os.homedir(), '.nexus', 'runtime');
  mkdirSync(dir, { recursive: true });
  return path.join(dir, 'web-agent-chat-ids.json');
}

function readWebAgentChatIds(): string[] {
  const filePath = webAgentChatIdsPath();

  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  } catch {
    return [];
  }
}

const MAX_WEB_AGENT_CHAT_IDS = 500;

export function rememberWebAgentChatId(chatId: string): void {
  const trimmed = chatId.trim();

  if (!trimmed) {
    return;
  }

  const current = readWebAgentChatIds();

  if (current.includes(trimmed)) {
    return;
  }

  const next = [...current, trimmed].slice(-MAX_WEB_AGENT_CHAT_IDS);

  writeFileSync(webAgentChatIdsPath(), JSON.stringify(next, null, 0), {
    mode: 0o600,
  });
}
