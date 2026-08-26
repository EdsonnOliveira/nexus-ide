import { app } from 'electron';
import { accessSync, constants, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

export interface ResolvedTool {
  path: string;
  found: boolean;
}

function homeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function hostBinary(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function canExecute(filePath: string): boolean {
  if (!filePath) {
    return false;
  }

  try {
    if (!statSync(filePath).isFile()) {
      return false;
    }

    if (process.platform === 'win32') {
      return true;
    }

    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function getExecutableSearchPaths(): string[] {
  const paths = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const home = homeDir();
  const extras =
    process.platform === 'win32'
      ? [
          process.env.LOCALAPPDATA
            ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools')
            : '',
          process.env.LOCALAPPDATA
            ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'emulator')
            : '',
          home ? path.join(home, '.cursor', 'bin') : '',
          home ? path.join(home, '.local', 'bin') : '',
        ]
      : ['/opt/homebrew/bin', '/usr/local/bin', home ? path.join(home, '.local', 'bin') : ''];

  return [...new Set([...paths, ...extras.filter(Boolean)])];
}

function commandNames(command: string): string[] {
  if (process.platform !== 'win32' || command.endsWith('.exe') || command.endsWith('.cmd')) {
    return [command];
  }

  return [hostBinary(command), `${command}.cmd`, command];
}

function resolveFromPath(command: string): ResolvedTool {
  const segments = getExecutableSearchPaths();

  for (const segment of segments) {
    for (const name of commandNames(command)) {
      const candidate = path.join(segment, name);

      if (canExecute(candidate)) {
        return { path: candidate, found: true };
      }
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
  const home = homeDir();
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
  if (process.platform !== 'darwin') {
    return { path: command, found: false };
  }

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
  const home = homeDir();
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.platform === 'win32' && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')
      : '',
    process.platform === 'darwin' ? path.join(home, 'Library', 'Android', 'sdk') : '',
    process.platform === 'linux' ? path.join(home, 'Android', 'Sdk') : '',
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
    const platformTool = path.join(sdkRoot, 'platform-tools', hostBinary('adb'));

    if (canExecute(platformTool)) {
      return { path: platformTool, found: true };
    }
  }

  return resolveFromPath('adb');
}

export function resolveEmulatorPath(): ResolvedTool {
  const sdkRoot = resolveAndroidSdkRoot();

  if (sdkRoot) {
    const emulatorBin = path.join(sdkRoot, 'emulator', hostBinary('emulator'));

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
  const home = homeDir();
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
