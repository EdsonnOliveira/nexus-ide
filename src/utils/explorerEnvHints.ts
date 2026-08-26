import { isEnvFilePath } from '@/utils/codeEditorLanguage';
import type { ProjectDirectoryEntry, ProjectKind } from '@/types';

export interface ExplorerEnvHint {
  id: string;
  filePath: string;
  fileName: string;
  projectDirPath: string;
  projectDirName: string;
  projectKind: ProjectKind | null;
  badgeColor: string | null;
}

export function isExplorerEnvFileName(fileName: string): boolean {
  if (!isEnvFilePath(fileName)) {
    return false;
  }

  return !fileName.endsWith('.example') && !fileName.endsWith('.sample') && !fileName.endsWith('.template');
}

export function getProjectKindBadgeLabel(kind: ProjectKind): string {
  if (kind === 'mobile') {
    return 'APP';
  }

  if (kind === 'desktop') {
    return 'DESK';
  }

  return kind.toUpperCase();
}

function envFilePriority(fileName: string): number {
  if (fileName === '.env') {
    return 0;
  }

  if (fileName === '.env.local') {
    return 1;
  }

  if (fileName === '.env.development' || fileName === '.env.development.local') {
    return 2;
  }

  if (fileName === '.env.production' || fileName === '.env.production.local') {
    return 3;
  }

  if (fileName === '.env.test' || fileName === '.env.test.local') {
    return 4;
  }

  return 10;
}

export function compareExplorerEnvFileNames(left: string, right: string): number {
  const priorityDiff = envFilePriority(left) - envFilePriority(right);

  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  return left.localeCompare(right);
}

export function collectExplorerEnvHintsFromEntries(params: {
  rootPath: string;
  rootEntries: ProjectDirectoryEntry[];
  directoryEntries: ProjectDirectoryEntry[];
  projectKinds: Record<string, ProjectKind | null>;
  badgeColorByPath: Record<string, string>;
  listedByDirectory: Record<string, ProjectDirectoryEntry[]>;
}): ExplorerEnvHint[] {
  const hints: ExplorerEnvHint[] = [];
  const seen = new Set<string>();

  const pushHint = (
    entry: ProjectDirectoryEntry,
    projectDirPath: string,
    projectDirName: string,
  ) => {
    if (entry.type !== 'file' || !isExplorerEnvFileName(entry.name) || seen.has(entry.path)) {
      return;
    }

    seen.add(entry.path);
    hints.push({
      id: entry.path,
      filePath: entry.path,
      fileName: entry.name,
      projectDirPath,
      projectDirName,
      projectKind: params.projectKinds[projectDirPath] ?? null,
      badgeColor: params.badgeColorByPath[projectDirPath] ?? null,
    });
  };

  const rootName = params.rootPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? 'projeto';
  const rootListed = params.listedByDirectory[params.rootPath] ?? params.rootEntries;

  for (const entry of rootListed) {
    pushHint(entry, params.rootPath, rootName);
  }

  for (const directory of params.directoryEntries) {
    const listed = params.listedByDirectory[directory.path] ?? [];

    for (const entry of listed) {
      pushHint(entry, directory.path, directory.name);
    }
  }

  return hints.sort((left, right) => {
    const leftDirIndex = params.directoryEntries.findIndex(
      (entry) => entry.path === left.projectDirPath,
    );
    const rightDirIndex = params.directoryEntries.findIndex(
      (entry) => entry.path === right.projectDirPath,
    );
    const normalizedLeftIndex = left.projectDirPath === params.rootPath ? -1 : leftDirIndex;
    const normalizedRightIndex = right.projectDirPath === params.rootPath ? -1 : rightDirIndex;

    if (normalizedLeftIndex !== normalizedRightIndex) {
      return normalizedLeftIndex - normalizedRightIndex;
    }

    return compareExplorerEnvFileNames(left.fileName, right.fileName);
  });
}
