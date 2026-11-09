import type { FileTab, Tab, TabBarItem } from '../../types';

export const MAX_PERSISTED_DIFF_CHARS = 200_000;

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'ico',
  'bmp',
  'avif',
  'tif',
  'tiff',
]);

function fileNameFromPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
}

function isImageFileName(fileName: string): boolean {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(extension);
}

function looksLikeBinaryPayload(value: string): boolean {
  if (value.startsWith('data:image/') || value.startsWith('data:application/octet-stream')) {
    return true;
  }

  const sample = value.slice(0, 4096);

  if (sample.includes('\u0000')) {
    return true;
  }

  let suspicious = 0;

  for (let index = 0; index < sample.length; index += 1) {
    const code = sample.charCodeAt(index);

    if (code < 9 || (code > 13 && code < 32)) {
      suspicious += 1;
    }
  }

  return suspicious > sample.length * 0.05;
}

export function shouldPersistFileDiffPayload(
  filePath: string,
  before?: string,
  after?: string,
): boolean {
  const fileName = fileNameFromPath(filePath);

  if (isImageFileName(fileName)) {
    return false;
  }

  const beforeLength = before?.length ?? 0;
  const afterLength = after?.length ?? 0;

  if (beforeLength + afterLength > MAX_PERSISTED_DIFF_CHARS) {
    return false;
  }

  if (before && looksLikeBinaryPayload(before)) {
    return false;
  }

  if (after && looksLikeBinaryPayload(after)) {
    return false;
  }

  return true;
}

export function resolvePersistedDiffFields(tab: FileTab): {
  diffBefore?: string;
  diffAfter?: string;
} {
  if (tab.viewMode !== 'diff') {
    return {};
  }

  if (!shouldPersistFileDiffPayload(tab.filePath, tab.diffBefore, tab.diffAfter)) {
    return {};
  }

  return {
    ...(tab.diffBefore !== undefined ? { diffBefore: tab.diffBefore } : {}),
    ...(tab.diffAfter !== undefined ? { diffAfter: tab.diffAfter } : {}),
  };
}

export function measurePersistedDiffPayloadBytes(tabs: TabBarItem[]): number {
  let total = 0;

  const visit = (tab: Tab) => {
    if (tab.type !== 'file') {
      return;
    }

    total += tab.diffBefore?.length ?? 0;
    total += tab.diffAfter?.length ?? 0;
  };

  for (const item of tabs) {
    if (item.type === 'split') {
      for (const pane of item.panes) {
        visit(pane);
      }
      continue;
    }

    visit(item);
  }

  return total;
}

export function measureProjectsDiffPayloadBytes(
  projects: Array<{ tabs?: TabBarItem[] }>,
): number {
  return projects.reduce(
    (total, project) => total + measurePersistedDiffPayloadBytes(project.tabs ?? []),
    0,
  );
}
