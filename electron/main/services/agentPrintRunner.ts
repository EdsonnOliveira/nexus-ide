import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { BrowserWindow } from 'electron';
import { buildCliPathEnv } from '../utils/cliPathEnv';
import { writeDebugSessionLog } from '../utils/debugSessionLog';
import { killProcessTree } from '../utils/killProcessTree';

export interface AgentPrintStopOptions {
  preserveChildren?: boolean;
}

export interface AgentPrintRunOptions {
  paneId: string;
  cwd: string;
  prompt: string;
  cliAgent?: string;
  model?: string | null;
  mode?: 'plan' | 'ask';
  continueSession?: boolean;
  resumeChatId?: string | null;
  attachmentPaths?: string[];
  runToken: string;
  preserveChildren?: boolean;
}

const execFileAsync = promisify(execFile);

function isWindowsBatchFile(executable: string): boolean {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable);
}

function spawnCliProcess(
  executable: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio: ['ignore', 'pipe', 'pipe'];
    detached: boolean;
    windowsHide: boolean;
  },
): ChildProcessWithoutNullStreams {
  if (isWindowsBatchFile(executable)) {
    const comspec = process.env.ComSpec || 'cmd.exe';
    return spawn(comspec, ['/d', '/s', '/c', executable, ...args], {
      ...options,
      windowsVerbatimArguments: true,
    });
  }

  return spawn(executable, args, options);
}
const STDOUT_WATCHDOG_MS = 180_000;
const STDOUT_STARTUP_EXTEND_MS = 90_000;
const STDOUT_IDLE_WATCHDOG_MS = 7_200_000;
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
  } catch {}
}

function executableNames(name: string): string[] {
  if (process.platform !== 'win32') {
    return [name];
  }

  return [`${name}.cmd`, `${name}.exe`, name];
}

function resolveExecutable(baseName: string, extraDirs: string[] = []): string {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA ?? '';
  const dirs = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.cursor', 'bin'),
    path.join(home, 'bin'),
    ...extraDirs,
    ...(process.platform === 'win32'
      ? [
          localAppData ? path.join(localAppData, 'cursor-agent') : '',
          localAppData ? path.join(localAppData, 'Programs', 'cursor') : '',
        ]
      : ['/opt/homebrew/bin', '/usr/local/bin']),
  ].filter(Boolean);

  for (const dir of dirs) {
    for (const name of executableNames(baseName)) {
      const candidate = path.join(dir, name);

      try {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch {
        continue;
      }
    }
  }

  return process.platform === 'win32' ? `${baseName}.cmd` : baseName;
}

function resolveCursorAgentExecutable(): string {
  return resolveExecutable('cursor-agent');
}

function resolveOpenCodeExecutable(): string {
  return resolveExecutable('opencode');
}

function resolveAntigravityExecutable(): string {
  return resolveExecutable('agy');
}

function resolveCliAgentExecutable(cliAgent: string): string {
  const base = cliAgent.trim().split(/\s+/)[0] ?? 'cursor-agent';

  if (base === 'opencode') {
    return resolveOpenCodeExecutable();
  }

  if (base === 'agy') {
    return resolveAntigravityExecutable();
  }

  return resolveCursorAgentExecutable();
}

function buildCursorAgentArgs(options: AgentPrintRunOptions, resolvedCwd: string): string[] {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--stream-partial-output',
    '--trust',
    '--force',
    '--approve-mcps',
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

  return args;
}

function buildOpenCodeArgs(options: AgentPrintRunOptions, resolvedCwd: string): string[] {
  const args = ['run', '--format', 'json', '--auto', '--thinking', '--dir', resolvedCwd];
  const resumeChatId = options.resumeChatId?.trim();

  if (resumeChatId) {
    args.push('--session', resumeChatId);
  } else if (options.continueSession) {
    args.push('--continue');
  }

  const model = options.model?.trim();

  if (model && model !== 'auto') {
    args.push('--model', model);
  }

  for (const attachmentPath of options.attachmentPaths ?? []) {
    const trimmed = attachmentPath.trim();

    if (trimmed) {
      args.push('--file', trimmed);
    }
  }

  if (options.prompt.trim()) {
    args.push('--', options.prompt);
  }

  return args;
}

function buildAntigravityArgs(options: AgentPrintRunOptions): string[] {
  const args = [
    '-p',
    options.prompt.trim(),
    '--output-format',
    'stream-json',
    '--dangerously-skip-permissions',
  ];
  const resumeChatId = options.resumeChatId?.trim();

  if (resumeChatId) {
    args.push('--conversation', resumeChatId);
  } else if (options.continueSession) {
    args.push('--continue');
  }

  if (options.mode === 'plan') {
    args.push('--mode', 'plan');
  }

  const model = options.model?.trim();

  if (model && model !== 'auto') {
    args.push('--model', model);
  }

  return args;
}

function buildAgentPrintArgs(options: AgentPrintRunOptions, resolvedCwd: string): string[] {
  const base = (options.cliAgent ?? 'cursor-agent').trim().split(/\s+/)[0] ?? 'cursor-agent';

  if (base === 'opencode') {
    return buildOpenCodeArgs(options, resolvedCwd);
  }

  if (base === 'agy') {
    return buildAntigravityArgs(options);
  }

  return buildCursorAgentArgs(options, resolvedCwd);
}

function resolveAgentPrintCwd(cwd: string): string {
  const trimmed = cwd.trim();

  if (trimmed) {
    try {
      const resolved = path.resolve(trimmed);
      if (fs.statSync(resolved).isDirectory()) {
        return resolved;
      }
    } catch {}
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

  private signalChild(
    child: ChildProcessWithoutNullStreams,
    signal: NodeJS.Signals,
    preserveChildren: boolean,
  ): void {
    const pid = child.pid;

    try {
      if (!preserveChildren && pid && process.platform !== 'win32') {
        process.kill(-pid, signal);
        return;
      }

      if (!preserveChildren && pid && process.platform === 'win32') {
        killProcessTree(pid);
        return;
      }

      child.kill(signal);
    } catch {
      try {
        child.kill(signal);
      } catch {}
    }
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
    if (!this.window || this.window.isDestroyed() || this.window.webContents.isDestroyed()) {
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
        if (isWindowsBatchFile(executable)) {
          const comspec = process.env.ComSpec || 'cmd.exe';
          await execFileAsync(comspec, ['/d', '/s', '/c', executable, 'models'], {
            encoding: 'utf8',
            env: { ...process.env, PATH: buildCliPathEnv() },
            timeout: 10_000,
            maxBuffer: 2 * 1024 * 1024,
            windowsHide: true,
          });
        } else {
          await execFileAsync(executable, ['models'], {
            encoding: 'utf8',
            env: { ...process.env, PATH: buildCliPathEnv() },
            timeout: 10_000,
            maxBuffer: 2 * 1024 * 1024,
            windowsHide: true,
          });
        }
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
    this.stop(options.paneId, { preserveChildren: options.preserveChildren });

    const runToken = options.runToken;
    const resolvedCwd = resolveAgentPrintCwd(options.cwd);
    const cliAgent = options.cliAgent ?? 'cursor-agent';
    const args = buildAgentPrintArgs(options, resolvedCwd);
    const executable = resolveCliAgentExecutable(cliAgent);
    const child = spawnCliProcess(executable, args, {
      cwd: resolvedCwd,
      env: { ...process.env, PATH: buildCliPathEnv() },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
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
        cliAgent,
        cwd: resolvedCwd,
        resumeChatId: options.resumeChatId?.trim() ?? null,
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

      const isCurrent = this.processes.get(options.paneId) === child;

      if (isCurrent) {
        this.processes.delete(options.paneId);
      }

      syncAgentRunningMarker(this.processes.size > 0);

      if (isCurrent) {
        this.signalChild(child, 'SIGTERM', false);
      }

      this.emit('agent:printDone', {
        paneId: options.paneId,
        runToken,
        code,
        error,
      });
    };

    const armStartupWatchdog = (timeoutMs = STDOUT_WATCHDOG_MS) => {
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
              ? `Agent sem stdout após ${Math.round(timeoutMs / 1000)}s. ${stderr.slice(0, 500)}`
              : `Agent sem stdout após ${Math.round(timeoutMs / 1000)}s. Pare e tente de novo.`,
          );
        }, timeoutMs),
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

      if (stdoutSeen || closed) {
        return;
      }

      armStartupWatchdog(STDOUT_STARTUP_EXTEND_MS);
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
              ? 'Agent encerrou sem emitir eventos.'
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

  stop(paneId: string, options?: AgentPrintStopOptions): void {
    this.clearWatchdog(paneId);
    this.flushStdoutBatch(paneId);
    this.clearStdoutBatch(paneId);
    const child = this.processes.get(paneId);

    if (!child) {
      syncAgentRunningMarker(this.processes.size > 0);
      return;
    }

    const preserveChildren = Boolean(options?.preserveChildren);

    // #region agent log
    writeDebugSessionLog({
      location: 'agentPrintRunner.ts:stop',
      message: 'agentPrint process stop requested',
      data: { paneId, preserveChildren },
      hypothesisId: 'D',
    });
    // #endregion

    this.signalChild(child, 'SIGTERM', preserveChildren);

    setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }

      this.signalChild(child, 'SIGKILL', preserveChildren);
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
