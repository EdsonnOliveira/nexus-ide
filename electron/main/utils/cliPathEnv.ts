import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';

function getCliPathSegments(home: string): string[] {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? '';
    const appData = process.env.APPDATA ?? '';

    return [
      path.join(home, 'bin'),
      path.join(home, '.local', 'bin'),
      path.join(home, '.cursor', 'bin'),
      localAppData ? path.join(localAppData, 'Programs', 'cursor') : '',
      appData ? path.join(appData, 'npm') : '',
      localAppData ? path.join(localAppData, 'Android', 'Sdk', 'platform-tools') : '',
      localAppData ? path.join(localAppData, 'Android', 'Sdk', 'emulator') : '',
    ].filter(Boolean);
  }

  return [
    path.join(home, 'bin'),
    path.join(home, '.local', 'bin'),
    path.join(home, '.cursor', 'bin'),
    path.join(home, '.antigravity', 'antigravity', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];
}

export function buildCliPathEnv(basePath?: string): string {
  const home = os.homedir();
  const segments = new Set<string>();

  for (const segment of (basePath ?? process.env.PATH ?? '').split(path.delimiter)) {
    if (segment) {
      segments.add(segment);
    }
  }

  try {
    segments.add(path.join(app.getPath('userData'), 'mission-bridge'));
  } catch {
  }

  for (const segment of getCliPathSegments(home)) {
    segments.add(segment);
  }

  return Array.from(segments).join(path.delimiter);
}
