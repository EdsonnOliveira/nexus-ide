import type { GitStatusResult } from '@/types/git';

const inFlight = new Map<string, Promise<GitStatusResult>>();

export function requestGitStatus(repoPath: string): Promise<GitStatusResult> {
  const existing = inFlight.get(repoPath);

  if (existing) {
    return existing;
  }

  const request = window.nexus.git.getStatus(repoPath).finally(() => {
    if (inFlight.get(repoPath) === request) {
      inFlight.delete(repoPath);
    }
  });

  inFlight.set(repoPath, request);
  return request;
}
