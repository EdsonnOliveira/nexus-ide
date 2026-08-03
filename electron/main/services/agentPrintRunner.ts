import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
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

const execFileAsync = promisify(execFile);
const STDOUT_WATCHDOG_MS = 45_000;
const STDOUT_IDLE_WATCHDOG_MS = 300_000;
const STDOUT_FLUSH_MS = 12;
const STDOUT_FLUSH_MAX_CHARS = 32_000;
const WARM_TTL_MS = 5 * 60_000;
const AGENT_RUNNING_MARKER = path.join(os.tmpdir(), 'nexus-ide-agent-running');

interface StdoutBatch {
  runToken: string;
  chunks: string[];
  chars: number;
  timer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  leading: boolean;
}

function syncAgentRunningMarker(running: boolean): void {
  try {
    if (running) {
      fs.writeFileSync(AGENT_RUNNING_MARKER, String(Date.now()), 'utf8');
      return;
    }

    fs.rmSync(AGENT_RUNNING_MARKER, { force: true });
  } catch {
  }
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
      const resolved = path.resolve(trimmed);
      if (fs.statSync(resolved).isDirectory()) {
        return resolved;
      }
    } catch {
    }
  }

  return process.cwd();
}

class AgentPrintRunner {
  private window: BrowserWindow | null = null;
  private processes = new Map<string, ChildProcessWithoutNullStreams>();
  private watchdogs = new Map<string, ReturnType<typeof setTimeout>>();
  private stdoutBatches = new Map<string, StdoutBatch>();
  private warmPromise: Promise<void> | null = null;
  private lastWarmAt = 0;

  setWindow(window: BrowserWindow | null): void {
    this.window = window;
  }

  private clearWatchdog(paneId: string): void {
    const timer = this.watchdogs.get(paneId);

    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.watchdogs.delete(paneId);
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

  private flushStdoutBatch(paneId: string): void {
    const batch = this.stdoutBatches.get(paneId);

    if (!batch) {
      return;
    }

    if (batch.timer) {
      clearTimeout(batch.timer);
      batch.timer = null;
    }

    if (batch.idleTimer) {
      clearTimeout(batch.idleTimer);
      batch.idleTimer = null;
    }

    if (batch.chars === 0 || batch.chunks.length === 0) {
      return;
    }

    const data = batch.chunks.join('');
    const runToken = batch.runToken;
    batch.chunks = [];
    batch.chars = 0;
    batch.leading = false;

    this.emit('agent:printData', {
      paneId,
      runToken,
      data,
    });

    batch.idleTimer = setTimeout(() => {
      batch.idleTimer = null;
      batch.leading = true;
    }, STDOUT_FLUSH_MS * 2);
  }

  private clearStdoutBatch(paneId: string): void {
    const batch = this.stdoutBatches.get(paneId);

    if (!batch) {
      return;
    }

    if (batch.timer) {
      clearTimeout(batch.timer);
    }

    if (batch.idleTimer) {
      clearTimeout(batch.idleTimer);
    }

    this.stdoutBatches.delete(paneId);
  }

  private enqueueStdout(paneId: string, runToken: string, chunk: string): void {
    if (!chunk) {
      return;
    }

    let batch = this.stdoutBatches.get(paneId);

    if (!batch) {
      batch = {
        runToken,
        chunks: [],
        chars: 0,
        timer: null,
        idleTimer: null,
        leading: true,
      };
      this.stdoutBatches.set(paneId, batch);
    }

    if (batch.idleTimer) {
      clearTimeout(batch.idleTimer);
      batch.idleTimer = null;
    }

    batch.runToken = runToken;
    batch.chunks.push(chunk);
    batch.chars += chunk.length;

    if (batch.chars >= STDOUT_FLUSH_MAX_CHARS) {
      this.flushStdoutBatch(paneId);
      return;
    }

    if (batch.leading) {
      this.flushStdoutBatch(paneId);
      return;
    }

    if (!batch.timer) {
      batch.timer = setTimeout(() => {
        this.flushStdoutBatch(paneId);
      }, STDOUT_FLUSH_MS);
    }
  }

  warm(): Promise<void> {
    const now = Date.now();

    if (this.warmPromise) {
      return this.warmPromise;
    }

    if (now - this.lastWarmAt < WARM_TTL_MS) {
      return Promise.resolve();
    }

    const executable = resolveCursorAgentExecutable();

    this.warmPromise = (async () => {
      try {
        await execFileAsync(executable, ['models'], {
          encoding: 'utf8',
          env: { ...process.env, PATH: buildCliPathEnv() },
          timeout: 10_000,
          maxBuffer: 2 * 1024 * 1024,
        });
        this.lastWarmAt = Date.now();
      } catch {
        this.lastWarmAt = Date.now();
      } finally {
        this.warmPromise = null;
      }
    })();

    return this.warmPromise;
  }

  start(options: AgentPrintRunOptions): void {
    this.stop(options.paneId);

    const runToken = options.runToken;
    const resolvedCwd = resolveAgentPrintCwd(options.cwd);
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--stream-partial-output',
      '--trust',
      '--force',
      '--workspace',
      resolvedCwd,
    ];
    const resumeChatId = options.resumeChatId?.trim();

    if (resumeChatId) {
      args.push('--resume', resumeChatId);
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
      args.push('--', options.prompt);
    }

    const executable = resolveCursorAgentExecutable();
    const child = spawn(executable, args, {
      cwd: resolvedCwd,
      env: { ...process.env, PATH: buildCliPathEnv() },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });

    this.processes.set(options.paneId, child);
    syncAgentRunningMarker(true);

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
    let closed = false;

    const finishWithError = (error: string, code = 1) => {
      if (closed) {
        return;
      }

      closed = true;
      this.clearWatchdog(options.paneId);
      this.flushStdoutBatch(options.paneId);
      this.clearStdoutBatch(options.paneId);

      if (this.processes.get(options.paneId) === child) {
        this.processes.delete(options.paneId);
      }

      syncAgentRunningMarker(this.processes.size > 0);

      try {
        if (child.pid && process.platform !== 'win32') {
          process.kill(-child.pid, 'SIGTERM');
        } else {
          child.kill('SIGTERM');
        }
      } catch {
        try {
          child.kill('SIGTERM');
        } catch {
        }
      }

      this.emit('agent:printDone', {
        paneId: options.paneId,
        runToken,
        code,
        error,
      });
    };

    const armStartupWatchdog = () => {
      this.clearWatchdog(options.paneId);
      this.watchdogs.set(
        options.paneId,
        setTimeout(() => {
          if (stdoutSeen || this.processes.get(options.paneId) !== child) {
            return;
          }

          const stderr = stderrBuffer.trim();
          finishWithError(
            stderr
              ? `Agent sem stdout após ${Math.round(STDOUT_WATCHDOG_MS / 1000)}s. ${stderr.slice(0, 500)}`
              : `Agent sem stdout após ${Math.round(STDOUT_WATCHDOG_MS / 1000)}s. Pare e tente de novo.`,
          );
        }, STDOUT_WATCHDOG_MS),
      );
    };

    const armIdleWatchdog = () => {
      this.clearWatchdog(options.paneId);
      this.watchdogs.set(
        options.paneId,
        setTimeout(() => {
          if (this.processes.get(options.paneId) !== child || closed) {
            return;
          }

          finishWithError(
            `Agent sem novos eventos por ${Math.round(STDOUT_IDLE_WATCHDOG_MS / 1000)}s. Pare e tente de novo.`,
          );
        }, STDOUT_IDLE_WATCHDOG_MS),
      );
    };

    armStartupWatchdog();

    const forwardStdout = (chunk: Buffer) => {
      stdoutSeen = true;
      armIdleWatchdog();
      this.enqueueStdout(options.paneId, runToken, chunk.toString('utf8'));
    };

    child.stdout.on('data', (chunk) => forwardStdout(chunk));
    child.stderr.on('data', (chunk) => {
      stderrBuffer = `${stderrBuffer}${chunk.toString('utf8')}`.slice(-4096);
    });

    child.on('close', (code) => {
      if (closed) {
        return;
      }

      closed = true;
      this.clearWatchdog(options.paneId);
      this.flushStdoutBatch(options.paneId);
      this.clearStdoutBatch(options.paneId);

      if (this.processes.get(options.paneId) === child) {
        this.processes.delete(options.paneId);
      }

      syncAgentRunningMarker(this.processes.size > 0);

      const stderr = stderrBuffer.trim();
      const error =
        code !== 0 && stderr
          ? stderr
          : !stdoutSeen && stderr
            ? stderr
            : !stdoutSeen
              ? 'Agent encerrou sem emitir stream-json.'
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
      finishWithError(error.message);
    });
  }

  stop(paneId: string): void {
    this.clearWatchdog(paneId);
    this.flushStdoutBatch(paneId);
    this.clearStdoutBatch(paneId);
    const child = this.processes.get(paneId);

    if (!child) {
      syncAgentRunningMarker(this.processes.size > 0);
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

    const pid = child.pid;

    try {
      if (pid && process.platform !== 'win32') {
        process.kill(-pid, 'SIGTERM');
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
      }
    }

    setTimeout(() => {
      if (child.killed) {
        return;
      }

      try {
        if (pid && process.platform !== 'win32') {
          process.kill(-pid, 'SIGKILL');
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
        }
      }
    }, 400);
  }

  isRunning(paneId: string): boolean {
    return this.processes.has(paneId);
  }

  hasRunning(): boolean {
    return this.processes.size > 0;
  }

  stopAll(): void {
    for (const paneId of Array.from(this.processes.keys())) {
      this.stop(paneId);
    }
  }
}

export const agentPrintRunner = new AgentPrintRunner();
