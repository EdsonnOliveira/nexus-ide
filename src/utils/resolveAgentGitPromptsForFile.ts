import { useAgentGitChangeStore } from '@/stores/useAgentGitChangeStore';
import { useProjectStore } from '@/stores/useProjectStore';
import type { AgentGitChangeGroup } from '@/types/agentGit';
import type { AgentGitFilePromptTurn } from '@/utils/injectAgentPromptsIntoDiff';
import { gitChangePathsMatch, toGitRelativePath } from '@/utils/gitPaths';
import { sanitizeAgentPrompt } from '@/utils/terminalShellPrompt';

function resolveGroups(projectId: string): AgentGitChangeGroup[] {
  const fromStore = useAgentGitChangeStore.getState().groupsByProject[projectId];

  if (fromStore && fromStore.length > 0) {
    return fromStore;
  }

  const project = useProjectStore.getState().projects.find((entry) => entry.id === projectId);

  return project?.agentGitGroups ?? [];
}

function resolveIncrementalChangeCount(
  file: AgentGitChangeGroup['files'][number],
  previousAdditions: number,
  previousDeletions: number,
): number {
  const incrementalAdditions = Math.max(0, file.additions - previousAdditions);
  const incrementalDeletions = Math.max(0, file.deletions - previousDeletions);
  const incrementalTotal = incrementalAdditions + incrementalDeletions;

  if (incrementalTotal > 0) {
    return incrementalTotal;
  }

  return Math.max(1, file.additions + file.deletions);
}

export function resolveAgentGitPromptsForFile(
  projectId: string,
  filePath: string,
  repoPath?: string,
): AgentGitFilePromptTurn[] {
  const groups = resolveGroups(projectId);

  if (groups.length === 0) {
    return [];
  }

  const project = useProjectStore.getState().projects.find((entry) => entry.id === projectId);
  const resolvedRepoPath = repoPath ?? project?.path;

  if (!resolvedRepoPath) {
    return [];
  }

  const relativePath = toGitRelativePath(resolvedRepoPath, filePath)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const matches = groups
    .map((group) => ({
      group,
      file: group.files.find((file) => gitChangePathsMatch(file.path, relativePath)) ?? null,
    }))
    .filter((entry): entry is { group: AgentGitChangeGroup; file: AgentGitChangeGroup['files'][number] } =>
      Boolean(entry.file),
    )
    .sort((left, right) => left.group.completedAt - right.group.completedAt);

  const turns: AgentGitFilePromptTurn[] = [];
  let previousAdditions = 0;
  let previousDeletions = 0;

  for (const { group, file } of matches) {
    const prompt = sanitizeAgentPrompt(group.prompt);

    if (!prompt) {
      previousAdditions = file.additions;
      previousDeletions = file.deletions;
      continue;
    }

    turns.push({
      prompt,
      changeCount: resolveIncrementalChangeCount(file, previousAdditions, previousDeletions),
      completedAt: group.completedAt,
    });

    previousAdditions = file.additions;
    previousDeletions = file.deletions;
  }

  return turns;
}
