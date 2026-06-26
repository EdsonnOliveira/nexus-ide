export const GIT_REPO_REFRESH_EVENT = 'nexus:git-refresh';

export function emitGitRepoRefresh(repoPath: string): void {
  void window.nexus.git.invalidateCache(repoPath);
  window.dispatchEvent(new CustomEvent(GIT_REPO_REFRESH_EVENT, { detail: { repoPath } }));
}
