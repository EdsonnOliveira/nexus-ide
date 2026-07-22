import type { AgentGitChangeGroup } from '@/types/agentGit';
import type { GitFlatChange } from '@/utils/gitFlatChanges';

interface BuildDailyProjectMetaLabelOptions {
  groups: AgentGitChangeGroup[];
  gitChanges: GitFlatChange[];
  gitLoading?: boolean;
  transcriptionCount?: number;
  transcriptionsLoading?: boolean;
}

export function buildDailyProjectMetaLabel({
  groups,
  gitChanges,
  gitLoading = false,
  transcriptionCount = 0,
  transcriptionsLoading = false,
}: BuildDailyProjectMetaLabelOptions): string {
  const visibleGroups = groups.filter((group) => group.files.length > 0);
  const hasPromptGroups = visibleGroups.length > 0;
  const fallbackGitChanges = hasPromptGroups ? [] : gitChanges;
  const hasGitChanges = fallbackGitChanges.length > 0;
  const transcriptionLabel =
    transcriptionCount > 0
      ? `${transcriptionCount} transcriç${transcriptionCount === 1 ? 'ão' : 'ões'}`
      : null;

  let baseLabel: string;

  if (hasPromptGroups) {
    const fileCount = visibleGroups.reduce((total, group) => total + group.files.length, 0);

    baseLabel = `${visibleGroups.length} prompt${visibleGroups.length === 1 ? '' : 's'} · ${fileCount} arquivos`;
  } else if (gitLoading) {
    baseLabel = 'Carregando alterações git...';
  } else if (hasGitChanges) {
    baseLabel = `${fallbackGitChanges.length} alteração${fallbackGitChanges.length === 1 ? '' : 'ões'} git`;
  } else if (transcriptionsLoading) {
    baseLabel = 'Carregando transcrições...';
  } else if (transcriptionLabel) {
    baseLabel = transcriptionLabel;
  } else {
    baseLabel = 'Pronto para gerar';
  }

  if (transcriptionLabel && (hasPromptGroups || hasGitChanges)) {
    return `${baseLabel} · ${transcriptionLabel}`;
  }

  return baseLabel;
}
