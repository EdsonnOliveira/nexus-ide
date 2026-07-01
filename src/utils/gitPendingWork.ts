import type { GitStatusResult } from '@/types/git';
import { countGitStatusChanges } from '@/utils/gitFlatChanges';

export function gitRepoHasPendingWork(status: GitStatusResult): boolean {
  const hasLocalChanges = countGitStatusChanges(status) > 0;
  const hasUnpushedCommits = status.repo.ahead > 0;

  return hasLocalChanges || hasUnpushedCommits;
}

export function getGitPendingWorkMessage(status: GitStatusResult): string {
  const hasLocalChanges = countGitStatusChanges(status) > 0;
  const hasUnpushedCommits = status.repo.ahead > 0;

  if (hasLocalChanges && hasUnpushedCommits) {
    return 'Você tem alterações locais e commits não enviados. Faça commit e push antes de trocar de branch.';
  }

  if (hasLocalChanges) {
    return 'Você tem alterações locais não commitadas. Faça commit e push antes de trocar de branch.';
  }

  return 'Você tem commits que ainda não foram enviados. Faça push antes de trocar de branch.';
}
