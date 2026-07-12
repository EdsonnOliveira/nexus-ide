import path from 'node:path';

const IGNORED_WATCH_SEGMENTS = new Set([
  '.android',
  '.cache',
  '.cxx',
  '.expo',
  '.git',
  '.gradle',
  '.hg',
  '.idea',
  '.kotlin',
  '.next',
  '.nexus',
  '.nuxt',
  '.output',
  '.parcel-cache',
  '.svn',
  '.temp',
  '.terraform',
  '.turbo',
  '.vercel',
  '.vscode',
  '__pycache__',
  'DerivedData',
  'Pods',
  'build',
  'coverage',
  'dist',
  'dist-electron',
  'intermediates',
  'liquid-glass-out',
  'node_modules',
  'out',
  'release',
  'target',
  'temp',
  'tmp',
  'xcuserdata',
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
