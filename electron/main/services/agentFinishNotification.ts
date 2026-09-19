import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import {
  focusAgentPipMainWindow,
  getAgentPipMainWindow,
  isNexusInForeground,
} from './agentPipWindow';

export interface AgentFinishNotifyPayload {
  projectId: string;
  paneId: string;
  projectName: string;
}

export interface AgentFinishActionPayload {
  action: 'git' | 'open';
  projectId: string;
  paneId: string;
}

const DEDUPE_MS = 15_000;
const SHOWN_TIMEOUT_MS = 20_000;
const recentShownAt = new Map<string, number>();
const activeHelpers = new Map<string, ChildProcess>();

app.on('before-quit', () => {
  for (const key of Array.from(activeHelpers.keys())) {
    stopHelper(key);
  }
});

function payloadKey(payload: AgentFinishNotifyPayload): string {
  return `${payload.projectId}:${payload.paneId}`;
}

function wasShownRecently(key: string): boolean {
  const shownAt = recentShownAt.get(key);
  if (!shownAt) {
    return false;
  }

  if (Date.now() - shownAt < DEDUPE_MS) {
    return true;
  }

  recentShownAt.delete(key);
  return false;
}

function deliverAction(action: 'git' | 'open', payload: AgentFinishNotifyPayload): void {
  focusAgentPipMainWindow();
  const win = getAgentPipMainWindow();
  if (!win || win.isDestroyed()) {
    return;
  }

  const message: AgentFinishActionPayload = {
    action,
    projectId: payload.projectId,
    paneId: payload.paneId,
  };
  win.webContents.send('agentFinish:action', message);
}

function resolveNotificationHelperBinary(): string | null {
  const candidates = [
    path.join(
      process.cwd(),
      'resources/shell/NotificationHelper.app/Contents/MacOS/NotificationHelper',
    ),
    path.join(
      app.getAppPath(),
      'Contents/Helpers/NotificationHelper.app/Contents/MacOS/NotificationHelper',
    ),
    path.join(
      process.resourcesPath,
      '../Helpers/NotificationHelper.app/Contents/MacOS/NotificationHelper',
    ),
    path.join(process.cwd(), 'resources/shell/macosNotificationReader'),
    path.join(process.resourcesPath, 'macosNotificationReader'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function stopHelper(key: string): void {
  const current = activeHelpers.get(key);
  if (!current) {
    return;
  }

  activeHelpers.delete(key);
  if (!current.killed) {
    current.kill();
  }
}

function parseHelperLine(line: string): { shown?: boolean; action?: string } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as { shown?: unknown; action?: unknown };
    const result: { shown?: boolean; action?: string } = {};
    if (typeof parsed.shown === 'boolean') {
      result.shown = parsed.shown;
    }
    if (typeof parsed.action === 'string') {
      result.action = parsed.action;
    }
    if (result.shown === undefined && result.action === undefined) {
      return null;
    }
    return result;
  } catch {
    return null;
  }
}

export function showAgentFinishNotification(payload: AgentFinishNotifyPayload): Promise<boolean> {
  if (isNexusInForeground()) {
    return Promise.resolve(false);
  }

  if (process.platform !== 'darwin') {
    return Promise.resolve(false);
  }

  const projectName = payload.projectName.trim() || 'Projeto';
  const key = payloadKey(payload);
  if (wasShownRecently(key)) {
    return Promise.resolve(true);
  }

  const binaryPath = resolveNotificationHelperBinary();
  if (!binaryPath) {
    return Promise.resolve(false);
  }

  stopHelper(key);

  return new Promise((resolve) => {
    let settled = false;
    let buffer = '';
    const outputPath = path.join(
      os.tmpdir(),
      `nexus-agent-finish-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    const child = spawn(binaryPath, [outputPath, 'post-agent-finish', projectName], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeHelpers.set(key, child);

    const shownTimer = setTimeout(() => {
      stopHelper(key);
      finishShown(false);
    }, SHOWN_TIMEOUT_MS);

    const finishShown = (shown: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(shownTimer);
      if (shown) {
        recentShownAt.set(key, Date.now());
      }
      resolve(shown);
    };

    const onLine = (line: string) => {
      const parsed = parseHelperLine(line);
      if (!parsed) {
        return;
      }

      if (parsed.shown !== undefined) {
        finishShown(parsed.shown);
      }

      if (parsed.action === 'git' || parsed.action === 'open') {
        deliverAction(parsed.action, payload);
        stopHelper(key);
        return;
      }

      if (parsed.action === 'dismiss') {
        stopHelper(key);
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        onLine(line);
      }
    });

    child.on('error', () => {
      stopHelper(key);
      finishShown(false);
    });

    child.on('exit', () => {
      if (buffer.trim()) {
        onLine(buffer);
      }
      activeHelpers.delete(key);
      finishShown(false);
    });
  });
}
