import type { AgentGitChangeGroup } from '@/types/agentGit';
import type { GitFlatChange } from '@/utils/gitFlatChanges';

interface BuildDailyProjectMetaLabelOptions {
  groups: AgentGitChangeGroup[];
  gitChanges: GitFlatChange[];
  gitLoading?: boolean;
}

export function buildDailyProjectMetaLabel({
  groups,
  gitChanges,
  gitLoading = false,
}: BuildDailyProjectMetaLabelOptions): string {
  const visibleGroups = groups.filter((group) => group.files.length > 0);
  const hasPromptGroups = visibleGroups.length > 0;
  const fallbackGitChanges = hasPromptGroups ? [] : gitChanges;
  const hasGitChanges = fallbackGitChanges.length > 0;

  if (hasPromptGroups) {
    const fileCount = visibleGroups.reduce((total, group) => total + group.files.length, 0);

    return `${visibleGroups.length} prompt${visibleGroups.length === 1 ? '' : 's'} · ${fileCount} arquivos`;
  }

  if (gitLoading) {
    return 'Carregando alterações git...';
  }

  if (hasGitChanges) {
    return `${fallbackGitChanges.length} alteração${fallbackGitChanges.length === 1 ? '' : 'ões'} git`;
  }

  return 'Pronto para gerar';
}
