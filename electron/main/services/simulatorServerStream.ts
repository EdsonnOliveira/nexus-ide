import { type ChildProcess, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';

export interface SimulatorServerStreamOptions {
  binaryPath: string;
  udid: string;
  isStopped: () => boolean;
}

export interface SimulatorServerStreamController {
  waitForStreamReady(timeoutMs: number): Promise<string | null>;
  sendInput(line: string): Promise<boolean>;
  stop(): Promise<void>;
}

function waitForProcessExit(process: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (process.exitCode !== null || process.signalCode !== null) {
      resolve();
      return;
    }

    process.once('exit', () => resolve());
    process.once('error', () => resolve());
  });
}

export async function createSimulatorServerStream(
  options: SimulatorServerStreamOptions,
): Promise<SimulatorServerStreamController | null> {
  let childProcess: ChildProcess;

  try {
    childProcess = spawn(options.binaryPath, ['ios', '--id', options.udid], {
      cwd: path.dirname(options.binaryPath),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }

  let stdinOpen = true;
  let streamUrl: string | null = null;
  let waitResolve: ((value: string | null) => void) | null = null;
  let waitTimer: NodeJS.Timeout | null = null;

  const stdoutReader = createInterface({ input: childProcess.stdout! });
  const stderrReader = createInterface({ input: childProcess.stderr! });

  stderrReader.on('line', (line) => {
    console.error(`[simulator-server] ${line}`);
  });

  stdoutReader.on('line', (line) => {
    console.error(`[simulator-server] ${line}`);

    if (line.startsWith('stream_ready ') && !streamUrl) {
      streamUrl = line.slice('stream_ready '.length).trim();

      if (waitResolve) {
        const resolve = waitResolve;
        waitResolve = null;

        if (waitTimer) {
          clearTimeout(waitTimer);
          waitTimer = null;
        }

        resolve(streamUrl);
      }
    }
  });

  childProcess.on('exit', () => {
    stdinOpen = false;

    if (waitResolve) {
      const resolve = waitResolve;
      waitResolve = null;

      if (waitTimer) {
        clearTimeout(waitTimer);
        waitTimer = null;
      }

      resolve(null);
    }
  });

  return {
    waitForStreamReady(timeoutMs: number): Promise<string | null> {
      if (streamUrl) {
        return Promise.resolve(streamUrl);
      }

      if (options.isStopped()) {
        return Promise.resolve(null);
      }

      return new Promise((resolve) => {
        waitResolve = resolve;
        waitTimer = setTimeout(() => {
          waitResolve = null;
          waitTimer = null;
          resolve(null);
        }, timeoutMs);
      });
    },

    async sendInput(line: string): Promise<boolean> {
      if (!stdinOpen || !childProcess.stdin?.writable) {
        return false;
      }

      try {
        childProcess.stdin.write(`${line}\n`);
        return true;
      } catch {
        stdinOpen = false;
        return false;
      }
    },

    async stop(): Promise<void> {
      stdinOpen = false;

      if (waitTimer) {
        clearTimeout(waitTimer);
        waitTimer = null;
      }

      waitResolve = null;
      stdoutReader.close();
      stderrReader.close();

      if (childProcess.exitCode === null && childProcess.signalCode === null) {
        childProcess.kill('SIGTERM');
        await Promise.race([waitForProcessExit(childProcess), new Promise((r) => setTimeout(r, 2000))]);

        if (childProcess.exitCode === null && childProcess.signalCode === null) {
          childProcess.kill('SIGKILL');
          await waitForProcessExit(childProcess);
        }
      }
    },
  };
}
