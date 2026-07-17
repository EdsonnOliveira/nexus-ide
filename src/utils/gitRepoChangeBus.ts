type GitRepoChangeListener = (repoPath: string) => void;

const listeners = new Set<GitRepoChangeListener>();
let unsubscribeFromMain: (() => void) | null = null;

export function subscribeGitRepoChange(listener: GitRepoChangeListener): () => void {
  listeners.add(listener);

  if (!unsubscribeFromMain) {
    unsubscribeFromMain = window.nexus.git.onRepoChange((repoPath) => {
      listeners.forEach((entry) => {
        entry(repoPath);
      });
    });
  }

  return () => {
    listeners.delete(listener);

    if (listeners.size === 0 && unsubscribeFromMain) {
      unsubscribeFromMain();
      unsubscribeFromMain = null;
    }
  };
}
