const revisions = new Map<string, number>();
const listeners = new Set<() => void>();

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\/$/, '');
}

function notifyListeners(): void {
  listeners.forEach((listener) => {
    listener();
  });
}

export function bumpFileExternalRevision(filePath: string): void {
  const normalized = normalizeFilePath(filePath);
  revisions.set(normalized, (revisions.get(normalized) ?? 0) + 1);
  notifyListeners();
}

export function getFileExternalRevision(filePath: string): number {
  return revisions.get(normalizeFilePath(filePath)) ?? 0;
}

export function subscribeFileExternalRevisions(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function matchesExternalFileChange(filePath: string, changedPath?: string): boolean {
  if (!changedPath) {
    return false;
  }

  return normalizeFilePath(filePath) === normalizeFilePath(changedPath);
}
