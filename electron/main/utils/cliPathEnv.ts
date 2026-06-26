import os from 'node:os';
import path from 'node:path';

function getCliPathSegments(home: string): string[] {
  return [
    path.join(home, '.local', 'bin'),
    path.join(home, '.cursor', 'bin'),
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

  for (const segment of (basePath ?? process.env.PATH ?? '').split(':')) {
    if (segment) {
      segments.add(segment);
    }
  }

  for (const segment of getCliPathSegments(home)) {
    segments.add(segment);
  }

  return Array.from(segments).join(':');
}
