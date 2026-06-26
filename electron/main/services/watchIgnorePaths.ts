import path from 'node:path';

const IGNORED_WATCH_SEGMENTS = new Set([
  '.git',
  '.hg',
  '.nexus',
  '.svn',
  '.next',
  '.turbo',
  '.cache',
  '.idea',
  '.vscode',
  '__pycache__',
  'coverage',
  'dist',
  'dist-electron',
  'node_modules',
  'release',
]);

export function shouldIgnoreWatchPath(projectPath: string, changedPath?: string): boolean {
  if (!changedPath) {
    return false;
  }

  const relative = path.relative(projectPath, changedPath).replace(/\\/g, '/');

  if (!relative || relative.startsWith('..')) {
    return true;
  }

  return relative.split('/').some((segment) => IGNORED_WATCH_SEGMENTS.has(segment));
}
