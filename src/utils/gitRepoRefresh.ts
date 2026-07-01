export const GIT_REPO_REFRESH_EVENT = 'nexus:git-refresh';

export async function emitGitRepoRefresh(repoPath: string): Promise<void> {
  await window.nexus.git.invalidateCache(repoPath);
  window.dispatchEvent(new CustomEvent(GIT_REPO_REFRESH_EVENT, { detail: { repoPath } }));
}

export async function emitGitProjectRefresh(projectPath: string): Promise<void> {
  const repos = await window.nexus.git.discoverRepos(projectPath);

  await Promise.all(repos.map((repo) => emitGitRepoRefresh(repo.path)));
}
