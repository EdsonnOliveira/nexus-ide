import { type ChildProcess, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import http from 'node:http';
import path from 'node:path';

const MIN_FRAME_BYTES = 1_200;
const MAX_RELAY_BUFFER_BYTES = 16 * 1024 * 1024;
const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);

function isValidJpeg(buffer: Buffer): boolean {
  return (
    buffer.length >= MIN_FRAME_BYTES &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  );
}

function extractJpegFrames(buffer: Buffer): { frames: Buffer[]; remainder: Buffer } {
  const frames: Buffer[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const start = buffer.indexOf(JPEG_SOI, offset);

    if (start === -1) {
      break;
    }

    const end = buffer.indexOf(JPEG_EOI, start + 2);

    if (end === -1) {
      offset = start;
      break;
    }

    const frame = buffer.subarray(start, end + 2);

    if (frame.length >= MIN_FRAME_BYTES && isValidJpeg(frame)) {
      frames.push(Buffer.from(frame));
    }

    offset = end + 2;
  }

  return {
    frames,
    remainder: offset < buffer.length ? buffer.subarray(offset) : Buffer.alloc(0),
  };
}

export interface SimulatorServerStreamOptions {
  binaryPath: string;
  udid: string;
  isStopped: () => boolean;
}

export interface SimulatorServerStreamController {
  waitForStreamReady(timeoutMs: number): Promise<string | null>;
  startFrameRelay(onFrame: (frame: Buffer) => void): void;
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
  let relayRequest: http.ClientRequest | null = null;
  let relayBuffer = Buffer.alloc(0);

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

    startFrameRelay(onFrame: (frame: Buffer) => void): void {
      if (!streamUrl || relayRequest || options.isStopped()) {
        return;
      }

      relayRequest = http.get(streamUrl, (response) => {
        response.on('data', (chunk: Buffer) => {
          if (options.isStopped()) {
            return;
          }

          relayBuffer = Buffer.concat([relayBuffer, chunk]);

          if (relayBuffer.length > MAX_RELAY_BUFFER_BYTES) {
            const lastSoi = relayBuffer.lastIndexOf(JPEG_SOI);
            relayBuffer =
              lastSoi > 0 ? Buffer.from(relayBuffer.subarray(lastSoi)) : Buffer.alloc(0);
          }

          const parsed = extractJpegFrames(relayBuffer);
          relayBuffer = parsed.remainder;

          for (const frame of parsed.frames) {
            onFrame(frame);
          }
        });
      });

      relayRequest.on('error', () => undefined);
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
      relayRequest?.destroy();
      relayRequest = null;
      relayBuffer = Buffer.alloc(0);

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
