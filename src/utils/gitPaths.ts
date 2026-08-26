function isAbsolutePath(value: string): boolean {
  const normalized = value.replace(/\\/g, '/');
  return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized);
}

export function expandUserPath(input: string, projectPath = ''): string {
  const normalized = input.replace(/\\/g, '/');

  if (normalized !== '~' && !normalized.startsWith('~/')) {
    return normalized;
  }

  const home =
    projectPath.replace(/\\/g, '/').match(/^(\/Users\/[^/]+)/)?.[1] ??
    projectPath.replace(/\\/g, '/').match(/^(\/home\/[^/]+)/)?.[1] ??
    null;

  if (!home) {
    return normalized;
  }

  return normalized === '~' ? home : `${home}${normalized.slice(1)}`;
}

function repoContainsAbsoluteFile(repoPath: string, filePath: string): boolean {
  const normalizedRepo = repoPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedInput = filePath.replace(/\\/g, '/');

  return normalizedInput === normalizedRepo || normalizedInput.startsWith(`${normalizedRepo}/`);
}

function pathBasenameFromSegments(value: string): string {
  const segments = value.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? value;
}

export function normalizeGitInputRelativePath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^\.\/+/, '');
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

  const normalizedProject = expandUserPath(projectPath, projectPath).replace(/\/+$/, '');
  const normalizedInput = expandUserPath(filePath, normalizedProject);
  const rootRepo = repos.find((repo) => repo.relativePath === '.');
  const sortedRepos = [...repos].sort((left, right) => right.path.length - left.path.length);

  if (!isAbsolutePath(normalizedInput)) {
    const relative = normalizeGitInputRelativePath(normalizedInput);

    for (const repo of sortedRepos) {
      if (
        repo.relativePath !== '.' &&
        (relative === repo.relativePath || relative.startsWith(`${repo.relativePath}/`))
      ) {
        return repo.path;
      }
    }

    return rootRepo?.path ?? null;
  }

  for (const repo of sortedRepos) {
    if (repoContainsAbsoluteFile(repo.path, normalizedInput)) {
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

  return rootRepo?.path ?? null;
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
  const repos = explicitRepoPath ? [] : await window.nexus.git.discoverRepos(projectPath);
  const repoPath =
    explicitRepoPath ?? pickGitRepoPathForFile(repos, projectPath, filePath) ?? projectPath;
  const normalizedInput = filePath.replace(/\\/g, '/');
  let gitRelativePath = isAbsolutePath(normalizedInput)
    ? toGitRelativePath(repoPath, filePath)
    : normalizeGitInputRelativePath(normalizedInput);

  if (!isAbsolutePath(normalizedInput)) {
    const repoMeta = repos.find((repo) => repo.path === repoPath);

    if (
      repoMeta &&
      repoMeta.relativePath !== '.' &&
      gitRelativePath.startsWith(`${repoMeta.relativePath}/`)
    ) {
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

    const markerMatch = normalizedInput.match(
      /(?:^|\/)((?:src|app|apps|packages|electron|lib|components|pages|screens|hooks|utils|services)\/.+)$/i,
    );

    if (markerMatch?.[1]) {
      return markerMatch[1];
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

export function gitChangePathCovers(candidate: string, changePath: string): boolean {
  if (gitChangePathsMatch(candidate, changePath)) {
    return true;
  }

  const prefix = normalizeGitChangePath(candidate).replace(/\/+$/, '');
  const path = normalizeGitChangePath(changePath).replace(/\/+$/, '');

  if (!prefix || !path) {
    return false;
  }

  return path === prefix || path.startsWith(`${prefix}/`) || prefix.startsWith(`${path}/`);
}

export function findGitFlatChangeByPath<T extends { path: string }>(
  changes: T[],
  filePath: string,
): T | null {
  return changes.find((change) => gitChangePathsMatch(change.path, filePath)) ?? null;
}
