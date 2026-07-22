import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import type { BrowserWindow } from 'electron';
import * as pty from 'node-pty';
import type { TerminalAgent } from '../../types';
import { buildCliPathEnv } from '../utils/cliPathEnv';

interface PtySession {
  id: string;
  pty: pty.IPty;
  scrollback: string;
}

const SCROLLBACK_LIMIT = 512 * 1024;

const ASAR_SEGMENT = `app.asar${path.sep}`;
const ASAR_UNPACKED_SEGMENT = `app.asar.unpacked${path.sep}`;

function toUnpackedPath(value: string): string {
  if (!value || value.includes(ASAR_UNPACKED_SEGMENT)) {
    return value;
  }

  const index = value.indexOf(ASAR_SEGMENT);

  if (index === -1) {
    return value;
  }

  return value.slice(0, index) + ASAR_UNPACKED_SEGMENT + value.slice(index + ASAR_SEGMENT.length);
}

function getAppRoot(): string {
  const fromEnv = process.env.APP_ROOT ? toUnpackedPath(process.env.APP_ROOT) : '';
  const fromModule = toUnpackedPath(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  );

  if (fromEnv && existsSync(path.join(fromEnv, 'resources/shell/zsh/nexus-shell'))) {
    return fromEnv;
  }

  if (app.isPackaged) {
    const appPath = app.getAppPath();
    const packagedRoot = appPath.endsWith('.asar') ? `${appPath}.unpacked` : appPath;

    if (existsSync(path.join(packagedRoot, 'resources/shell/zsh/nexus-shell'))) {
      return packagedRoot;
    }
  }

  if (fromEnv) {
    return fromEnv;
  }

  return fromModule;
}

function getShellResources(): string {
  const candidates = [
    path.join(getAppRoot(), 'resources/shell'),
    process.env.APP_ROOT ? path.join(process.env.APP_ROOT, 'resources/shell') : '',
    path.join(process.cwd(), 'resources/shell'),
    path.join(process.resourcesPath, 'app.asar.unpacked/resources/shell'),
    path.join(app.getAppPath(), 'resources/shell'),
    path.join(process.resourcesPath, 'resources/shell'),
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../../resources/shell'),
  ].filter((value) => value.length > 0);

  for (const candidate of candidates) {
    const resolved = toUnpackedPath(path.resolve(candidate));

    if (existsSync(path.join(resolved, 'zsh/nexus-shell'))) {
      return resolved;
    }
  }

  return toUnpackedPath(path.resolve(path.join(getAppRoot(), 'resources/shell')));
}

function getZshConfigDir(): string {
  return path.join(getShellResources(), 'zsh');
}

function getNexusZshWrapper(): string {
  return path.join(getZshConfigDir(), 'nexus-shell');
}

function getBashRcFile(): string {
  return path.join(getShellResources(), 'bash/nexus.bashrc');
}

const BLOCKED_ENV_KEYS = new Set([
  'NO_COLOR',
  'ZDOTDIR',
  'PROMPT',
  'PS1',
  'PS2',
  'PS3',
  'PS4',
  'RPROMPT',
  'AI_AGENT',
  'ANTIGRAVITY_AGENT',
  'AUGMENT_AGENT',
  'CLAUDECODE',
  'CLAUDE_CODE',
  'CLAUDE_CODE_IS_COWORK',
  'CODEX_CI',
  'CODEX_SANDBOX',
  'CODEX_THREAD_ID',
  'COPILOT_ALLOW_ALL',
  'COPILOT_GITHUB_TOKEN',
  'COPILOT_MODEL',
  'CURSOR_AGENT',
  'CURSOR_EXTENSION_HOST_ROLE',
  'CURSOR_TRACE_ID',
  'GEMINI_CLI',
  'OPENCODE_CLIENT',
  'REPL_ID',
]);

function resolveShell(): string {
  const zshConfigDir = getZshConfigDir();

  if (existsSync(path.join(zshConfigDir, '.zshrc'))) {
    return '/bin/zsh';
  }

  const nexusZshWrapper = getNexusZshWrapper();

  if (existsSync(nexusZshWrapper)) {
    return nexusZshWrapper;
  }

  const candidates = [process.env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh'].filter(
    (value): value is string => Boolean(value),
  );

  for (const shell of candidates) {
    if (existsSync(shell)) {
      return shell;
    }
  }

  return '/bin/sh';
}

function resolveCwd(cwd: string): string {
  if (cwd && existsSync(cwd)) {
    return cwd;
  }

  return os.homedir();
}

function isZshShell(shell: string): boolean {
  return shell.includes('zsh');
}

function isBashShell(shell: string): boolean {
  return shell.includes('bash');
}

function buildEnv(agent: TerminalAgent, shell: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || BLOCKED_ENV_KEYS.has(key)) {
      continue;
    }

    env[key] = value;
  }

  const nextEnv: Record<string, string> = {
    ...env,
    PATH: buildCliPathEnv(env.PATH),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    FORCE_COLOR: '1',
    CLICOLOR: '1',
    CLICOLOR_FORCE: '1',
    LANG: env.LANG || 'en_US.UTF-8',
    NEXUS_AGENT: agent,
    NEXUS_IDE: '1',
    STARSHIP_DISABLE: '1',
    POWERLEVEL9K_DISABLE_CONFIGURATION: 'true',
    POWERLEVEL9K_INSTANT_PROMPT: 'off',
    DISABLE_UPDATE_PROMPT: 'true',
    OMZ_DISABLE_PROMPT_FIX: 'true',
  };

  if (isZshShell(shell)) {
    nextEnv.ZDOTDIR = path.resolve(getZshConfigDir());
    nextEnv.NEXUS_SHELL_DIR = getShellResources();
    nextEnv.RPROMPT = '';
  }

  return nextEnv;
}

function buildShellArgs(shell: string): string[] {
  const bashRcFile = getBashRcFile();

  if (isBashShell(shell) && existsSync(bashRcFile)) {
    return ['--rcfile', bashRcFile, '-i'];
  }

  if (isZshShell(shell)) {
    return ['--no-global-rcs', '-i'];
  }

  return ['-i'];
}

class PtyManager {
  private sessions = new Map<string, PtySession>();
  private window: BrowserWindow | null = null;
  private pendingData = new Map<string, string>();
  private flushScheduled = false;

  setWindow(window: BrowserWindow | null): void {
    this.window = window;
  }

  private canSendToRenderer(): boolean {
    if (!this.window || this.window.isDestroyed()) {
      return false;
    }

    return !this.window.webContents.isDestroyed();
  }

  private sendToRenderer(channel: string, payload: unknown): void {
    if (!this.canSendToRenderer()) {
      return;
    }

    try {
      this.window?.webContents.send(channel, payload);
    } catch {
      this.window = null;
    }
  }

  private scheduleDataFlush(): void {
    if (this.flushScheduled) {
      return;
    }

    this.flushScheduled = true;

    setImmediate(() => {
      this.flushScheduled = false;

      for (const [ptyId, data] of this.pendingData) {
        this.sendToRenderer('terminal:data', { ptyId, data });
      }

      this.pendingData.clear();
    });
  }

  has(ptyId: string): boolean {
    return this.sessions.has(ptyId);
  }

  getScrollback(ptyId: string): string {
    return this.sessions.get(ptyId)?.scrollback ?? '';
  }

  getScrollbackTail(ptyId: string, maxBytes: number): string {
    const scrollback = this.sessions.get(ptyId)?.scrollback ?? '';

    if (maxBytes <= 0 || scrollback.length <= maxBytes) {
      return scrollback;
    }

    return scrollback.slice(scrollback.length - maxBytes);
  }

  private appendScrollback(session: PtySession, data: string): void {
    session.scrollback += data;

    if (session.scrollback.length <= SCROLLBACK_LIMIT) {
      return;
    }

    session.scrollback = session.scrollback.slice(session.scrollback.length - SCROLLBACK_LIMIT);
  }

  create(cwd: string, agent: TerminalAgent = 'shell'): string {
    const shell = resolveShell();
    const resolvedCwd = resolveCwd(cwd);
    const id = randomUUID();

    const terminal = pty.spawn(shell, buildShellArgs(shell), {
      name: 'xterm-256color',
      cwd: resolvedCwd,
      env: buildEnv(agent, shell),
      cols: 80,
      rows: 24,
    });

    terminal.onData((data) => {
      const session = this.sessions.get(id);

      if (session) {
        this.appendScrollback(session, data);
      }

      const pending = this.pendingData.get(id);
      this.pendingData.set(id, pending ? pending + data : data);
      this.scheduleDataFlush();
    });

    terminal.onExit(({ exitCode }) => {
      this.pendingData.delete(id);
      this.sendToRenderer('terminal:exit', { ptyId: id, code: exitCode });
      this.sessions.delete(id);
    });

    this.sessions.set(id, { id, pty: terminal, scrollback: '' });
    return id;
  }

  resize(ptyId: string, cols: number, rows: number): void {
    if (cols <= 0 || rows <= 0) {
      return;
    }

    const session = this.sessions.get(ptyId);

    if (!session) {
      return;
    }

    try {
      session.pty.resize(cols, rows);
    } catch {
      this.sessions.delete(ptyId);
    }
  }

  write(ptyId: string, data: string): void {
    const session = this.sessions.get(ptyId);

    if (!session) {
      return;
    }

    try {
      session.pty.write(data);
    } catch {
      this.sessions.delete(ptyId);
    }
  }

  kill(ptyId: string): void {
    const session = this.sessions.get(ptyId);

    if (!session) {
      return;
    }

    this.sessions.delete(ptyId);
    this.pendingData.delete(ptyId);

    try {
      session.pty.kill();
    } catch {
      return;
    }
  }

  killAll(): void {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    this.pendingData.clear();

    for (const session of sessions) {
      try {
        session.pty.kill();
      } catch {
        continue;
      }
    }
  }
}

export const ptyManager = new PtyManager();
