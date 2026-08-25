import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app, powerMonitor, session } from 'electron';

const MARKER_FILE = 'browser-cache-day.json';
const CHECK_INTERVAL_MS = 60_000;

interface MarkerFile {
  dayKey: string;
}

let checkTimer: ReturnType<typeof setInterval> | null = null;
let sweepInFlight = false;

function formatLocalDayKey(timestampMs: number): string {
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMarkerPath(): string {
  return path.join(app.getPath('userData'), MARKER_FILE);
}

function getPartitionsDir(): string {
  return path.join(app.getPath('userData'), 'Partitions');
}

function isBrowserPartitionDir(name: string): boolean {
  return name.startsWith('nexus-browser-') || name === 'nexus-sidebar-youtube';
}

function readStoredDayKey(): string | null {
  try {
    const raw = JSON.parse(readFileSync(getMarkerPath(), 'utf8')) as MarkerFile;
    return typeof raw.dayKey === 'string' && raw.dayKey.length > 0 ? raw.dayKey : null;
  } catch {
    return null;
  }
}

function writeStoredDayKey(dayKey: string): void {
  try {
    writeFileSync(getMarkerPath(), JSON.stringify({ dayKey }));
  } catch {
  }
}

function listBrowserPartitionDirs(): string[] {
  const dir = getPartitionsDir();

  if (!existsSync(dir)) {
    return [];
  }

  try {
    return readdirSync(dir).filter(isBrowserPartitionDir);
  } catch {
    return [];
  }
}

function deleteBrowserPartitionDirs(): void {
  const root = getPartitionsDir();

  for (const name of listBrowserPartitionDirs()) {
    try {
      rmSync(path.join(root, name), { recursive: true, force: true });
    } catch {
    }
  }
}

async function clearLiveBrowserSessions(): Promise<void> {
  const names = new Set(listBrowserPartitionDirs());
  names.add('nexus-sidebar-youtube');

  for (const name of names) {
    try {
      const browserSession = session.fromPartition(`persist:${name}`);
      await browserSession.clearCache();
      await browserSession.clearStorageData();
    } catch {
    }
  }
}

async function sweepBrowserDayCache(deleteDirs: boolean): Promise<void> {
  if (sweepInFlight) {
    return;
  }

  sweepInFlight = true;

  try {
    const today = formatLocalDayKey(Date.now());

    if (readStoredDayKey() === today) {
      return;
    }

    if (deleteDirs) {
      deleteBrowserPartitionDirs();
    } else {
      await clearLiveBrowserSessions();
    }

    writeStoredDayKey(today);
  } finally {
    sweepInFlight = false;
  }
}

function onPowerResume(): void {
  void sweepBrowserDayCache(false);
}

export function pruneBrowserDayCacheOnBoot(): void {
  const today = formatLocalDayKey(Date.now());

  if (readStoredDayKey() === today) {
    return;
  }

  deleteBrowserPartitionDirs();
  writeStoredDayKey(today);
}

export function startBrowserDayCacheWatch(): void {
  if (checkTimer) {
    return;
  }

  void sweepBrowserDayCache(false);
  checkTimer = setInterval(() => {
    void sweepBrowserDayCache(false);
  }, CHECK_INTERVAL_MS);
  powerMonitor.removeListener('resume', onPowerResume);
  powerMonitor.on('resume', onPowerResume);
}

export function stopBrowserDayCacheWatch(): void {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }

  powerMonitor.removeListener('resume', onPowerResume);
}
