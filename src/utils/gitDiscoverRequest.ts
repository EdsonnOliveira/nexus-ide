import type { GitRepoDiscovery } from '@/types';

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { expiresAt: number; repos: GitRepoDiscovery[] }>();
const inFlight = new Map<string, Promise<GitRepoDiscovery[]>>();

export function requestGitDiscoverRepos(projectPath: string): Promise<GitRepoDiscovery[]> {
  const now = Date.now();
  const cached = cache.get(projectPath);

  if (cached && cached.expiresAt > now) {
    return Promise.resolve(cached.repos);
  }

  const existing = inFlight.get(projectPath);

  if (existing) {
    return existing;
  }

  const request = window.nexus.git
    .discoverRepos(projectPath)
    .then((repos) => {
      cache.set(projectPath, { expiresAt: Date.now() + CACHE_TTL_MS, repos });
      return repos;
    })
    .catch((error: unknown) => {
      cache.delete(projectPath);
      throw error;
    })
    .finally(() => {
      if (inFlight.get(projectPath) === request) {
        inFlight.delete(projectPath);
      }
    });

  inFlight.set(projectPath, request);
  return request;
}

export function invalidateGitDiscoverReposCache(projectPath?: string): void {
  if (!projectPath) {
    cache.clear();
    return;
  }

  cache.delete(projectPath);
}
