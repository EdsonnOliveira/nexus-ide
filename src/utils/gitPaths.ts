function isAbsolutePath(value: string): boolean {
  const normalized = value.replace(/\\/g, '/');
  return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized);
}

function pathBasenameFromSegments(value: string): string {
  const segments = value.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? value;
}

export function toGitRelativePath(repoPath: string, filePath: string): string {
  const normalizedRepo = repoPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedInput = filePath.replace(/\\/g, '/');

  if (isAbsolutePath(normalizedInput)) {
    const repoPrefix = `${normalizedRepo}/`;

    if (normalizedInput === normalizedRepo) {
      return '';
    }

    if (normalizedInput.startsWith(repoPrefix)) {
      return normalizedInput.slice(repoPrefix.length);
    }

    const repoMarker = `${normalizedRepo}/`;
    const markerIndex = normalizedInput.indexOf(repoMarker);

    if (markerIndex >= 0) {
      return normalizedInput.slice(markerIndex + repoMarker.length);
    }

    return pathBasenameFromSegments(normalizedInput);
  }

  return normalizedInput.replace(/^\/+/, '').replace(/^\.\/+/, '');
}

export function toRepoAbsolutePath(repoPath: string, gitPath: string): string {
  const normalizedRepo = repoPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const relativePath = toGitRelativePath(repoPath, gitPath);
  return `${normalizedRepo}/${relativePath}`;
}

function normalizeGitChangePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

export function gitChangePathsMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeGitChangePath(left);
  const normalizedRight = normalizeGitChangePath(right);

  if (normalizedLeft === normalizedRight) {
    return true;
  }

  return (
    normalizedLeft.endsWith(`/${normalizedRight}`) || normalizedRight.endsWith(`/${normalizedLeft}`)
  );
}

export function findGitFlatChangeByPath<T extends { path: string }>(
  changes: T[],
  filePath: string,
): T | null {
  return changes.find((change) => gitChangePathsMatch(change.path, filePath)) ?? null;
}
