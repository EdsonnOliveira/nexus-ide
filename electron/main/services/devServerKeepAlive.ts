import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCliPathEnv } from '../utils/cliPathEnv';

const SPAWN_COOLDOWN_MS = 45_000;
const SUPERVISOR_PATTERN = 'scripts/dev-supervisor.mjs';

let child: ChildProcess | null = null;
let lastSpawnAt = 0;
let stopping = false;

function isChildAlive(current: ChildProcess | null): boolean {
  return Boolean(current && current.exitCode === null && current.signalCode === null);
}

function resolveNvmNode(appRoot: string): string | null {
  const nvmrcPath = path.join(appRoot, '.nvmrc');
  let version = '22.14.0';

  if (existsSync(nvmrcPath)) {
    const raw = readFileSync(nvmrcPath, 'utf8').trim().replace(/^v/i, '');

    if (raw) {
      version = raw;
    }
  }

  const candidate = path.join(os.homedir(), '.nvm', 'versions', 'node', `v${version}`, 'bin', 'node');
  return existsSync(candidate) ? candidate : null;
}

function resolveNodeBinary(appRoot: string, env: NodeJS.ProcessEnv): string | null {
  const nvmNode = resolveNvmNode(appRoot);
  const candidates = [
    env.npm_node_execpath,
    env.NODE_BINARY,
    env.NVM_BIN ? path.join(env.NVM_BIN, 'node') : '',
    nvmNode ?? '',
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  try {
    const resolved = execFileSync('/usr/bin/which', ['node'], {
      encoding: 'utf8',
      env,
    }).trim();

    if (resolved && existsSync(resolved)) {
      return resolved;
    }
  } catch {
  }

  return null;
}

function isSupervisorRunning(): boolean {
  if (process.platform === 'win32') {
    return false;
  }

  try {
    const result = execFileSync('/usr/bin/pgrep', ['-f', SUPERVISOR_PATTERN], {
      encoding: 'utf8',
    }).trim();
    return Boolean(result);
  } catch {
    return false;
  }
}

export function ensureDevServerRunning(
  appRoot: string,
  log: (message: string, extra?: unknown) => void,
): void {
  if (stopping || isChildAlive(child) || isSupervisorRunning()) {
    return;
  }

  if (Date.now() - lastSpawnAt < SPAWN_COOLDOWN_MS) {
    return;
  }

  const supervisor = path.join(appRoot, SUPERVISOR_PATTERN);

  if (!existsSync(supervisor)) {
    log('dev keep-alive skipped — supervisor missing');
    return;
  }

  const nvmNode = resolveNvmNode(appRoot);
  const pathEnv = nvmNode
    ? `${path.dirname(nvmNode)}${path.delimiter}${buildCliPathEnv(process.env.PATH)}`
    : buildCliPathEnv(process.env.PATH);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: pathEnv,
    NODE_OPTIONS: undefined,
  };
  const nodeBinary = resolveNodeBinary(appRoot, env);

  if (!nodeBinary) {
    log('dev keep-alive skipped — node not found');
    return;
  }

  lastSpawnAt = Date.now();
  log('dev keep-alive starting vite', nodeBinary);

  const next = spawn(nodeBinary, [supervisor], {
    cwd: appRoot,
    env,
    stdio: 'ignore',
  });

  child = next;

  next.on('error', (error: Error) => {
    log('dev keep-alive spawn failed', String(error));

    if (child === next) {
      child = null;
    }
  });

  next.on('exit', (code, signal) => {
    log('dev keep-alive supervisor exited', { code, signal });

    if (child === next) {
      child = null;
    }
  });
}

export function stopEnsuredDevServer(): void {
  stopping = true;

  if (!child) {
    return;
  }

  const current = child;
  child = null;

  try {
    current.kill('SIGINT');
  } catch {
  }

  setTimeout(() => {
    if (current.exitCode !== null || current.signalCode !== null) {
      return;
    }

    try {
      current.kill('SIGKILL');
    } catch {
    }
  }, 1500);
}
