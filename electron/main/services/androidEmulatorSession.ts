import { type ChildProcess, spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import type {
  EmulatorCaptureBackend,
  EmulatorSessionState,
  EmulatorStreamStats,
  EmulatorVideoCodec,
} from '../../types';
import { resolveAdbPath, resolveEmulatorPath } from './emulatorPaths';

export interface EmulatorSessionEvents {
  onState: (state: EmulatorSessionState, message?: string, stats?: EmulatorStreamStats) => void;
  onStreamStats: (stats: EmulatorStreamStats) => void;
  onVideoChunk: (
    chunk: Buffer,
    codec: EmulatorVideoCodec,
    size?: { width: number; height: number },
  ) => void;
}

export interface EmulatorSessionStartControls {
  registerAbort: (abort: () => Promise<void>) => void;
  isCancelled: () => boolean;
}

export interface EmulatorSessionHandle {
  stop(): Promise<void>;
  tap(x: number, y: number): Promise<void>;
  swipe(x1: number, y1: number, x2: number, y2: number, durationMs: number): Promise<void>;
  pressHome(): Promise<void>;
  pressBack(): Promise<void>;
  rotate(): Promise<void>;
  takeScreenshot(outputPath: string): Promise<void>;
  typeText(text: string): Promise<void>;
}

const STREAM_MAX_WIDTH = 540;
const MIN_FRAME_INTERVAL_MS = 50;
const BURST_FRAME_INTERVAL_MS = 25;
const BURST_DURATION_MS = 1500;
const INPUT_CAPTURE_IDLE_TIMEOUT_MS = 100;
const INPUT_CAPTURE_POLL_MS = 4;
const KEYCODE_WAKEUP = '224';
const KEYCODE_HOME = '3';
const KEYCODE_BACK = '4';
const KEYCODE_MENU = '82';
const KEYCODE_ENTER = '66';
const KEYCODE_DEL = '67';
const HOME_KEY_DELAY_MS = 250;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function encodeAndroidInputText(text: string): string {
  let encoded = '';

  for (const char of text) {
    if (char === ' ') {
      encoded += '%s';
      continue;
    }

    if (char === '%') {
      encoded += '%25';
      continue;
    }

    if (/^[a-zA-Z0-9@.,_\-+/*=:()]+$/.test(char)) {
      encoded += char;
      continue;
    }

    encoded += `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`;
  }

  return encoded;
}

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

function writePngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodeRgbaToPng(width: number, height: number, rgba: Buffer): Buffer {
  const stride = width * 4;
  const filtered = Buffer.alloc(height * (stride + 1));

  for (let row = 0; row < height; row += 1) {
    const targetOffset = row * (stride + 1);
    filtered[targetOffset] = 0;
    rgba.copy(filtered, targetOffset + 1, row * stride, (row + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    writePngChunk('IHDR', ihdr),
    writePngChunk('IDAT', deflateSync(filtered, { level: 1 })),
    writePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function scaleRgbaNearest(
  srcWidth: number,
  srcHeight: number,
  src: Buffer,
  targetWidth: number,
  targetHeight: number,
): Buffer {
  const dst = Buffer.alloc(targetWidth * targetHeight * 4);
  const xRatio = srcWidth / targetWidth;
  const yRatio = srcHeight / targetHeight;

  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const srcX = Math.min(srcWidth - 1, Math.floor(x * xRatio));
      const srcY = Math.min(srcHeight - 1, Math.floor(y * yRatio));
      const srcOffset = (srcY * srcWidth + srcX) * 4;
      const dstOffset = (y * targetWidth + x) * 4;
      src.copy(dst, dstOffset, srcOffset, srcOffset + 4);
    }
  }

  return dst;
}

function encodeScaledRawFrame(
  width: number,
  height: number,
  rgba: Buffer,
): { png: Buffer; width: number; height: number } {
  const streamTarget = computeStreamSize(width, height);

  if (streamTarget.width === width && streamTarget.height === height) {
    return { png: encodeRgbaToPng(width, height, rgba), width, height };
  }

  const scaled = scaleRgbaNearest(width, height, rgba, streamTarget.width, streamTarget.height);

  return {
    png: encodeRgbaToPng(streamTarget.width, streamTarget.height, scaled),
    width: streamTarget.width,
    height: streamTarget.height,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runAdb(
  adbPath: string,
  args: string[],
  serial?: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const commandArgs = serial ? ['-s', serial, ...args] : args;

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(adbPath, commandArgs, { env: process.env });
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

async function runAdbWithRetry(
  adbPath: string,
  args: string[],
  serial?: string,
  attempts = 2,
): Promise<{ stdout: string; stderr: string; code: number }> {
  let lastResult = { stdout: '', stderr: '', code: 1 };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    lastResult = await runAdb(adbPath, args, serial);

    if (lastResult.code === 0) {
      return lastResult;
    }

    if (attempt < attempts - 1) {
      await delay(60);
    }
  }

  return lastResult;
}

async function resolveAndroidSerial(adbPath: string, avdName: string): Promise<string | null> {
  const devices = await runAdb(adbPath, ['devices']);
  const lines = devices.stdout.split('\n').slice(1);

  for (const line of lines) {
    const [serial, state] = line.trim().split(/\s+/);

    if (!serial || state !== 'device') {
      continue;
    }

    if (serial === avdName || serial.includes(avdName)) {
      return serial;
    }
  }

  for (const line of lines) {
    const [serial, state] = line.trim().split(/\s+/);

    if (serial && state === 'device') {
      return serial;
    }
  }

  return null;
}

async function waitForAndroidBoot(
  adbPath: string,
  serial: string,
  shouldCancel?: () => boolean,
): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (shouldCancel?.()) {
      throw new Error('Session cancelled');
    }

    const booted = await runAdb(adbPath, ['shell', 'getprop', 'sys.boot_completed'], serial);

    if (booted.stdout.trim() === '1') {
      return;
    }

    await delay(1000);
  }

  throw new Error('Timeout ao iniciar o emulador Android.');
}

async function startHomeLauncher(adbPath: string, serial: string): Promise<void> {
  const startHome = await runAdb(adbPath, ['shell', 'cmd', 'activity', 'start-home'], serial);

  if (startHome.code !== 0) {
    await runAdb(
      adbPath,
      [
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.MAIN',
        '-c',
        'android.intent.category.HOME',
      ],
      serial,
    );
  }
}

async function resetDisplayOverrides(adbPath: string, serial: string): Promise<void> {
  await runAdb(adbPath, ['shell', 'wm', 'size', 'reset'], serial);
  await runAdb(adbPath, ['shell', 'wm', 'density', 'reset'], serial);
  await delay(400);
}

function readPngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (!isValidPng(buffer) || buffer.length < 24) {
    return null;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function ensureFullscreenHome(adbPath: string, serial: string): Promise<void> {
  await runAdb(adbPath, ['shell', 'input', 'keyevent', KEYCODE_BACK], serial);
  await delay(150);
  await runAdb(adbPath, ['shell', 'input', 'keyevent', KEYCODE_HOME], serial);
  await delay(HOME_KEY_DELAY_MS);
  await runAdb(adbPath, ['shell', 'input', 'keyevent', KEYCODE_HOME], serial);
  await delay(HOME_KEY_DELAY_MS);
  await startHomeLauncher(adbPath, serial);
}

async function dismissKeyguard(
  adbPath: string,
  serial: string,
  size: { width: number; height: number },
): Promise<void> {
  await runAdb(adbPath, ['shell', 'input', 'keyevent', KEYCODE_WAKEUP], serial);
  await delay(300);
  await runAdb(adbPath, ['shell', 'wm', 'dismiss-keyguard'], serial);
  await delay(200);
  await runAdb(adbPath, ['shell', 'input', 'keyevent', KEYCODE_MENU], serial);
  await delay(150);

  const centerX = Math.round(size.width * 0.5);
  const startY = Math.round(size.height * 0.92);
  const endY = Math.round(size.height * 0.35);

  await runAdb(
    adbPath,
    [
      'shell',
      'input',
      'swipe',
      String(centerX),
      String(startY),
      String(centerX),
      String(endY),
      '450',
    ],
    serial,
  );
  await delay(400);
}

async function unlockAndroidDevice(
  adbPath: string,
  serial: string,
  size: { width: number; height: number },
): Promise<void> {
  await dismissKeyguard(adbPath, serial, size);
  await ensureFullscreenHome(adbPath, serial);
}

async function pressHomeAndroid(adbPath: string, serial: string): Promise<void> {
  await runAdbWithRetry(adbPath, ['shell', 'input', 'keyevent', KEYCODE_WAKEUP], serial);
  await delay(100);
  await runAdbWithRetry(adbPath, ['shell', 'wm', 'dismiss-keyguard'], serial);
  await delay(100);
  const firstHome = await runAdbWithRetry(
    adbPath,
    ['shell', 'input', 'keyevent', KEYCODE_HOME],
    serial,
  );

  if (firstHome.code !== 0) {
    await startHomeLauncher(adbPath, serial);
    return;
  }

  await delay(HOME_KEY_DELAY_MS);
  await runAdbWithRetry(adbPath, ['shell', 'input', 'keyevent', KEYCODE_HOME], serial);
  await delay(HOME_KEY_DELAY_MS);
  await startHomeLauncher(adbPath, serial);
}

async function pressBackAndroid(adbPath: string, serial: string): Promise<void> {
  await runAdbWithRetry(adbPath, ['shell', 'input', 'keyevent', KEYCODE_BACK], serial);
}

function isValidPng(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50;
}

function fixAdbPngBuffer(buffer: Buffer): Buffer {
  if (isValidPng(buffer)) {
    return buffer;
  }

  const fixed = Buffer.from(buffer.toString('binary').replace(/\r\n/g, '\n'), 'binary');

  if (isValidPng(fixed)) {
    return fixed;
  }

  return buffer;
}

interface DisplaySizes {
  physical: { width: number; height: number };
  current: { width: number; height: number };
}

function parseDisplaySizeMatch(match: RegExpMatchArray): { width: number; height: number } {
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

async function readDisplaySizes(adbPath: string, serial: string): Promise<DisplaySizes> {
  const result = await runAdb(adbPath, ['shell', 'wm', 'size'], serial);
  const physicalMatch = result.stdout.match(/Physical size:\s*(\d+)x(\d+)/i);
  const overrideMatch = result.stdout.match(/Override size:\s*(\d+)x(\d+)/i);
  const fallbackMatch = result.stdout.match(/(\d+)x(\d+)/);
  const fallback = { width: 1080, height: 1920 };

  if (physicalMatch && overrideMatch) {
    return {
      physical: parseDisplaySizeMatch(physicalMatch),
      current: parseDisplaySizeMatch(overrideMatch),
    };
  }

  if (physicalMatch) {
    const physical = parseDisplaySizeMatch(physicalMatch);
    return { physical, current: physical };
  }

  if (fallbackMatch) {
    const size = parseDisplaySizeMatch(fallbackMatch);
    return { physical: size, current: size };
  }

  return { physical: fallback, current: fallback };
}

function computeStreamSize(width: number, height: number): { width: number; height: number } {
  if (width <= STREAM_MAX_WIDTH) {
    return { width, height };
  }

  const scale = STREAM_MAX_WIDTH / width;

  return {
    width: STREAM_MAX_WIDTH,
    height: Math.max(1, Math.round(height * scale)),
  };
}

function buildEmulatorArgs(avdName: string): string[] {
  const args = [
    '-avd',
    avdName,
    '-no-window',
    '-no-audio',
    '-no-boot-anim',
    '-no-snapshot-save',
    '-accel',
    'on',
    '-cores',
    '4',
    '-memory',
    '4096',
    '-gpu',
    process.platform === 'darwin' ? 'swiftshader_indirect' : 'auto',
  ];

  return args;
}

interface RawFrameInfo {
  width: number;
  height: number;
  headerSize: number;
  frameSize: number;
}

function bytesPerPixelForFormat(format: number): number | null {
  if (format === 1 || format === 2 || format === 5) {
    return 4;
  }

  if (format === 3) {
    return 3;
  }

  if (format === 4) {
    return 2;
  }

  return null;
}

function parseRawFrameHeader(buffer: Buffer, offset: number): RawFrameInfo | null {
  if (buffer.length - offset < 8) {
    return null;
  }

  const width = buffer.readUInt32LE(offset);
  const height = buffer.readUInt32LE(offset + 4);

  if (
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 4096 ||
    width * height > 4096 * 4096
  ) {
    return null;
  }

  if (buffer.length - offset < 12) {
    return null;
  }

  const format = buffer.readUInt32LE(offset + 8);
  const bytesPerPixel = bytesPerPixelForFormat(format);

  if (!bytesPerPixel) {
    return null;
  }

  const headerSize = 12;
  const frameSize = headerSize + width * height * bytesPerPixel;

  if (buffer.length - offset < frameSize) {
    return null;
  }

  return { width, height, headerSize, frameSize };
}

function findPngFrameEnd(buffer: Buffer, start: number): number {
  const iend = Buffer.from('IEND', 'ascii');
  let searchFrom = start + PNG_SIGNATURE.length;

  while (searchFrom < buffer.length) {
    const iendIndex = buffer.indexOf(iend, searchFrom);

    if (iendIndex === -1) {
      return -1;
    }

    const frameEnd = iendIndex + 8;

    if (frameEnd <= buffer.length) {
      return frameEnd;
    }

    return -1;
  }

  return -1;
}

export async function createAndroidEmulatorSession(
  avdName: string,
  events: EmulatorSessionEvents,
  controls?: EmulatorSessionStartControls,
): Promise<EmulatorSessionHandle> {
  const emulatorTool = resolveEmulatorPath();
  const adbTool = resolveAdbPath();

  if (!emulatorTool.found || !adbTool.found) {
    throw new Error('Ferramentas Android não encontradas.');
  }

  events.onState('booting');

  let emulatorProcess: ChildProcess | null = null;
  let captureProcess: ChildProcess | null = null;
  let captureTimer: NodeJS.Timeout | null = null;
  let captureInFlight = false;
  let stopped = false;
  let capturePaused = false;
  let inputGate: Promise<void> = Promise.resolve();
  let serial: string | null = await resolveAndroidSerial(adbTool.path, avdName);
  let displaySize = { width: 1080, height: 1920 };
  let inputSize = { width: 1080, height: 1920 };
  let lastFrameHash = 0;
  let lastEmitAt = 0;
  let pendingFrame: Buffer | null = null;
  let pendingEmitTimer: NodeJS.Timeout | null = null;
  let framesEmitted = 0;
  let captureMode: 'raw' | 'png' = 'png';
  let captureWatchdog: NodeJS.Timeout | null = null;
  let isLandscape = false;
  let burstUntil = 0;
  let inputShell: ChildProcess | null = null;

  const isCancelled = (): boolean => stopped || (controls?.isCancelled() ?? false);

  controls?.registerAbort(async () => {
    stopped = true;

    if (emulatorProcess && !emulatorProcess.killed) {
      emulatorProcess.kill('SIGTERM');
      emulatorProcess = null;
    }

    events.onState('stopped');
  });

  const destroyInputShell = (): void => {
    if (inputShell && !inputShell.killed) {
      inputShell.stdin?.end();
      inputShell.kill('SIGTERM');
    }

    inputShell = null;
  };

  const ensureInputShell = (): ChildProcess | null => {
    if (!serial) {
      return null;
    }

    if (inputShell && !inputShell.killed) {
      return inputShell;
    }

    inputShell = spawn(adbTool.path, ['-s', serial, 'shell'], {
      env: process.env,
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    inputShell.on('close', () => {
      inputShell = null;
    });
    inputShell.on('error', () => {
      inputShell = null;
    });

    return inputShell;
  };

  const sendShellCommand = (command: string): void => {
    const shell = ensureInputShell();
    shell?.stdin?.write(`${command}\n`);
  };

  const getFrameInterval = (): number =>
    Date.now() < burstUntil ? BURST_FRAME_INTERVAL_MS : MIN_FRAME_INTERVAL_MS;

  const triggerBurstCapture = () => {
    burstUntil = Date.now() + BURST_DURATION_MS;
    lastFrameHash = 0;
  };

  const emitFrame = (frame: Buffer, size?: { width: number; height: number }) => {
    if (stopped) {
      return;
    }

    if (size) {
      displaySize = size;
    }

    const pixelSample = frame.subarray(Math.min(64, frame.length - 1), Math.min(512, frame.length));
    const frameHash = crc32(pixelSample) ^ frame.length;

    if (frameHash === lastFrameHash) {
      return;
    }

    lastFrameHash = frameHash;

    const now = Date.now();
    const elapsed = now - lastEmitAt;

    if (elapsed < getFrameInterval()) {
      pendingFrame = frame;

      if (!pendingEmitTimer) {
        pendingEmitTimer = setTimeout(() => {
          pendingEmitTimer = null;
          const nextFrame = pendingFrame;
          pendingFrame = null;

          if (nextFrame && !stopped) {
            lastEmitAt = Date.now();
            framesEmitted += 1;
            events.onVideoChunk(nextFrame, 'png', displaySize);
          }
        }, getFrameInterval() - elapsed);
      }

      return;
    }

    pendingFrame = null;

    if (pendingEmitTimer) {
      clearTimeout(pendingEmitTimer);
      pendingEmitTimer = null;
    }

    lastEmitAt = now;
    framesEmitted += 1;
    events.onVideoChunk(frame, 'png', displaySize);
  };

  if (!serial) {
    emulatorProcess = spawn(emulatorTool.path, buildEmulatorArgs(avdName), {
      env: process.env,
      detached: false,
    });

    emulatorProcess.on('error', () => {
      events.onState('error', 'Falha ao iniciar o emulador Android.');
    });

    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (isCancelled()) {
        break;
      }

      serial = await resolveAndroidSerial(adbTool.path, avdName);

      if (serial) {
        break;
      }

      await delay(1000);
    }
  }

  if (isCancelled()) {
    throw new Error('Session cancelled');
  }

  if (!serial) {
    throw new Error('Não foi possível conectar ao emulador Android.');
  }

  await waitForAndroidBoot(adbTool.path, serial, isCancelled);

  if (isCancelled()) {
    throw new Error('Session cancelled');
  }

  await resetDisplayOverrides(adbTool.path, serial);

  if (isCancelled()) {
    throw new Error('Session cancelled');
  }

  const bootSizes = await readDisplaySizes(adbTool.path, serial);
  const nativeSize = bootSizes.physical;
  inputSize = { ...nativeSize };
  displaySize = computeStreamSize(nativeSize.width, nativeSize.height);

  if (isCancelled()) {
    throw new Error('Session cancelled');
  }

  await unlockAndroidDevice(adbTool.path, serial, nativeSize);
  await delay(800);

  if (isCancelled()) {
    throw new Error('Session cancelled');
  }

  await ensureFullscreenHome(adbTool.path, serial);
  await delay(400);

  if (isCancelled()) {
    throw new Error('Session cancelled');
  }

  triggerBurstCapture();

  const captureBackend: EmulatorCaptureBackend = 'adb';
  const targetFps = 60;
  let statsBaseline = framesEmitted;
  let statsTimer: NodeJS.Timeout | null = null;

  events.onState('running', undefined, {
    captureBackend,
    targetFps,
    streamFps: 0,
  });

  statsTimer = setInterval(() => {
    if (stopped) {
      return;
    }

    const streamFps = framesEmitted - statsBaseline;
    statsBaseline = framesEmitted;
    events.onStreamStats({
      captureBackend,
      targetFps,
      streamFps,
    });
  }, 1000);

  const processRawBuffer = (incoming: Buffer) => {
    let buffer = incoming;

    while (buffer.length >= 12 && !stopped) {
      const header = parseRawFrameHeader(buffer, 0);

      if (!header) {
        if (buffer.length > 4 * 1024 * 1024) {
          return buffer.subarray(buffer.length - 12);
        }

        break;
      }

      const format = buffer.readUInt32LE(8);

      if (format !== 1 && format !== 2 && format !== 5) {
        buffer = buffer.subarray(header.frameSize);
        continue;
      }

      const pixels = buffer.subarray(header.headerSize, header.frameSize);
      buffer = buffer.subarray(header.frameSize);

      try {
        const encoded = encodeScaledRawFrame(header.width, header.height, pixels);
        emitFrame(encoded.png, { width: encoded.width, height: encoded.height });
      } catch {
        continue;
      }
    }

    return buffer;
  };

  const processPngBuffer = (incoming: Buffer) => {
    let buffer = incoming;

    while (buffer.length >= PNG_SIGNATURE.length && !stopped) {
      const start = buffer.indexOf(PNG_SIGNATURE);

      if (start === -1) {
        return buffer.subarray(Math.max(0, buffer.length - PNG_SIGNATURE.length));
      }

      if (start > 0) {
        buffer = buffer.subarray(start);
      }

      const frameEnd = findPngFrameEnd(buffer, 0);

      if (frameEnd === -1) {
        break;
      }

      const frame = fixAdbPngBuffer(buffer.subarray(0, frameEnd));

      if (isValidPng(frame)) {
        const dimensions = readPngDimensions(frame);
        const streamSize = dimensions
          ? computeStreamSize(dimensions.width, dimensions.height)
          : displaySize;
        emitFrame(frame, dimensions ? streamSize : undefined);
      }

      buffer = buffer.subarray(frameEnd);
    }

    return buffer;
  };

  const stopCaptureProcess = () => {
    if (captureProcess && !captureProcess.killed) {
      captureProcess.kill('SIGTERM');
      captureProcess = null;
    }

    if (captureTimer) {
      clearTimeout(captureTimer);
      captureTimer = null;
    }
  };

  const pauseCapture = async (): Promise<void> => {
    capturePaused = true;
    stopCaptureProcess();

    const deadline = Date.now() + INPUT_CAPTURE_IDLE_TIMEOUT_MS;

    while (captureInFlight && Date.now() < deadline) {
      await delay(INPUT_CAPTURE_POLL_MS);
    }
  };

  const resumeCapture = (): void => {
    if (stopped || capturePaused) {
      return;
    }

    if (!captureProcess && !captureTimer) {
      startPollingCapture(captureMode === 'raw');
    }
  };

  const withInputGate = async <T>(fn: () => Promise<T>): Promise<T> => {
    let release!: () => void;
    const previous = inputGate;
    inputGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    try {
      await pauseCapture();
      const result = await fn();
      return result;
    } catch (error) {
      throw error;
    } finally {
      capturePaused = false;
      triggerBurstCapture();
      resumeCapture();
      release();
    }
  };

  const switchCaptureMode = (useRaw: boolean) => {
    if (stopped) {
      return;
    }

    const nextMode = useRaw ? 'raw' : 'png';

    if (captureMode === nextMode && captureProcess) {
      return;
    }

    captureMode = nextMode;
    stopCaptureProcess();
    startPersistentCapture(useRaw);
  };

  const startPersistentCapture = (useRaw: boolean) => {
    const command = useRaw ? 'while true; do screencap; done' : 'while true; do screencap -p; done';
    captureProcess = spawn(
      adbTool.path,
      ['-s', serial, 'exec-out', 'sh', '-c', command],
      {
        env: process.env,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );

    let leftover = Buffer.alloc(0);

    captureProcess.stdout?.on('data', (chunk: Buffer) => {
      if (stopped) {
        return;
      }

      leftover = Buffer.concat([leftover, chunk]);
      leftover = useRaw ? processRawBuffer(leftover) : processPngBuffer(leftover);

      if (leftover.length > 16 * 1024 * 1024) {
        leftover = leftover.subarray(leftover.length - PNG_SIGNATURE.length);
      }
    });

    captureProcess.on('close', () => {
      captureProcess = null;

      if (!stopped && !capturePaused && !captureTimer) {
        if (captureMode === 'raw') {
          switchCaptureMode(false);
          return;
        }

        startPollingCapture(useRaw);
      }
    });

    captureProcess.on('error', () => {
      captureProcess = null;

      if (!stopped && !capturePaused && !captureTimer) {
        if (captureMode === 'raw') {
          switchCaptureMode(false);
          return;
        }

        startPollingCapture(useRaw);
      }
    });
  };

  const captureSingleFrame = async (useRaw: boolean): Promise<void> => {
    if (stopped || !serial || captureInFlight || capturePaused) {
      return;
    }

    captureInFlight = true;

    try {
      const args = useRaw
        ? ['-s', serial, 'exec-out', 'screencap']
        : ['-s', serial, 'exec-out', 'screencap', '-p'];

      const frame = await new Promise<Buffer | null>((resolve) => {
        const chunks: Buffer[] = [];
        const child = spawn(adbTool.path, args, { env: process.env });
        child.stdout.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        child.on('close', () => {
          if (!chunks.length) {
            resolve(null);
            return;
          }

          resolve(Buffer.concat(chunks));
        });
        child.on('error', () => {
          resolve(null);
        });
      });

      if (!frame || stopped) {
        return;
      }

      if (useRaw) {
        const header = parseRawFrameHeader(frame, 0);

        if (!header) {
          return;
        }

        const pixels = frame.subarray(header.headerSize, header.frameSize);
        const encoded = encodeScaledRawFrame(header.width, header.height, pixels);
        emitFrame(encoded.png, { width: encoded.width, height: encoded.height });
        return;
      }

      const png = fixAdbPngBuffer(frame);

      if (isValidPng(png)) {
        const dimensions = readPngDimensions(png);
        const streamSize = dimensions
          ? computeStreamSize(dimensions.width, dimensions.height)
          : displaySize;
        emitFrame(png, dimensions ? streamSize : undefined);
      }
    } finally {
      captureInFlight = false;
    }
  };

  const startPollingCapture = (useRaw: boolean) => {
    const scheduleCapture = () => {
      if (stopped) {
        return;
      }

      captureTimer = setTimeout(() => {
        void captureSingleFrame(useRaw).finally(() => {
          scheduleCapture();
        });
      }, getFrameInterval());
    };

    void captureSingleFrame(useRaw).finally(() => {
      scheduleCapture();
    });
  };

  captureWatchdog = setTimeout(() => {
    captureWatchdog = null;

    if (!stopped && framesEmitted === 0) {
      captureMode = 'png';
      stopCaptureProcess();
      startPollingCapture(false);
    }
  }, 3000);

  captureMode = 'raw';
  startPollingCapture(true);

  return {
    async stop() {
      stopped = true;

      if (statsTimer) {
        clearInterval(statsTimer);
        statsTimer = null;
      }

      if (captureWatchdog) {
        clearTimeout(captureWatchdog);
        captureWatchdog = null;
      }

      if (pendingEmitTimer) {
        clearTimeout(pendingEmitTimer);
        pendingEmitTimer = null;
      }

      if (captureTimer) {
        clearTimeout(captureTimer);
        captureTimer = null;
      }

      if (captureProcess && !captureProcess.killed) {
        captureProcess.kill('SIGTERM');
        captureProcess = null;
      }

      destroyInputShell();

      if (emulatorProcess && !emulatorProcess.killed) {
        emulatorProcess.kill('SIGTERM');
        emulatorProcess = null;
      }

      if (serial) {
        await resetDisplayOverrides(adbTool.path, serial);
      }

      events.onState('stopped');
    },
    async tap(x, y) {
      if (!serial) {
        return;
      }

      await withInputGate(async () => {
        const px = Math.round(x * inputSize.width);
        const py = Math.round(y * inputSize.height);
        sendShellCommand(`input tap ${px} ${py}`);
      });
    },
    async swipe(x1, y1, x2, y2, durationMs) {
      if (!serial) {
        return;
      }

      await withInputGate(async () => {
        const startX = Math.round(x1 * inputSize.width);
        const startY = Math.round(y1 * inputSize.height);
        const endX = Math.round(x2 * inputSize.width);
        const endY = Math.round(y2 * inputSize.height);
        sendShellCommand(
          `input swipe ${startX} ${startY} ${endX} ${endY} ${Math.max(durationMs, 50)}`,
        );
      });
    },
    async pressHome() {
      if (!serial) {
        return;
      }

      await withInputGate(async () => {
        sendShellCommand(`input keyevent ${KEYCODE_WAKEUP}`);
        await delay(40);
        sendShellCommand('wm dismiss-keyguard');
        await delay(40);
        sendShellCommand(`input keyevent ${KEYCODE_HOME}`);
        await delay(120);
        sendShellCommand(`input keyevent ${KEYCODE_HOME}`);
        await delay(120);
        sendShellCommand(
          'am start -a android.intent.action.MAIN -c android.intent.category.HOME',
        );
      });
    },
    async pressBack() {
      if (!serial) {
        return;
      }

      await withInputGate(async () => {
        sendShellCommand(`input keyevent ${KEYCODE_BACK}`);
      });
    },
    async rotate() {
      if (!serial) {
        return;
      }

      await withInputGate(async () => {
        isLandscape = !isLandscape;
        await runAdbWithRetry(
          adbTool.path,
          ['shell', 'settings', 'put', 'system', 'user_rotation', isLandscape ? '1' : '0'],
          serial,
          1,
        );
        inputSize = { width: inputSize.height, height: inputSize.width };
        displaySize = { width: displaySize.height, height: displaySize.width };
        lastFrameHash = 0;
      });
    },
    async typeText(text: string) {
      if (!serial || !text) {
        return;
      }

      await withInputGate(async () => {
        let buffer = '';

        const flushBuffer = () => {
          if (!buffer) {
            return;
          }

          sendShellCommand(`input text ${encodeAndroidInputText(buffer)}`);
          buffer = '';
        };

        for (const char of text) {
          if (char === '\n' || char === '\r') {
            flushBuffer();
            sendShellCommand(`input keyevent ${KEYCODE_ENTER}`);
            continue;
          }

          if (char === '\b') {
            flushBuffer();
            sendShellCommand(`input keyevent ${KEYCODE_DEL}`);
            continue;
          }

          buffer += char;
        }

        flushBuffer();
        triggerBurstCapture();
      });
    },
    async takeScreenshot(outputPath: string) {
      if (!serial) {
        return;
      }

      const frame = await new Promise<Buffer | null>((resolve) => {
        const chunks: Buffer[] = [];
        const child = spawn(adbTool.path, ['-s', serial, 'exec-out', 'screencap', '-p'], {
          env: process.env,
        });
        child.stdout.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        child.on('close', () => {
          if (!chunks.length) {
            resolve(null);
            return;
          }

          resolve(Buffer.concat(chunks));
        });
        child.on('error', () => {
          resolve(null);
        });
      });

      if (!frame) {
        return;
      }

      const png = fixAdbPngBuffer(frame);

      if (isValidPng(png)) {
        await writeFile(outputPath, png);
      }
    },
  };
}
