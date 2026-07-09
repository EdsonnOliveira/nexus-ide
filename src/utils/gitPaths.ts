function isAbsolutePath(value: string): boolean {
  const normalized = value.replace(/\\/g, '/');
  return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized);
}

function pathBasenameFromSegments(value: string): string {
  const segments = value.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? value;
}

export function normalizeGitInputRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\/+/, '');
}

interface GitRepoPathCandidate {
  path: string;
  relativePath: string;
}

function pickGitRepoPathForFile(
  repos: GitRepoPathCandidate[],
  projectPath: string,
  filePath: string,
): string | null {
  if (repos.length === 0) {
    return null;
  }

  const normalizedProject = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedInput = filePath.replace(/\\/g, '/');

  if (!isAbsolutePath(normalizedInput)) {
    const relative = normalizeGitInputRelativePath(normalizedInput);
    const sortedRepos = [...repos].sort((left, right) => right.path.length - left.path.length);

    for (const repo of sortedRepos) {
      if (repo.relativePath !== '.' && relative.startsWith(`${repo.relativePath}/`)) {
        return repo.path;
      }
    }

    if (repos.length === 1) {
      return repos[0].path;
    }

    return sortedRepos[0]?.path ?? null;
  }

  const sortedRepos = [...repos].sort((left, right) => right.path.length - left.path.length);

  for (const repo of sortedRepos) {
    const normalizedRepo = repo.path.replace(/\\/g, '/').replace(/\/+$/, '');

    if (normalizedInput === normalizedRepo || normalizedInput.startsWith(`${normalizedRepo}/`)) {
      return repo.path;
    }
  }

  const projectMarker = `${normalizedProject}/`;
  const projectIndex = normalizedInput.indexOf(projectMarker);

  if (projectIndex >= 0) {
    const projectRelative = normalizedInput.slice(projectIndex + projectMarker.length);

    for (const repo of sortedRepos) {
      if (repo.relativePath === '.') {
        continue;
      }

      if (
        projectRelative === repo.relativePath ||
        projectRelative.startsWith(`${repo.relativePath}/`)
      ) {
        return repo.path;
      }
    }
  }

  return repos.length === 1 ? repos[0].path : (sortedRepos[0]?.path ?? null);
}

export async function resolveGitRepoPathForFile(
  projectPath: string,
  filePath: string,
  explicitRepoPath?: string,
): Promise<string> {
  if (explicitRepoPath) {
    return explicitRepoPath;
  }

  const repos = await window.nexus.git.discoverRepos(projectPath);
  return pickGitRepoPathForFile(repos, projectPath, filePath) ?? projectPath;
}

export async function resolveGitDiffContext(
  projectPath: string,
  filePath: string,
  explicitRepoPath?: string,
): Promise<{ repoPath: string; gitRelativePath: string; absoluteFilePath: string }> {
  const repos = explicitRepoPath
    ? []
    : await window.nexus.git.discoverRepos(projectPath);
  const repoPath =
    explicitRepoPath ??
    pickGitRepoPathForFile(repos, projectPath, filePath) ??
    projectPath;
  const normalizedInput = filePath.replace(/\\/g, '/');
  let gitRelativePath = isAbsolutePath(normalizedInput)
    ? toGitRelativePath(repoPath, filePath)
    : normalizeGitInputRelativePath(normalizedInput);

  if (!isAbsolutePath(normalizedInput)) {
    const repoMeta = repos.find((repo) => repo.path === repoPath);

    if (repoMeta && repoMeta.relativePath !== '.' && gitRelativePath.startsWith(`${repoMeta.relativePath}/`)) {
      gitRelativePath = gitRelativePath.slice(repoMeta.relativePath.length + 1);
    }
  }

  const absoluteFilePath = toRepoAbsolutePath(repoPath, gitRelativePath);

  return {
    repoPath,
    gitRelativePath,
    absoluteFilePath,
  };
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
