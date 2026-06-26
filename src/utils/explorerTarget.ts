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
