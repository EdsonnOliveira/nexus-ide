import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  EmulatorCaptureBackend,
  EmulatorSessionState,
  EmulatorStreamStats,
  EmulatorVideoCodec,
} from '../../types';
import type { EmulatorSessionStartControls } from './androidEmulatorSession';
import {
  resolveIdbCompanionPath,
  resolveIdbPath,
  resolveSimulatorServerPath,
  resolveXcrunPath,
} from './emulatorPaths';
import {
  createSimulatorServerStream,
  type SimulatorServerStreamController,
} from './simulatorServerStream';
import {
  charToHid,
  formatSimulatorButtonInput,
  formatSimulatorKeyInput,
  formatSimulatorTouchInput,
} from '../utils/simulatorServerInput';

export interface EmulatorSessionEvents {
  onState: (state: EmulatorSessionState, message?: string, stats?: EmulatorStreamStats) => void;
  onStreamStats: (stats: EmulatorStreamStats) => void;
  onVideoChunk: (
    chunk: Buffer,
    codec: EmulatorVideoCodec,
    size?: { width: number; height: number },
  ) => void;
}

export interface EmulatorSessionHandle {
  stop(): Promise<void>;
  tap(x: number, y: number): Promise<void>;
  swipe(x1: number, y1: number, x2: number, y2: number, durationMs: number): Promise<void>;
  pressHome(): Promise<void>;
  pressAppSwitcher(): Promise<void>;
  pressBack(): Promise<void>;
  rotate(): Promise<void>;
  takeScreenshot(outputPath: string): Promise<void>;
  typeText(text: string): Promise<void>;
  sendInput(line: string): Promise<boolean>;
}

interface SimulatorScreenInfo {
  inputWidth: number;
  inputHeight: number;
}

const MIN_FRAME_BYTES = 1_200;
const DEFAULT_INPUT_SIZE = { inputWidth: 390, inputHeight: 844 };
const STREAM_CODEC: EmulatorVideoCodec = 'jpeg';
const IDB_STREAM_FPS = 60;
const IDB_STREAM_QUALITY = 1;
const IDB_SCREENSHOT_FPS = 12;
const IDB_COMPANION_START_TIMEOUT_MS = 10_000;
const IDB_FIRST_FRAME_TIMEOUT_MS = 12_000;
const IDB_SCREENSHOT_FIRST_FRAME_TIMEOUT_MS = 8_000;
const SIMCTL_PARALLEL_CAPTURES = 3;
const SIMCTL_TARGET_FPS = 60;
const SIMULATOR_SERVER_TARGET_FPS = 60;
const SIMULATOR_SERVER_START_TIMEOUT_MS = 30_000;
const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;

  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC32_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to resolve companion port.'));
        return;
      }

      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

function waitForProcessExit(process: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (process.exitCode !== null || process.signalCode !== null) {
      resolve();
      return;
    }

    process.once('close', () => resolve());
  });
}

function stopProcess(process: ChildProcess | null, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (!process || process.killed || process.exitCode !== null) {
    return;
  }

  process.kill(signal);
}

function waitForCompanionPort(companion: ChildProcess, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false;
    let buffer = '';

    const finish = (port: number | null) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(port);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    companion.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const match = buffer.match(/"grpc_port"\s*:\s*(\d+)/);

      if (match) {
        finish(Number(match[1]));
      }
    });

    companion.once('error', () => finish(null));
    companion.once('exit', () => finish(null));
  });
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
    remainder: Buffer.from(buffer.subarray(offset)),
  };
}

interface IdbVideoStreamOptions {
  udid: string;
  idbPath: string;
  companionPath: string | null;
  companionEndpoint?: string | null;
  inputSize: SimulatorScreenInfo;
  isStopped: () => boolean;
  onFrame: (frame: Buffer) => void;
}

interface IdbVideoStreamController {
  waitForFirstFrame: (timeoutMs: number) => Promise<Buffer | null>;
  stop: () => Promise<void>;
}

async function createIdbVideoStreamController(
  options: IdbVideoStreamOptions,
): Promise<IdbVideoStreamController | null> {
  let companionProcess: ChildProcess | null = null;
  let streamProcess: ChildProcess | null = null;
  let streamBuffer = Buffer.alloc(0);
  let firstFrameResolve: ((frame: Buffer | null) => void) | null = null;
  let storedFirstFrame: Buffer | null = null;

  const stop = async (): Promise<void> => {
    stopProcess(streamProcess, 'SIGINT');
    stopProcess(companionProcess, 'SIGTERM');

    await Promise.all([
      streamProcess ? waitForProcessExit(streamProcess) : Promise.resolve(),
      companionProcess ? waitForProcessExit(companionProcess) : Promise.resolve(),
    ]);

    streamProcess = null;
    companionProcess = null;
  };

  try {
    let companionEndpoint: string | null = options.companionEndpoint ?? null;

    if (!companionEndpoint && options.companionPath) {
      const grpcPort = await findAvailablePort();
      companionProcess = spawn(
        options.companionPath,
        ['--udid', options.udid, '--only', 'simulator', '--grpc-port', String(grpcPort)],
        { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
      );

      const readyPort = await waitForCompanionPort(
        companionProcess,
        IDB_COMPANION_START_TIMEOUT_MS,
      );

      if (!readyPort || options.isStopped()) {
        await stop();
        return null;
      }

      companionEndpoint = `127.0.0.1:${readyPort}`;
    }

    const streamArgs = [
      ...(companionEndpoint ? ['--companion', companionEndpoint] : []),
      'video-stream',
      '--udid',
      options.udid,
      '--format',
      'mjpeg',
      '--fps',
      String(IDB_STREAM_FPS),
      '--compression-quality',
      String(IDB_STREAM_QUALITY),
      '--scale-factor',
      '1.0',
      '-',
    ];

    streamProcess = spawn(options.idbPath, streamArgs, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const handleStreamChunk = (chunk: Buffer) => {
      if (options.isStopped()) {
        return;
      }

      streamBuffer = Buffer.concat([streamBuffer, chunk]);
      const parsed = extractJpegFrames(streamBuffer);
      streamBuffer = parsed.remainder;

      for (const frame of parsed.frames) {
        options.onFrame(frame);

        if (!storedFirstFrame) {
          storedFirstFrame = frame;
          firstFrameResolve?.(frame);
          firstFrameResolve = null;
        }
      }
    };

    streamProcess.stdout?.on('data', handleStreamChunk);
    streamProcess.once('error', () => {
      firstFrameResolve?.(null);
      firstFrameResolve = null;
    });
    streamProcess.once('exit', () => {
      firstFrameResolve?.(null);
      firstFrameResolve = null;
    });
  } catch {
    await stop();
    return null;
  }

  return {
    waitForFirstFrame: (timeoutMs: number) =>
      new Promise((resolve) => {
        if (storedFirstFrame) {
          resolve(storedFirstFrame);
          return;
        }

        const timer = setTimeout(() => {
          firstFrameResolve = null;
          resolve(null);
        }, timeoutMs);

        firstFrameResolve = (frame) => {
          clearTimeout(timer);
          resolve(frame);
        };
      }),
    stop,
  };
}

interface IdbScreenshotStreamController {
  waitForFirstFrame: (timeoutMs: number) => Promise<Buffer | null>;
  captureNow: () => void;
  stop: () => Promise<void>;
}

interface IdbCompanionHandle {
  endpoint: string;
  stop: () => Promise<void>;
}

async function startIdbCompanion(companionPath: string, udid: string): Promise<IdbCompanionHandle | null> {
  const grpcPort = await findAvailablePort();
  const companionProcess = spawn(
    companionPath,
    ['--udid', udid, '--only', 'simulator', '--grpc-port', String(grpcPort)],
    { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const readyPort = await waitForCompanionPort(companionProcess, IDB_COMPANION_START_TIMEOUT_MS);

  if (!readyPort) {
    stopProcess(companionProcess, 'SIGTERM');
    await waitForProcessExit(companionProcess);
    return null;
  }

  return {
    endpoint: `127.0.0.1:${readyPort}`,
    stop: async () => {
      stopProcess(companionProcess, 'SIGTERM');
      await waitForProcessExit(companionProcess);
    },
  };
}

async function createIdbScreenshotStreamController(
  options: IdbVideoStreamOptions & { companionEndpoint?: string | null },
): Promise<IdbScreenshotStreamController | null> {
  let companionHandle: IdbCompanionHandle | null = null;
  let intervalId: NodeJS.Timeout | null = null;
  let inFlight = false;
  let firstFrameResolve: ((frame: Buffer | null) => void) | null = null;
  let storedFirstFrame: Buffer | null = null;

  let resolvedEndpoint = options.companionEndpoint ?? null;

  if (!resolvedEndpoint && options.companionPath) {
    companionHandle = await startIdbCompanion(options.companionPath, options.udid);

    if (!companionHandle) {
      return null;
    }

    resolvedEndpoint = companionHandle.endpoint;
  }

  const stop = async (): Promise<void> => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }

    await companionHandle?.stop();
    companionHandle = null;
  };

  const captureScreenshot = async (): Promise<Buffer | null> => {
    if (options.isStopped() || inFlight) {
      return null;
    }

    inFlight = true;

    try {
      const args = [
        ...(resolvedEndpoint ? ['--companion', resolvedEndpoint] : []),
        'screenshot',
        '--udid',
        options.udid,
        '-',
      ];
      const result = await runCommandBinary(options.idbPath, args);

      if (result.code !== 0 || !isValidPng(result.stdout)) {
        return null;
      }

      return result.stdout;
    } finally {
      inFlight = false;
    }
  };

  const handleFrame = (frame: Buffer) => {
    options.onFrame(frame);

    if (!storedFirstFrame) {
      storedFirstFrame = frame;
      firstFrameResolve?.(frame);
      firstFrameResolve = null;
    }
  };

  const captureNow = () => {
    void captureScreenshot().then((frame) => {
      if (frame) {
        handleFrame(frame);
      }
    });
  };

  const intervalMs = Math.max(16, Math.round(1000 / IDB_SCREENSHOT_FPS));
  intervalId = setInterval(() => {
    void captureScreenshot().then((frame) => {
      if (frame) {
        handleFrame(frame);
      }
    });
  }, intervalMs);
  captureNow();

  return {
    waitForFirstFrame: (timeoutMs: number) =>
      new Promise((resolve) => {
        if (storedFirstFrame) {
          resolve(storedFirstFrame);
          return;
        }

        const timer = setTimeout(() => {
          firstFrameResolve = null;
          resolve(null);
        }, timeoutMs);

        firstFrameResolve = (frame) => {
          clearTimeout(timer);
          resolve(frame);
        };
      }),
    captureNow,
    stop,
  };
}

function runCommandBinary(
  command: string,
  args: string[],
): Promise<{ stdout: Buffer; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    let stderr = '';
    const child = spawn(command, args, { env: process.env });
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      resolve({ stdout: Buffer.concat(stdoutChunks), stderr, code: code ?? 1 });
    });
    child.on('error', () => {
      resolve({ stdout: Buffer.alloc(0), stderr, code: 1 });
    });
  });
}

function runCommand(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(command, args, { env: process.env });
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });
    child.on('error', () => {
      resolve({ stdout, stderr, code: 1 });
    });
  });
}

async function bootSimulator(udid: string): Promise<void> {
  const xcrun = resolveXcrunPath();

  if (!xcrun.found) {
    throw new Error('xcrun não encontrado.');
  }

  const booted = await runCommand(xcrun.path, ['simctl', 'boot', udid]);

  if (booted.code !== 0 && !booted.stderr.includes('current state: Booted')) {
    throw new Error(booted.stderr || 'Falha ao iniciar o simulador iOS.');
  }
}

async function waitForBootComplete(
  udid: string,
  xcrunPath: string,
  isCancelled: () => boolean,
  onChild: (child: ChildProcess) => void,
): Promise<void> {
  if (isCancelled()) {
    throw new Error('Session cancelled');
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(xcrunPath, ['simctl', 'bootstatus', udid], { env: process.env });
    onChild(child);

    child.on('close', (code) => {
      if (isCancelled()) {
        reject(new Error('Session cancelled'));
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error('Falha ao aguardar boot do simulador iOS.'));
    });

    child.on('error', () => {
      reject(new Error('Falha ao aguardar boot do simulador iOS.'));
    });
  });
}

async function readSimulatorScreenInfoFromSimctl(
  udid: string,
  xcrunPath: string,
): Promise<SimulatorScreenInfo> {
  const enumerate = await runCommand(xcrunPath, ['simctl', 'io', udid, 'enumerate']);
  const lcdMatch = enumerate.stdout.match(
    /Screen Type: Integrated[\s\S]*?Pixel Size: \{(\d+),\s*(\d+)\}[\s\S]*?Preferred UI Scale: (\d+)/,
  );

  if (lcdMatch) {
    const pixelWidth = Number(lcdMatch[1]);
    const pixelHeight = Number(lcdMatch[2]);
    const scale = Number(lcdMatch[3]);

    if (scale > 0) {
      return {
        inputWidth: Math.round(pixelWidth / scale),
        inputHeight: Math.round(pixelHeight / scale),
      };
    }
  }

  return DEFAULT_INPUT_SIZE;
}

async function readSimulatorScreenInfo(
  udid: string,
  idbPath: string | null,
  xcrunPath: string,
): Promise<SimulatorScreenInfo> {
  if (idbPath) {
    const describe = await runCommand(idbPath, ['describe', '--udid', udid, '--json']);

    if (describe.code === 0 && describe.stdout.trim()) {
      try {
        const parsed = JSON.parse(describe.stdout.trim()) as {
          screen_dimensions?: {
            width_points?: number;
            height_points?: number;
            width?: number;
            height?: number;
            density?: number;
          };
        };
        const dims = parsed.screen_dimensions;

        if (dims?.width_points && dims?.height_points) {
          return {
            inputWidth: dims.width_points,
            inputHeight: dims.height_points,
          };
        }

        if (dims?.width && dims?.height && dims.density && dims.density > 0) {
          return {
            inputWidth: Math.round(dims.width / dims.density),
            inputHeight: Math.round(dims.height / dims.density),
          };
        }
      } catch {
        return readSimulatorScreenInfoFromSimctl(udid, xcrunPath);
      }
    }
  }

  return readSimulatorScreenInfoFromSimctl(udid, xcrunPath);
}

async function unlockSimulator(
  udid: string,
  idbPath: string,
  inputSize: SimulatorScreenInfo,
): Promise<void> {
  const centerX = Math.round(inputSize.inputWidth * 0.5);
  const startY = Math.round(inputSize.inputHeight * 0.92);
  const endY = Math.round(inputSize.inputHeight * 0.35);

  await runCommand(idbPath, [
    'ui',
    'swipe',
    '--udid',
    udid,
    '--duration',
    '0.45',
    String(centerX),
    String(startY),
    String(centerX),
    String(endY),
  ]);
}

function isValidJpeg(buffer: Buffer): boolean {
  return (
    buffer.length >= MIN_FRAME_BYTES &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  );
}

function isValidPng(buffer: Buffer): boolean {
  return (
    buffer.length >= MIN_FRAME_BYTES &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  );
}

async function captureSimulatorFrame(
  udid: string,
  xcrunPath: string,
  jpegPath: string,
): Promise<Buffer | null> {
  const result = await runCommand(xcrunPath, [
    'simctl',
    'io',
    udid,
    'screenshot',
    '--type=jpeg',
    jpegPath,
  ]);

  if (result.code !== 0) {
    return null;
  }

  try {
    const jpeg = await readFile(jpegPath);
    return isValidJpeg(jpeg) ? jpeg : null;
  } catch {
    return null;
  }
}

async function waitForSimulatorFrame(
  udid: string,
  xcrunPath: string,
  jpegPath: string,
  attempts = 30,
): Promise<Buffer | null> {
  for (let index = 0; index < attempts; index += 1) {
    const frame = await captureSimulatorFrame(udid, xcrunPath, jpegPath);

    if (frame) {
      return frame;
    }

    await delay(500);
  }

  return null;
}

export async function createIosSimulatorSession(
  udid: string,
  events: EmulatorSessionEvents,
  controls?: EmulatorSessionStartControls,
): Promise<EmulatorSessionHandle> {
  const idb = resolveIdbPath();
  const xcrun = resolveXcrunPath();

  if (!xcrun.found) {
    throw new Error('Xcode não encontrado.');
  }

  const sessionTempDir = await mkdtemp(path.join(tmpdir(), 'nexus-ios-'));
  const jpegPaths = [
    path.join(sessionTempDir, 'frame-0.jpg'),
    path.join(sessionTempDir, 'frame-1.jpg'),
    path.join(sessionTempDir, 'frame-2.jpg'),
  ];

  let stopped = false;
  let bootStatusProcess: ChildProcess | null = null;
  let simulatorServerController: SimulatorServerStreamController | null = null;
  let idbVideoStream: IdbVideoStreamController | null = null;
  let idbScreenshotStream: IdbScreenshotStreamController | null = null;

  const isCancelled = (): boolean => stopped || (controls?.isCancelled() ?? false);

  const cleanupTempDir = async (): Promise<void> => {
    await rm(sessionTempDir, { recursive: true, force: true }).catch(() => undefined);
  };

  controls?.registerAbort(async () => {
    stopped = true;
    stopProcess(bootStatusProcess);
    bootStatusProcess = null;
    await simulatorServerController?.stop();
    simulatorServerController = null;
    await idbVideoStream?.stop();
    idbVideoStream = null;
    await idbScreenshotStream?.stop();
    idbScreenshotStream = null;
    await cleanupTempDir();
    events.onState('stopped');
  });

  events.onState('booting');
  await bootSimulator(udid);

  if (isCancelled()) {
    throw new Error('Session cancelled');
  }

  await waitForBootComplete(udid, xcrun.path, isCancelled, (child) => {
    bootStatusProcess = child;
  });
  bootStatusProcess = null;

  if (isCancelled()) {
    throw new Error('Session cancelled');
  }

  await delay(1000);

  if (isCancelled()) {
    throw new Error('Session cancelled');
  }

  let inputSize = await readSimulatorScreenInfo(
    udid,
    idb.found ? idb.path : null,
    xcrun.path,
  );

  if (isCancelled()) {
    throw new Error('Session cancelled');
  }

  if (idb.found) {
    await unlockSimulator(udid, idb.path, inputSize);
    await delay(800);
  }

  if (isCancelled()) {
    throw new Error('Session cancelled');
  }

  const simServerTool = resolveSimulatorServerPath();
  let useSimulatorServer = false;
  let activeStreamUrl: string | null = null;
  let idbFallbackReason: string | null = null;

  if (simServerTool.found) {
    simulatorServerController = await createSimulatorServerStream({
      binaryPath: simServerTool.path,
      udid,
      isStopped: () => stopped || isCancelled(),
    });

    if (simulatorServerController) {
      activeStreamUrl = await simulatorServerController.waitForStreamReady(
        SIMULATOR_SERVER_START_TIMEOUT_MS,
      );

      if (activeStreamUrl && !isCancelled()) {
        useSimulatorServer = true;
      } else {
        await simulatorServerController.stop();
        simulatorServerController = null;
        activeStreamUrl = null;
        idbFallbackReason = 'simulator-server indisponível; tentando idb.';
      }
    }
  }

  let activeCaptures = 0;
  let lastFrameHash = 0;
  let inputChain: Promise<void> = Promise.resolve();
  let jpegPathIndex = 0;
  let processChain: Promise<void> = Promise.resolve();
  let latestPendingJpeg: string | null = null;
  let processDrainScheduled = false;
  let isLandscape = false;
  let useIdbVideoStream = false;
  let useIdbScreenshotStream = false;
  let activeStreamCodec: EmulatorVideoCodec = STREAM_CODEC;
  let framesEmitted = 0;
  let statsTimer: NodeJS.Timeout | null = null;
  let statsBaseline = 0;

  const emitFrame = (screenshot: Buffer) => {
    if (stopped) {
      return;
    }

    const pixelSample = screenshot.subarray(
      Math.min(64, screenshot.length - 1),
      Math.min(512, screenshot.length),
    );
    const frameHash = crc32(pixelSample) ^ screenshot.length;

    if (frameHash === lastFrameHash) {
      return;
    }

    lastFrameHash = frameHash;
    framesEmitted += 1;
    events.onVideoChunk(screenshot, activeStreamCodec, {
      width: inputSize.inputWidth,
      height: inputSize.inputHeight,
    });
  };

  const idbCompanion = resolveIdbCompanionPath();
  let firstFrame: Buffer | null = null;
  let sharedCompanion: IdbCompanionHandle | null = null;

  if (!useSimulatorServer) {

    const tryIdbVideoStream = async (companionPath: string | null): Promise<Buffer | null> => {
      const controller = await createIdbVideoStreamController({
        udid,
        idbPath: idb.path,
        companionPath: sharedCompanion ? null : companionPath,
        companionEndpoint: sharedCompanion?.endpoint ?? null,
        inputSize,
        isStopped: () => stopped || isCancelled(),
        onFrame: emitFrame,
      });

      if (!controller) {
        return null;
      }

      const frame = await controller.waitForFirstFrame(IDB_FIRST_FRAME_TIMEOUT_MS);

      if (frame && !isCancelled()) {
        idbVideoStream = controller;
        useIdbVideoStream = true;
        activeStreamCodec = STREAM_CODEC;
        return frame;
      }

      await controller.stop();
      return null;
    };

    const tryIdbScreenshotStream = async (): Promise<Buffer | null> => {
      const controller = await createIdbScreenshotStreamController({
        udid,
        idbPath: idb.path,
        companionPath: sharedCompanion ? null : idbCompanion.path,
        companionEndpoint: sharedCompanion?.endpoint ?? null,
        inputSize,
        isStopped: () => stopped || isCancelled(),
        onFrame: emitFrame,
      });

      if (!controller) {
        return null;
      }

      const frame = await controller.waitForFirstFrame(IDB_SCREENSHOT_FIRST_FRAME_TIMEOUT_MS);

      if (frame && !isCancelled()) {
        idbScreenshotStream = controller;
        useIdbScreenshotStream = true;
        activeStreamCodec = 'png';
        return frame;
      }

      await controller.stop();
      return null;
    };

    if (idb.found && idbCompanion.found) {
      sharedCompanion = await startIdbCompanion(idbCompanion.path, udid);
    }

    if (idb.found && sharedCompanion) {
      firstFrame = await tryIdbVideoStream(null);

      if (!firstFrame) {
        firstFrame = await tryIdbScreenshotStream();
      }
    }

    if (!firstFrame && idb.found) {
      if (sharedCompanion) {
        await sharedCompanion.stop();
        sharedCompanion = null;
      }

      firstFrame = await tryIdbVideoStream(null);

      if (!firstFrame) {
        firstFrame = await tryIdbScreenshotStream();
      }
    }

    if (!useIdbVideoStream && !useIdbScreenshotStream) {
      if (sharedCompanion) {
        await sharedCompanion.stop();
        sharedCompanion = null;
      }

      if (!idbFallbackReason) {
        idbFallbackReason = 'idb video-stream indisponível; usando captura simctl.';
      }
    }

    if (!useIdbVideoStream && !useIdbScreenshotStream) {
      firstFrame = await waitForSimulatorFrame(udid, xcrun.path, jpegPaths[0]);
    }

    if (isCancelled()) {
      await idbVideoStream?.stop();
      throw new Error('Session cancelled');
    }

    if (!firstFrame) {
      await idbVideoStream?.stop();
      await cleanupTempDir();
      throw new Error('Não foi possível capturar a tela do simulador iOS.');
    }
  } else if (isCancelled()) {
    await simulatorServerController?.stop();
    throw new Error('Session cancelled');
  }

  const drainProcessQueue = () => {
    if (processDrainScheduled) {
      return;
    }

    processDrainScheduled = true;

    processChain = processChain
      .then(async () => {
        while (latestPendingJpeg && !stopped) {
          const jpegPath = latestPendingJpeg;
          latestPendingJpeg = null;

          try {
            const jpeg = await readFile(jpegPath);

            if (isValidJpeg(jpeg) && !stopped) {
              emitFrame(jpeg);
            }
          } catch {}
        }
      })
      .catch(() => undefined)
      .finally(() => {
        processDrainScheduled = false;

        if (latestPendingJpeg && !stopped) {
          drainProcessQueue();
        }
      });
  };

  const enqueueProcess = (jpegPath: string) => {
    latestPendingJpeg = jpegPath;
    drainProcessQueue();
  };

  const scheduleCapture = () => {
    if (stopped) {
      return;
    }

    while (activeCaptures < SIMCTL_PARALLEL_CAPTURES && !stopped) {
      void runCapture();
    }
  };

  const runInput = (task: () => Promise<void>): Promise<void> => {
    inputChain = inputChain.then(task).catch(() => undefined);
    return inputChain;
  };

  const triggerBurstCapture = () => {
    if (stopped) {
      return;
    }

    if (useIdbVideoStream) {
      lastFrameHash = 0;
      return;
    }

    if (useIdbScreenshotStream) {
      lastFrameHash = 0;
      idbScreenshotStream?.captureNow();
      return;
    }

    scheduleCapture();
  };

  const useIdbCapture = useIdbVideoStream || useIdbScreenshotStream;
  const captureBackend: EmulatorCaptureBackend = useSimulatorServer
    ? 'simulator-server'
    : useIdbCapture
      ? 'idb'
      : 'simctl';
  const targetFps = useSimulatorServer
    ? SIMULATOR_SERVER_TARGET_FPS
    : useIdbVideoStream
      ? IDB_STREAM_FPS
      : useIdbScreenshotStream
        ? IDB_SCREENSHOT_FPS
        : SIMCTL_TARGET_FPS;

  const sendSimulatorInput = async (line: string): Promise<boolean> => {
    return simulatorServerController?.sendInput(line) ?? false;
  };

  const typeTextWithSimulatorServer = async (text: string) => {
    for (const char of text) {
      const code = charToHid(char);

      if (code === null) {
        continue;
      }

      await sendSimulatorInput(formatSimulatorKeyInput('Down', code));
      await sendSimulatorInput(formatSimulatorKeyInput('Up', code));
    }
  };

  const swapInputOrientation = () => {
    inputSize = {
      inputWidth: inputSize.inputHeight,
      inputHeight: inputSize.inputWidth,
    };
  };

  const sendHomeButtonPress = async () => {
    if (useSimulatorServer) {
      await sendSimulatorInput(formatSimulatorButtonInput('Down', 'home'));
      await delay(80);
      await sendSimulatorInput(formatSimulatorButtonInput('Up', 'home'));
      return;
    }

    if (idb.found) {
      const result = await runCommand(idb.path, ['ui', 'button', '--udid', udid, 'HOME']);

      if (result.code === 0) {
        return;
      }
    }

    await runCommand('osascript', [
      '-e',
      'tell application "Simulator" to activate',
      '-e',
      'tell application "System Events" to keystroke "h" using {shift down, command down}',
    ]);
  };

  const pressHomeWithFallback = async () => {
    await sendHomeButtonPress();
  };

  const performAppSwitcherGesture = async (): Promise<boolean> => {
    const centerX = 0.5;
    const startY = 0.96;
    const holdY = 0.5;

    if (useSimulatorServer) {
      await sendSimulatorInput(formatSimulatorTouchInput('Down', centerX, startY));
      await delay(50);

      const steps = 10;

      for (let step = 1; step <= steps; step += 1) {
        const y = startY + ((holdY - startY) * step) / steps;
        await sendSimulatorInput(formatSimulatorTouchInput('Move', centerX, y));
        await delay(35);
      }

      await delay(800);
      await sendSimulatorInput(formatSimulatorTouchInput('Up', centerX, holdY));
      return true;
    }

    if (idb.found) {
      const px = Math.round(centerX * inputSize.inputWidth);
      const startPy = Math.round(startY * inputSize.inputHeight);
      const holdPy = Math.round(holdY * inputSize.inputHeight);
      const result = await runCommand(idb.path, [
        'ui',
        'swipe',
        '--udid',
        udid,
        '--duration',
        '1.4',
        String(px),
        String(startPy),
        String(px),
        String(holdPy),
      ]);

      return result.code === 0;
    }

    return false;
  };

  const pressAppSwitcherWithFallback = async () => {
    const shortcutResult = await runCommand('osascript', [
      '-e',
      'tell application "Simulator" to activate',
      '-e',
      'delay 0.15',
      '-e',
      'tell application "System Events" to keystroke "h" using {control down, shift down, command down}',
    ]);

    if (shortcutResult.code === 0) {
      return;
    }

    const menuResult = await runCommand('osascript', [
      '-e',
      'tell application "Simulator" to activate',
      '-e',
      'delay 0.15',
      '-e',
      'tell application "System Events" to tell process "Simulator" to click menu item "App Switcher" of menu "Device" of menu bar 1',
    ]);

    if (menuResult.code === 0) {
      return;
    }

    await performAppSwitcherGesture();
  };

  const rotateWithFallback = async () => {
    isLandscape = !isLandscape;

    if (idb.found) {
      await runCommand(idb.path, [
        'ui',
        'rotate',
        '--udid',
        udid,
        '--orientation',
        isLandscape ? 'landscape_left' : 'portrait',
      ]);
      swapInputOrientation();
      lastFrameHash = 0;
      return;
    }

    await runCommand('osascript', [
      '-e',
      'tell application "Simulator" to activate',
      '-e',
      'tell application "System Events" to keystroke "left" using command down',
    ]);
    swapInputOrientation();
    lastFrameHash = 0;
  };

  const typeTextWithIdb = async (text: string) => {
    let buffer = '';

    const flushBuffer = async () => {
      if (!buffer) {
        return;
      }

      await runCommand(idb.path, ['ui', 'text', '--udid', udid, buffer]);
      buffer = '';
    };

    for (const char of text) {
      if (char === '\n' || char === '\r') {
        await flushBuffer();
        await runCommand(idb.path, ['ui', 'key', '--udid', udid, 'Return']);
        continue;
      }

      if (char === '\b') {
        await flushBuffer();
        await runCommand(idb.path, ['ui', 'key', '--udid', udid, 'Delete']);
        continue;
      }

      buffer += char;
    }

    await flushBuffer();
  };

  const typeTextWithOsascript = async (text: string) => {
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    await runCommand('osascript', [
      '-e',
      'tell application "Simulator" to activate',
      '-e',
      `tell application "System Events" to keystroke "${escaped}"`,
    ]);
  };

  const runCapture = async () => {
    if (stopped) {
      return;
    }

    activeCaptures += 1;

    const jpegPath = jpegPaths[jpegPathIndex % jpegPaths.length];
    jpegPathIndex += 1;

    try {
      const result = await runCommand(xcrun.path, [
        'simctl',
        'io',
        udid,
        'screenshot',
        '--type=jpeg',
        jpegPath,
      ]);

      if (result.code === 0 && !stopped) {
        enqueueProcess(jpegPath);
      }
    } finally {
      activeCaptures -= 1;

      if (!stopped) {
        scheduleCapture();
      }
    }
  };

  const publishStreamStats = () => {
    const streamFps = framesEmitted - statsBaseline;
    statsBaseline = framesEmitted;
    events.onStreamStats({
      captureBackend,
      targetFps,
      streamFps,
      fallbackReason: idbFallbackReason ?? undefined,
    });
  };

  if (!useSimulatorServer && !useIdbCapture && firstFrame) {
    emitFrame(firstFrame);
  }

  if (useSimulatorServer && simulatorServerController) {
    simulatorServerController.startFrameRelay((frame) => {
      emitFrame(frame);
    });
  }

  events.onState('running', undefined, {
    captureBackend,
    targetFps,
    streamFps: 0,
    fallbackReason: idbFallbackReason ?? undefined,
  });

  statsTimer = setInterval(publishStreamStats, 1000);

  if (!useSimulatorServer && !useIdbCapture) {
    scheduleCapture();
  }

  return {
    async stop() {
      stopped = true;
      stopProcess(bootStatusProcess);
      bootStatusProcess = null;

      if (statsTimer) {
        clearInterval(statsTimer);
        statsTimer = null;
      }

      latestPendingJpeg = null;
      await simulatorServerController?.stop();
      simulatorServerController = null;
      await idbVideoStream?.stop();
      await idbScreenshotStream?.stop();
      await sharedCompanion?.stop();
      sharedCompanion = null;
      await processChain.catch(() => undefined);
      await cleanupTempDir();
      events.onState('stopped');
    },
    async tap(x, y) {
      if (useSimulatorServer) {
        await runInput(async () => {
          await sendSimulatorInput(formatSimulatorTouchInput('Down', x, y));
          await sendSimulatorInput(formatSimulatorTouchInput('Up', x, y));
        });
        return;
      }

      if (!idb.found) {
        return;
      }

      await runInput(async () => {
        const px = Math.round(x * inputSize.inputWidth);
        const py = Math.round(y * inputSize.inputHeight);
        await runCommand(idb.path, [
          'ui',
          'tap',
          '--udid',
          udid,
          '--duration',
          '0.05',
          String(px),
          String(py),
        ]);
        triggerBurstCapture();
      });
    },
    async swipe(x1, y1, x2, y2, durationMs) {
      if (useSimulatorServer) {
        await runInput(async () => {
          await sendSimulatorInput(formatSimulatorTouchInput('Down', x1, y1));
          await sendSimulatorInput(formatSimulatorTouchInput('Move', x2, y2));
          await sendSimulatorInput(formatSimulatorTouchInput('Up', x2, y2));
        });
        return;
      }

      if (!idb.found) {
        return;
      }

      await runInput(async () => {
        const startX = Math.round(x1 * inputSize.inputWidth);
        const startY = Math.round(y1 * inputSize.inputHeight);
        const endX = Math.round(x2 * inputSize.inputWidth);
        const endY = Math.round(y2 * inputSize.inputHeight);
        const durationSec = Math.max(durationMs, 120) / 1000;
        await runCommand(idb.path, [
          'ui',
          'swipe',
          '--udid',
          udid,
          '--duration',
          String(durationSec),
          String(startX),
          String(startY),
          String(endX),
          String(endY),
        ]);
        triggerBurstCapture();
      });
    },
    async pressHome() {
      await runInput(async () => {
        await pressHomeWithFallback();
        triggerBurstCapture();
      });
    },
    async pressAppSwitcher() {
      await runInput(async () => {
        await pressAppSwitcherWithFallback();
        triggerBurstCapture();
      });
    },
    async pressBack() {},
    async rotate() {
      await runInput(async () => {
        await rotateWithFallback();
        triggerBurstCapture();
      });
    },
    async typeText(text: string) {
      if (!text) {
        return;
      }

      await runInput(async () => {
        if (useSimulatorServer) {
          await typeTextWithSimulatorServer(text);
        } else if (idb.found) {
          await typeTextWithIdb(text);
        } else {
          await typeTextWithOsascript(text);
        }

        triggerBurstCapture();
      });
    },
    async sendInput(line: string) {
      return sendSimulatorInput(line);
    },
    async takeScreenshot(outputPath: string) {
      await runCommand(xcrun.path, ['simctl', 'io', udid, 'screenshot', outputPath]);
      triggerBurstCapture();
    },
  };
}
