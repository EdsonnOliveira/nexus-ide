import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface DirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

const IGNORED_DIRECTORY_NAMES = new Set([
  '.cxx',
  '.expo',
  '.git',
  '.gradle',
  '.hg',
  '.kotlin',
  '.nexus',
  '.svn',
  '__pycache__',
  'DerivedData',
  'Pods',
  'coverage',
  'dist',
  'dist-electron',
  'node_modules',
  'release',
]);

function shouldSkipEntry(name: string): boolean {
  return IGNORED_DIRECTORY_NAMES.has(name);
}

export function listDirectoryEntries(dirPath: string): DirectoryEntry[] {
  if (!dirPath || !existsSync(dirPath)) {
    return [];
  }

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => !shouldSkipEntry(entry.name))
      .map((entry) => ({
        name: entry.name,
        path: path.join(dirPath, entry.name),
        type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
      }))
      .sort((left, right) => {
        if (left.type !== right.type) {
          return left.type === 'directory' ? -1 : 1;
        }

        return left.name.localeCompare(right.name);
      });

    return entries;
  } catch {
    return [];
  }
}

export function listChildDirectories(dirPath: string): string[] {
  if (!dirPath || !existsSync(dirPath)) {
    return [];
  }

  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

export function resolveDirectoryPath(dirPath: string): string {
  return path.resolve(dirPath);
}

export function resolveCdPath(cwd: string, target: string): string {
  const normalizedTarget = target.trim();

  if (!normalizedTarget || normalizedTarget === '.') {
    return resolveDirectoryPath(cwd);
  }

  if (normalizedTarget === '~') {
    return os.homedir();
  }

  if (normalizedTarget.startsWith('~/')) {
    return path.resolve(os.homedir(), normalizedTarget.slice(2));
  }

  if (path.isAbsolute(normalizedTarget)) {
    return path.resolve(normalizedTarget);
  }

  return path.resolve(cwd, normalizedTarget);
}
