import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ECHO_BUNDLE_ID = 'com.echoai.desktop';
const ECHO_OPEN_URL = 'echoai://open';
const ECHO_SOURCE_DIR = join(homedir(), 'DEV', 'SaaS', 'ECHO', 'echoai-desktop');

function resolveEchoSourceDir(): string | null {
  const fromEnv = process.env.NEXUS_ECHO_DESKTOP_PATH?.trim();
  const candidates = [fromEnv, ECHO_SOURCE_DIR].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'index.js')) && existsSync(join(candidate, 'package.json'))) {
      return candidate;
    }
  }

  return null;
}

function readBundleId(appPath: string): string | null {
  const plistPath = join(appPath, 'Contents/Info.plist');
  if (!existsSync(plistPath)) {
    return null;
  }

  try {
    return execFileSync(
      '/usr/bin/plutil',
      ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plistPath],
      { encoding: 'utf8' },
    ).trim();
  } catch {
    return null;
  }
}

function findEchoAppInDirectory(directory: string): string | null {
  if (!existsSync(directory)) {
    return null;
  }

  try {
    for (const entry of readdirSync(directory)) {
      if (!entry.endsWith('.app')) {
        continue;
      }

      const appPath = join(directory, entry);
      if (readBundleId(appPath) === ECHO_BUNDLE_ID) {
        return appPath;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function resolveEchoInstalledAppPath(): string | null {
  if (platform() !== 'darwin') {
    return null;
  }

  const candidates = [
    '/Applications/Echo.ai.app',
    join(homedir(), 'Applications', 'Echo.ai.app'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && readBundleId(candidate) === ECHO_BUNDLE_ID) {
      return candidate;
    }
  }

  return (
    findEchoAppInDirectory('/Applications') ??
    findEchoAppInDirectory(join(homedir(), 'Applications'))
  );
}

function commandLooksLikeEchoHelper(command: string): boolean {
  return /Helper/i.test(command);
}

function readMatchingPids(pattern: string): number[] {
  try {
    const stdout = execFileSync('/usr/bin/pgrep', ['-lf', pattern], {
      encoding: 'utf8',
    });
    const pids: number[] = [];

    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || commandLooksLikeEchoHelper(trimmed)) {
        continue;
      }

      const pid = Number.parseInt(trimmed, 10);
      if (Number.isFinite(pid) && pid > 0) {
        pids.push(pid);
      }
    }

    return pids;
  } catch {
    return [];
  }
}

function readEchoElectronMainPids(sourceDir: string): number[] {
  return readMatchingPids(sourceDir).filter((pid) => {
    try {
      const stdout = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], {
        encoding: 'utf8',
      }).trim();
      return (
        stdout.includes('Electron.app/Contents/MacOS/Electron') &&
        !commandLooksLikeEchoHelper(stdout)
      );
    } catch {
      return false;
    }
  });
}

function isEchoSourceRunning(sourceDir: string): boolean {
  return readEchoElectronMainPids(sourceDir).length > 0;
}

function isEchoInstalledRunning(): boolean {
  return readMatchingPids('Echo\\.ai\\.app/Contents/MacOS').length > 0;
}

async function focusProcess(pid: number): Promise<void> {
  await execFileAsync('/usr/bin/osascript', [
    '-e',
    `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`,
  ]);
}

function resolveEchoElectronBinary(sourceDir: string): string | null {
  const cliBinary = join(sourceDir, 'node_modules/.bin/electron');
  if (existsSync(cliBinary)) {
    return cliBinary;
  }

  const macBinary = join(
    sourceDir,
    'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
  );
  if (existsSync(macBinary)) {
    return macBinary;
  }

  return null;
}

function launchEchoFromSource(sourceDir: string): void {
  const electronBinary = resolveEchoElectronBinary(sourceDir);
  if (!electronBinary) {
    return;
  }

  const env = { ...process.env };
  delete env.NODE_OPTIONS;

  const child = spawn(electronBinary, ['.', ECHO_OPEN_URL], {
    cwd: sourceDir,
    detached: true,
    stdio: 'ignore',
    env,
  });

  child.unref();
}

export async function ensureEchoDesktopOpen(): Promise<void> {
  if (platform() !== 'darwin') {
    return;
  }

  const sourceDir = resolveEchoSourceDir();
  const installedApp = resolveEchoInstalledAppPath();

  if (sourceDir && isEchoSourceRunning(sourceDir)) {
    const pids = readEchoElectronMainPids(sourceDir);
    await Promise.all(pids.map((pid) => focusProcess(pid).catch(() => undefined)));
    try {
      await execFileAsync('/usr/bin/open', [ECHO_OPEN_URL]);
    } catch {
    }
    return;
  }

  if (installedApp && isEchoInstalledRunning()) {
    await execFileAsync('/usr/bin/open', ['-a', installedApp]);
    return;
  }

  if (sourceDir && resolveEchoElectronBinary(sourceDir)) {
    launchEchoFromSource(sourceDir);
    return;
  }

  if (installedApp) {
    await execFileAsync('/usr/bin/open', ['-a', installedApp]);
  }
}
