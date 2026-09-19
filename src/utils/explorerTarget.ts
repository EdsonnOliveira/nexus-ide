export const EXPLORER_REVEAL_PATH_EVENT = 'nexus-explorer-reveal-path';

export interface ExplorerRevealPathDetail {
  projectId: string;
  path: string;
}

let pendingExplorerReveal: ExplorerRevealPathDetail | null = null;

export function queueExplorerRevealPath(projectId: string, path: string): void {
  pendingExplorerReveal = { projectId, path };
  window.dispatchEvent(
    new CustomEvent<ExplorerRevealPathDetail>(EXPLORER_REVEAL_PATH_EVENT, {
      detail: { projectId, path },
    }),
  );
}

export function consumeExplorerRevealPath(projectId: string): string | null {
  if (!pendingExplorerReveal || pendingExplorerReveal.projectId !== projectId) {
    return null;
  }

  const nextPath = pendingExplorerReveal.path;
  pendingExplorerReveal = null;
  return nextPath;
}

function getParentDirectory(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');

  if (lastSlash <= 0) {
    return filePath;
  }

  return normalized.slice(0, lastSlash);
}

export function resolveExplorerTargetDirectory(
  rootPath: string,
  selectedPath: string | null,
  selectedType: 'file' | 'directory' | null,
): string {
  if (!selectedPath || !selectedType) {
    return rootPath;
  }

  if (selectedType === 'directory') {
    return selectedPath;
  }

  return getParentDirectory(selectedPath);
}
