import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';

const DEFAULT_SOCKET = path.join(os.homedir(), '.nexus-runtime.sock');
const RUNTIME_STATE_DIR = path.join(os.homedir(), '.nexus', 'runtime');
const MANAGED_PID_FILE = path.join(RUNTIME_STATE_DIR, 'desktop-managed.pid');
const RESTART_BASE_MS = 1_000;
const RESTART_MAX_MS = 30_000;

const RUNTIME_ENV_KEYS = [
  'VITE_SUPABASE_URL',
  'SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXUS_RUNTIME_EMAIL',
  'NEXUS_RUNTIME_PASSWORD',
  'NEXUS_DEVICE_NAME',
  'NEXUS_PAIRING_CODE',
  'NEXUS_RUNTIME_SOCKET',
  'NEXUS_DESKTOP_SOCKET',
  'NEXUS_SUPABASE_PROJECT_REF',
] as const;

let child: ChildProcess | null = null;
let stopping = false;
let restartAttempt = 0;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let healthyTimer: ReturnType<typeof setTimeout> | null = null;
let startedBySupervisor = false;

function getSocketPath(): string {
  return process.env.NEXUS_RUNTIME_SOCKET ?? DEFAULT_SOCKET;
}

function getProjectRoot(): string {
  return process.env.APP_ROOT ?? app.getAppPath();
}

function stripEnvValueQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function readEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    return {};
  }

  const result: Record<string, string> = {};
  const content = readFileSync(filePath, 'utf8');

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const value = stripEnvValueQuotes(trimmed.slice(eq + 1).trim());
    if (key) {
      result[key] = value;
    }
  }

  return result;
}

function collectRuntimeEnvFiles(): string[] {
  const projectRoot = getProjectRoot();
  const homeNexus = path.join(os.homedir(), '.nexus');
  return [
    path.join(projectRoot, '.env'),
    path.join(projectRoot, '.env.local'),
    path.join(homeNexus, '.env'),
    path.join(homeNexus, '.env.local'),
  ];
}

function resolveRuntimeEnv(): NodeJS.ProcessEnv {
  const merged: Record<string, string> = {};

  for (const filePath of collectRuntimeEnvFiles()) {
    Object.assign(merged, readEnvFile(filePath));
  }

  const env: NodeJS.ProcessEnv = { ...process.env };

  for (const key of RUNTIME_ENV_KEYS) {
    const fromFile = merged[key];
    if (fromFile && !env[key]) {
      env[key] = fromFile;
    }
  }

  env.NEXUS_RUNTIME_SOCKET = getSocketPath();
  return env;
}

function listSocketPids(socketPath: string): number[] {
  if (!existsSync(socketPath)) {
    return [];
  }

  try {
    const output = execFileSync('lsof', ['-t', socketPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output
      .split(/\s+/)
      .map((value) => Number(value.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  } catch {
    return [];
  }
}

function readManagedPid(): number | null {
  try {
    if (!existsSync(MANAGED_PID_FILE)) {
      return null;
    }
    const pid = Number(readFileSync(MANAGED_PID_FILE, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function writeManagedPid(pid: number): void {
  mkdirSync(RUNTIME_STATE_DIR, { recursive: true });
  writeFileSync(MANAGED_PID_FILE, String(pid), 'utf8');
}

function clearManagedPid(): void {
  try {
    unlinkSync(MANAGED_PID_FILE);
  } catch {
  }
}

function killPid(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
  }

  const forceTimer = setTimeout(() => {
    try {
      process.kill(pid, 0);
      process.kill(pid, 'SIGKILL');
    } catch {
    }
  }, 400);
  forceTimer.unref?.();
}

function clearSocketFile(socketPath: string): void {
  try {
    if (existsSync(socketPath)) {
      unlinkSync(socketPath);
    }
  } catch {
  }
}

function replaceExistingRuntime(): void {
  const socketPath = getSocketPath();
  const pids = new Set<number>(listSocketPids(socketPath));
  const managedPid = readManagedPid();
  if (managedPid) {
    pids.add(managedPid);
  }

  for (const pid of pids) {
    if (pid === process.pid) {
      continue;
    }
    console.log(`[cloud-runtime] stopping existing runtime pid=${pid}`);
    killPid(pid);
  }

  clearSocketFile(socketPath);
  clearManagedPid();
}

function resolvePackagedRuntimeEntry(): string | null {
  const candidates = [
    path.join(process.resourcesPath, 'runtime', 'index.cjs'),
    path.join(getProjectRoot(), 'dist-runtime', 'index.cjs'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveDevRuntimeLaunch(): { command: string; args: string[]; cwd: string } | null {
  const projectRoot = getProjectRoot();
  const entry = path.join(projectRoot, 'apps/runtime/src/index.ts');
  const tsxBin = path.join(projectRoot, 'node_modules/.bin/tsx');

  if (!existsSync(entry) || !existsSync(tsxBin)) {
    return null;
  }

  return {
    command: tsxBin,
    args: [entry],
    cwd: projectRoot,
  };
}

function resolveRuntimeLaunch(): {
  command: string;
  args: string[];
  cwd: string;
  envExtras: Record<string, string>;
} | null {
  if (!app.isPackaged) {
    const launch = resolveDevRuntimeLaunch();
    if (!launch) {
      return null;
    }
    return { ...launch, envExtras: {} };
  }

  const entry = resolvePackagedRuntimeEntry();
  if (!entry) {
    const fallback = resolveDevRuntimeLaunch();
    if (fallback) {
      return { ...fallback, envExtras: {} };
    }
    return null;
  }

  const runtimeDir = path.dirname(entry);
  const nodePathParts = [
    path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules'),
    path.join(process.resourcesPath, 'app.asar.unpacked'),
  ];

  return {
    command: process.execPath,
    args: [entry],
    cwd: runtimeDir,
    envExtras: {
      ELECTRON_RUN_AS_NODE: '1',
      NODE_PATH: nodePathParts.join(path.delimiter),
    },
  };
}

function scheduleRestart(): void {
  if (stopping || restartTimer) {
    return;
  }

  const delay = Math.min(RESTART_BASE_MS * 2 ** restartAttempt, RESTART_MAX_MS);
  restartAttempt += 1;
  console.warn(`[cloud-runtime] restarting in ${delay}ms (attempt ${restartAttempt})`);

  restartTimer = setTimeout(() => {
    restartTimer = null;
    startManagedRuntime();
  }, delay);
}

function clearRestartTimer(): void {
  if (!restartTimer) {
    return;
  }
  clearTimeout(restartTimer);
  restartTimer = null;
}

function clearHealthyTimer(): void {
  if (!healthyTimer) {
    return;
  }
  clearTimeout(healthyTimer);
  healthyTimer = null;
}

function markLaunchHealthySoon(): void {
  clearHealthyTimer();
  healthyTimer = setTimeout(() => {
    healthyTimer = null;
    restartAttempt = 0;
  }, 10_000);
}

function pipeChildOutput(stream: NodeJS.ReadableStream | null, label: 'out' | 'err'): void {
  if (!stream) {
    return;
  }

  let buffer = '';
  stream.on('data', (chunk: Buffer | string) => {
    buffer += chunk.toString();
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      if (line) {
        if (label === 'err') {
          console.error(`[cloud-runtime] ${line}`);
        } else {
          console.log(`[cloud-runtime] ${line}`);
        }
      }
      newline = buffer.indexOf('\n');
    }
  });
}

export function startManagedRuntime(): void {
  stopping = false;
  clearRestartTimer();

  if (child && !child.killed) {
    return;
  }

  const launch = resolveRuntimeLaunch();
  if (!launch) {
    console.error('[cloud-runtime] runtime entry not found — cloud presence disabled');
    return;
  }

  replaceExistingRuntime();

  const env = {
    ...resolveRuntimeEnv(),
    ...launch.envExtras,
  };

  console.log(`[cloud-runtime] starting ${launch.command} ${launch.args.join(' ')}`);

  const next = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child = next;
  startedBySupervisor = true;

  if (typeof next.pid === 'number' && next.pid > 0) {
    writeManagedPid(next.pid);
  }

  pipeChildOutput(next.stdout, 'out');
  pipeChildOutput(next.stderr, 'err');

  next.on('exit', (code, signal) => {
    if (child === next) {
      child = null;
    }
    clearHealthyTimer();
    clearManagedPid();
    console.warn(`[cloud-runtime] exited code=${code} signal=${signal ?? 'none'}`);

    if (stopping || !startedBySupervisor) {
      return;
    }

    scheduleRestart();
  });

  next.on('error', (error) => {
    console.error('[cloud-runtime] spawn failed', error);
    if (child === next) {
      child = null;
    }
    clearHealthyTimer();
    clearManagedPid();
    if (!stopping && startedBySupervisor) {
      scheduleRestart();
    }
  });

  markLaunchHealthySoon();
}

export function stopManagedRuntime(): void {
  stopping = true;
  startedBySupervisor = false;
  clearRestartTimer();
  clearHealthyTimer();

  const current = child;
  child = null;

  if (current && !current.killed) {
    try {
      current.kill('SIGTERM');
    } catch {
    }

    const killTimer = setTimeout(() => {
      if (!current.killed) {
        try {
          current.kill('SIGKILL');
        } catch {
        }
      }
    }, 2000);
    killTimer.unref?.();
  }

  const managedPid = readManagedPid();
  if (managedPid) {
    killPid(managedPid);
  }

  clearSocketFile(getSocketPath());
  clearManagedPid();
}

export function isManagedRuntimeRunning(): boolean {
  return Boolean(child && !child.killed);
}
