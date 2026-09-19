import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0', '[::]', '::']);

let queueDir = '';
let hookToken = '';
let watcher: FSWatcher | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let drainTimer: ReturnType<typeof setTimeout> | null = null;
let onOpenUrl: ((url: string, ptyId: string | null) => void) | null = null;

export function resolveInterceptedDevBrowserUrl(raw: string): string | null {
  const trimmed = raw.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    if (!LOCAL_HOSTS.has(parsed.hostname)) {
      return null;
    }

    if (parsed.hostname === '0.0.0.0' || parsed.hostname === '[::]' || parsed.hostname === '::') {
      parsed.hostname = 'localhost';
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function getQueueDir(): string {
  return path.join(os.homedir(), '.nexus-ide-dev-browser');
}

function processQueueFile(filePath: string): void {
  let raw = '';

  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return;
  }

  const parts = raw.split('\n');

  if (parts.length < 3) {
    return;
  }

  try {
    unlinkSync(filePath);
  } catch {
    return;
  }

  const token = parts[0]?.trim() ?? '';
  const ptyId = parts[1]?.trim() ?? '';
  const url = parts.slice(2).join('\n').trim();

  if (!hookToken || token !== hookToken) {
    return;
  }

  const resolved = resolveInterceptedDevBrowserUrl(url);

  if (!resolved) {
    return;
  }

  onOpenUrl?.(resolved, ptyId || null);
}

function drainQueue(): void {
  if (!queueDir || !existsSync(queueDir)) {
    return;
  }

  let names: string[] = [];

  try {
    names = readdirSync(queueDir);
  } catch {
    return;
  }

  for (const name of names) {
    if (!name || name.startsWith('.')) {
      continue;
    }

    processQueueFile(path.join(queueDir, name));
  }
}

function scheduleDrain(): void {
  if (drainTimer) {
    return;
  }

  drainTimer = setTimeout(() => {
    drainTimer = null;
    drainQueue();
  }, 40);
}

export function getDevBrowserHookEnv(): Record<string, string> {
  if (!queueDir || !hookToken) {
    return {};
  }

  return {
    NEXUS_BROWSER_QUEUE: queueDir,
    NEXUS_BROWSER_TOKEN: hookToken,
  };
}

export function startDevBrowserHook(handler: (url: string, ptyId: string | null) => void): void {
  onOpenUrl = handler;

  if (watcher) {
    return;
  }

  hookToken = randomBytes(16).toString('hex');
  queueDir = getQueueDir();

  mkdirSync(queueDir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(queueDir, '.token'), `${hookToken}\n`, { mode: 0o600 });

  try {
    watcher = watch(queueDir, () => {
      scheduleDrain();
    });
  } catch {
    watcher = null;
  }

  pollTimer = setInterval(() => {
    drainQueue();
  }, 250);

  drainQueue();
}

export function stopDevBrowserHook(): void {
  if (queueDir) {
    try {
      unlinkSync(path.join(queueDir, '.token'));
    } catch {
    }
  }

  if (drainTimer) {
    clearTimeout(drainTimer);
    drainTimer = null;
  }

  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  if (watcher) {
    watcher.close();
    watcher = null;
  }

  queueDir = '';
  hookToken = '';
  onOpenUrl = null;
}
