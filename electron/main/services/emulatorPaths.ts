import { app } from 'electron';
import { accessSync, constants, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

export interface ResolvedTool {
  path: string;
  found: boolean;
}

function canExecute(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function getExecutableSearchPaths(): string[] {
  const paths = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const home = process.env.HOME ?? '';
  const extras = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    home ? path.join(home, '.local', 'bin') : '',
  ].filter(Boolean);

  return [...new Set([...paths, ...extras])];
}

function resolveFromPath(command: string): ResolvedTool {
  const segments = getExecutableSearchPaths();

  for (const segment of segments) {
    const candidate = path.join(segment, command);

    if (canExecute(candidate)) {
      return { path: candidate, found: true };
    }
  }

  return { path: command, found: false };
}

function resolveFromCandidates(candidates: string[]): ResolvedTool {
  for (const candidate of candidates) {
    if (canExecute(candidate)) {
      return { path: candidate, found: true };
    }
  }

  return { path: candidates[0] ?? '', found: false };
}

function resolvePipUserIdb(): ResolvedTool {
  const home = process.env.HOME ?? '';
  const pythonLibrary = path.join(home, 'Library', 'Python');

  try {
    for (const version of readdirSync(pythonLibrary)) {
      const candidate = path.join(pythonLibrary, version, 'bin', 'idb');

      if (canExecute(candidate)) {
        return { path: candidate, found: true };
      }
    }
  } catch {
    return { path: 'idb', found: false };
  }

  return { path: 'idb', found: false };
}

function resolveViaLoginShell(command: string): ResolvedTool {
  try {
    const resolved = execSync(`/bin/bash -lc 'command -v ${command}'`, {
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();

    if (resolved && canExecute(resolved)) {
      return { path: resolved, found: true };
    }
  } catch {
    return { path: command, found: false };
  }

  return { path: command, found: false };
}

function resolveAndroidSdkRoot(): string | null {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(process.env.HOME ?? '', 'Library', 'Android', 'sdk'),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.R_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

export function resolveAdbPath(): ResolvedTool {
  const sdkRoot = resolveAndroidSdkRoot();

  if (sdkRoot) {
    const platformTool = path.join(sdkRoot, 'platform-tools', 'adb');

    if (canExecute(platformTool)) {
      return { path: platformTool, found: true };
    }
  }

  return resolveFromPath('adb');
}

export function resolveEmulatorPath(): ResolvedTool {
  const sdkRoot = resolveAndroidSdkRoot();

  if (sdkRoot) {
    const emulatorBin = path.join(sdkRoot, 'emulator', 'emulator');

    if (canExecute(emulatorBin)) {
      return { path: emulatorBin, found: true };
    }
  }

  return resolveFromPath('emulator');
}

export function resolveXcrunPath(): ResolvedTool {
  return resolveFromPath('xcrun');
}

export function resolveIdbPath(): ResolvedTool {
  const fromPath = resolveFromPath('idb');

  if (fromPath.found) {
    return fromPath;
  }

  const pipUser = resolvePipUserIdb();

  if (pipUser.found) {
    return pipUser;
  }

  return resolveViaLoginShell('idb');
}

export function resolveIdbCompanionPath(): ResolvedTool {
  const home = process.env.HOME ?? '';
  const customCandidates = [
    process.env.IDB_COMPANION_PATH,
    home ? path.join(home, '.local', 'idb-companion-dist', 'idb_companion') : '',
  ].filter((value): value is string => Boolean(value));

  const custom = resolveFromCandidates(customCandidates);

  if (custom.found) {
    return custom;
  }

  const fromPath = resolveFromPath('idb_companion');

  if (fromPath.found) {
    return fromPath;
  }

  return resolveFromCandidates([
    '/opt/homebrew/opt/idb-companion/bin/idb_companion',
    '/usr/local/opt/idb-companion/bin/idb_companion',
    '/opt/homebrew/bin/idb_companion',
    '/usr/local/bin/idb_companion',
  ]);
}

export function resolveOpenPath(): ResolvedTool {
  return resolveFromPath('open');
}

export function resolveSimulatorServerPath(): ResolvedTool {
  if (process.platform !== 'darwin') {
    return { path: 'simulator-server', found: false };
  }

  const binaryName = 'simulator-server';
  const candidates = [
    path.join(process.cwd(), 'resources/simulator-server/darwin', binaryName),
    path.join(app.getAppPath(), 'resources/simulator-server/darwin', binaryName),
    path.join(
      process.resourcesPath,
      'app.asar.unpacked/resources/simulator-server/darwin',
      binaryName,
    ),
    path.join(process.resourcesPath, 'resources/simulator-server/darwin', binaryName),
  ];

  return resolveFromCandidates(candidates);
}

export function hasAndroidSdkRoot(): boolean {
  return resolveAndroidSdkRoot() !== null;
}
