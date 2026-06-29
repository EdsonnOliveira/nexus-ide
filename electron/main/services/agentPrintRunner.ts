import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { BrowserWindow } from 'electron';
import { buildCliPathEnv } from '../utils/cliPathEnv';

export interface AgentPrintRunOptions {
  paneId: string;
  cwd: string;
  prompt: string;
  model?: string | null;
  mode?: 'plan' | 'ask';
  continueSession?: boolean;
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

    const args = ['-p', '--output-format', 'stream-json', '--trust', '--force'];

    if (options.continueSession) {
      args.push('--continue');
    }

    if (options.mode) {
      args.push('--mode', options.mode);
    }

    const model = options.model?.trim();

    if (model && model !== 'auto') {
      args.push('--model', model);
    }

    args.push(options.prompt);

    const child = spawn('cursor-agent', args, {
      cwd: options.cwd,
      env: { ...process.env, PATH: buildCliPathEnv() },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.processes.set(options.paneId, child);

    const forward = (chunk: Buffer) => {
      this.emit('agent:printData', {
        paneId: options.paneId,
        data: chunk.toString('utf8'),
      });
    };

    child.stdout.on('data', forward);
    child.stderr.on('data', forward);

    child.on('close', (code) => {
      this.processes.delete(options.paneId);
      this.emit('agent:printDone', {
        paneId: options.paneId,
        code: code ?? 1,
      });
    });

    child.on('error', (error) => {
      this.processes.delete(options.paneId);
      this.emit('agent:printDone', {
        paneId: options.paneId,
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

    child.kill('SIGTERM');
    setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }, 400);
    this.processes.delete(paneId);
  }

  stopAll(): void {
    for (const paneId of [...this.processes.keys()]) {
      this.stop(paneId);
    }
  }
}

export const agentPrintRunner = new AgentPrintRunner();
