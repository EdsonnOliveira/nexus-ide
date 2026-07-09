import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import type { ProjectTestEntry, TestRunStep } from '../../types/test';
import { buildCliPathEnv } from '../utils/cliPathEnv';
import { prepareMaestroHighlightCache } from './maestroHighlightResolver';
import { MaestroTestHighlightTracker } from './maestroTestHighlightTracker';

export interface TestRunSession {
  runId: string;
  entryId: string;
  projectId: string;
  command: string;
}

function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9._/@+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function readPackageManager(projectPath: string): 'yarn' | 'pnpm' | 'npm' | 'bun' {

  if (existsSync(path.join(projectPath, 'yarn.lock'))) {
    return 'yarn';
  }

  if (existsSync(path.join(projectPath, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }

  if (existsSync(path.join(projectPath, 'bun.lockb')) || existsSync(path.join(projectPath, 'bun.lock'))) {
    return 'bun';
  }

  return 'npm';
}

export function buildDefaultTestCommand(projectPath: string, entry: ProjectTestEntry): string {
  if (entry.command?.trim()) {
    return entry.command.trim();
  }

  const target = shellQuote(entry.targetPath);
  const manager = readPackageManager(projectPath);

  switch (entry.kind) {
    case 'maestro':
      return `maestro test ${target}`;
    case 'vitest':
      return manager === 'yarn'
        ? `yarn vitest run ${target}`
        : manager === 'pnpm'
          ? `pnpm vitest run ${target}`
          : manager === 'bun'
            ? `bun vitest run ${target}`
            : `npx vitest run ${target}`;
    case 'jest':
      return manager === 'yarn'
        ? `yarn jest ${target}`
        : manager === 'pnpm'
          ? `pnpm jest ${target}`
          : manager === 'bun'
            ? `bun jest ${target}`
            : `npx jest ${target}`;
    case 'playwright':
      return manager === 'yarn'
        ? `yarn playwright test ${target}`
        : manager === 'pnpm'
          ? `pnpm playwright test ${target}`
          : manager === 'bun'
            ? `bun playwright test ${target}`
            : `npx playwright test ${target}`;
    case 'detox':
      return manager === 'yarn'
        ? `yarn detox test ${target}`
        : manager === 'pnpm'
          ? `pnpm detox test ${target}`
          : manager === 'bun'
            ? `bun detox test ${target}`
            : `npx detox test ${target}`;
    default:
      return `echo ${target}`;
  }
}

class TestRunnerSessionManager {
  private window: BrowserWindow | null = null;
  private processes = new Map<string, ChildProcessWithoutNullStreams>();
  private maestroHighlightTracker = new MaestroTestHighlightTracker((payload) => {
    this.emit('tests:highlight', payload);
  });
  private activeMaestroRunId: string | null = null;

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

  start(
    projectPath: string,
    projectId: string,
    entry: ProjectTestEntry,
    steps: TestRunStep[] = [],
  ): TestRunSession {
    const runId = randomUUID();
    const command = buildDefaultTestCommand(projectPath, entry);

    const spawnProcess = () => {
      if (this.processes.has(runId)) {
        return;
      }

      const child = spawn(command, {
        cwd: projectPath,
        env: {
          ...process.env,
          PATH: buildCliPathEnv(process.env.PATH),
          FORCE_COLOR: '1',
        },
        shell: true,
      });

      this.processes.set(runId, child);
      this.attachProcessListeners(runId, child, entry, projectId);
    };

    if (entry.kind === 'maestro') {
      this.activeMaestroRunId = runId;
      this.maestroHighlightTracker.start(runId, steps, {
        projectPath,
        testRelativePath: entry.targetPath,
      });
      const highlightDelayMs = this.maestroHighlightTracker.previewBeforeRun(runId);
      this.maestroHighlightTracker.scheduleProcessStart(highlightDelayMs, spawnProcess);
    } else {
      spawnProcess();
    }

    return {
      runId,
      entryId: entry.id,
      projectId,
      command,
    };
  }

  async prepareMaestroRun(steps: TestRunStep[]): Promise<void> {
    await prepareMaestroHighlightCache(steps);
  }

  private attachProcessListeners(
    runId: string,
    child: ChildProcessWithoutNullStreams,
    entry: ProjectTestEntry,
    projectId: string,
  ): void {
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');

      if (entry.kind === 'maestro') {
        this.maestroHighlightTracker.handleChunk(runId, text);
      }

      this.emit('tests:output', {
        runId,
        entryId: entry.id,
        projectId,
        chunk: text,
      });
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');

      if (entry.kind === 'maestro') {
        this.maestroHighlightTracker.handleChunk(runId, text);
      }

      this.emit('tests:output', {
        runId,
        entryId: entry.id,
        projectId,
        chunk: text,
      });
    });

    child.on('close', (code) => {
      this.processes.delete(runId);

      if (this.activeMaestroRunId === runId) {
        this.maestroHighlightTracker.stop(runId);
        this.activeMaestroRunId = null;
      }

      this.emit('tests:exit', {
        runId,
        entryId: entry.id,
        projectId,
        code: code ?? 1,
      });
    });

    child.on('error', (error) => {
      this.processes.delete(runId);

      if (this.activeMaestroRunId === runId) {
        this.maestroHighlightTracker.stop(runId);
        this.activeMaestroRunId = null;
      }

      this.emit('tests:output', {
        runId,
        entryId: entry.id,
        projectId,
        chunk: `${error.message}\n`,
      });
      this.emit('tests:exit', {
        runId,
        entryId: entry.id,
        projectId,
        code: 1,
      });
    });
  }

  stop(runId: string): void {
    const child = this.processes.get(runId);

    if (!child) {
      if (this.activeMaestroRunId === runId) {
        this.maestroHighlightTracker.stop(runId);
        this.activeMaestroRunId = null;
      }

      return;
    }

    if (this.activeMaestroRunId === runId) {
      this.maestroHighlightTracker.stop(runId);
      this.activeMaestroRunId = null;
    }

    child.kill('SIGTERM');
    this.processes.delete(runId);
  }

  stopAll(): void {
    for (const [runId, child] of this.processes) {
      if (this.activeMaestroRunId === runId) {
        this.maestroHighlightTracker.stop(runId);
        this.activeMaestroRunId = null;
      }

      child.kill('SIGTERM');
      this.processes.delete(runId);
    }
  }

  isRunning(runId: string): boolean {
    return this.processes.has(runId);
  }

  resolveMaestroHighlight(runId: string, source: string): void {
    if (this.activeMaestroRunId !== runId) {
      return;
    }

    this.maestroHighlightTracker.resolveSource(runId, source);
  }
}

export const testRunnerSession = new TestRunnerSessionManager();
