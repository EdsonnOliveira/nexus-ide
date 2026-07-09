import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { buildCliPathEnv } from '../utils/cliPathEnv';
import { writeDebugSessionLog } from '../utils/debugSessionLog';

export interface AgentPrintRunOptions {
  paneId: string;
  cwd: string;
  prompt: string;
  model?: string | null;
  mode?: 'plan' | 'ask';
  continueSession?: boolean;
  resumeChatId?: string | null;
  runToken: string;
}

function resolveCursorAgentExecutable(): string {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.local', 'bin', 'cursor-agent'),
    path.join(home, '.cursor', 'bin', 'cursor-agent'),
    '/opt/homebrew/bin/cursor-agent',
    '/usr/local/bin/cursor-agent',
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  return 'cursor-agent';
}

function resolveAgentPrintCwd(cwd: string): string {
  const trimmed = cwd.trim();

  if (trimmed) {
    try {
      if (fs.statSync(trimmed).isDirectory()) {
        return trimmed;
      }
    } catch {
      // fall through
    }
  }

  return process.cwd();
}

class AgentPrintRunner {
  private window: BrowserWindow | null = null;
  private processes = new Map<string, ChildProcessWithoutNullStreams>();

  setWindow(window: BrowserWindow | null): void {
    this.window = window;
  }

  private emit(channel: string, payload: unknown): void {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    try {
      this.window.webContents.send(channel, payload);
    } catch {
      this.window = null;
    }
  }

  start(options: AgentPrintRunOptions): void {
    this.stop(options.paneId);

    const runToken = options.runToken;
    const args = ['-p', '--output-format', 'stream-json', '--trust', '--force'];
    const resumeChatId = options.resumeChatId?.trim();

    if (resumeChatId) {
      args.push('--resume', resumeChatId);
      args.push('--workspace', resolveAgentPrintCwd(options.cwd));
    } else if (options.continueSession) {
      args.push('--continue');
    }

    if (options.mode) {
      args.push('--mode', options.mode);
    }

    const model = options.model?.trim();

    if (model && model !== 'auto') {
      args.push('--model', model);
    }

    if (options.prompt.trim()) {
      args.push(options.prompt);
    }

    const executable = resolveCursorAgentExecutable();
    const resolvedCwd = resolveAgentPrintCwd(options.cwd);
    const child = spawn(executable, args, {
      cwd: resolvedCwd,
      env: { ...process.env, PATH: buildCliPathEnv() },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.processes.set(options.paneId, child);

    const startedAt = Date.now();
    // #region agent log
    writeDebugSessionLog({
      location: 'agentPrintRunner.ts:start',
      message: 'agentPrint process spawned',
      data: {
        paneId: options.paneId,
        runToken,
        executable,
        cwd: resolvedCwd,
        resumeChatId: resumeChatId ?? null,
        continueSession: Boolean(options.continueSession),
        mode: options.mode ?? null,
        promptLength: options.prompt.trim().length,
      },
      hypothesisId: 'A',
    });
    // #endregion

    let stdoutSeen = false;
    let stderrBuffer = '';

    const forward = (chunk: Buffer, fromStdout: boolean) => {
      if (fromStdout) {
        stdoutSeen = true;
      }

      this.emit('agent:printData', {
        paneId: options.paneId,
        runToken,
        data: chunk.toString('utf8'),
      });
    };

    child.stdout.on('data', (chunk) => forward(chunk, true));
    child.stderr.on('data', (chunk) => {
      stderrBuffer = `${stderrBuffer}${chunk.toString('utf8')}`.slice(-4096);
      forward(chunk, false);
    });

    child.on('close', (code) => {
      this.processes.delete(options.paneId);
      const stderr = stderrBuffer.trim();
      const error =
        code !== 0 && stderr
          ? stderr
          : !stdoutSeen && stderr
            ? stderr
            : undefined;
      const durationMs = Date.now() - startedAt;

      // #region agent log
      writeDebugSessionLog({
        location: 'agentPrintRunner.ts:close',
        message: 'agentPrint process closed',
        data: {
          paneId: options.paneId,
          runToken,
          code: code ?? 1,
          durationMs,
          stdoutSeen,
          hasStderr: Boolean(stderr),
          stderrPreview: stderr.slice(0, 200),
        },
        hypothesisId: 'A',
      });
      // #endregion

      this.emit('agent:printDone', {
        paneId: options.paneId,
        runToken,
        code: code ?? 1,
        ...(error ? { error } : {}),
      });
    });

    child.on('error', (error) => {
      this.processes.delete(options.paneId);
      this.emit('agent:printDone', {
        paneId: options.paneId,
        runToken,
        code: 1,
        error: error.message,
      });
    });
  }

  stop(paneId: string): void {
    const child = this.processes.get(paneId);

    if (!child) {
      return;
    }

    // #region agent log
    writeDebugSessionLog({
      location: 'agentPrintRunner.ts:stop',
      message: 'agentPrint process stop requested',
      data: { paneId },
      hypothesisId: 'D',
    });
    // #endregion

    child.kill('SIGTERM');
    setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }, 400);
    this.processes.delete(paneId);
  }

  isRunning(paneId: string): boolean {
    return this.processes.has(paneId);
  }

  stopAll(): void {
    for (const paneId of [...this.processes.keys()]) {
      this.stop(paneId);
    }
  }
}

export const agentPrintRunner = new AgentPrintRunner();
