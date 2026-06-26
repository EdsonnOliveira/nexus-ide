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

function getAppRoot(): string {
  if (app.isPackaged) {
    const appPath = app.getAppPath();

    if (appPath.endsWith('.asar')) {
      return `${appPath}.unpacked`;
    }

    return appPath;
  }

  return process.env.APP_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

function getShellResources(): string {
  return path.join(getAppRoot(), 'resources/shell');
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
]);

function resolveShell(): string {
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
    nextEnv.PROMPT = '%~ %# ';
    nextEnv.RPROMPT = '';
  }

  return nextEnv;
}

function buildShellArgs(shell: string): string[] {
  const nexusZshWrapper = getNexusZshWrapper();
  const bashRcFile = getBashRcFile();

  if (shell === nexusZshWrapper) {
    return [];
  }

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

  has(ptyId: string): boolean {
    return this.sessions.has(ptyId);
  }

  getScrollback(ptyId: string): string {
    return this.sessions.get(ptyId)?.scrollback ?? '';
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

      this.sendToRenderer('terminal:data', { ptyId: id, data });
    });

    terminal.onExit(({ exitCode }) => {
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

    session.pty.kill();
    this.sessions.delete(ptyId);
  }

  killAll(): void {
    for (const session of this.sessions.values()) {
      session.pty.kill();
    }

    this.sessions.clear();
  }
}

export const ptyManager = new PtyManager();
