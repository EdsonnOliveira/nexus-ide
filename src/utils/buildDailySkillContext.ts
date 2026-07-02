import type { AgentGitChangeGroup } from '@/types/agentGit';
import type { GitChangeStatus } from '@/types/git';
import type { GitFlatChange } from '@/utils/gitFlatChanges';
import { sanitizeAgentPrompt } from '@/utils/terminalShellPrompt';
import { formatDailyTargetDateLabel } from '@/utils/dailyGenerateDate';
import {
  buildDailyResponseTonePromptLine,
  type DailyResponseTone,
} from '@/utils/dailyResponseTone';

function formatAgentFileLine(file: AgentGitChangeGroup['files'][number]): string {
  const stats =
    file.additions > 0 || file.deletions > 0
      ? ` (+${file.additions} -${file.deletions}, ${file.status as GitChangeStatus})`
      : ` (${file.status as GitChangeStatus})`;

  return `- ${file.path}${stats}`;
}

function formatGitFileLine(change: GitFlatChange): string {
  const stagedLabel = change.staged ? ', staged' : '';
  const stats =
    change.additions > 0 || change.deletions > 0
      ? ` (+${change.additions} -${change.deletions}, ${change.status}${stagedLabel})`
      : ` (${change.status}${stagedLabel})`;

  return `- ${change.path}${stats}`;
}

export interface DailySkillContextInput {
  projectName: string;
  groups: AgentGitChangeGroup[];
  gitChanges?: GitFlatChange[];
  targetDate?: Date;
  responseTone?: DailyResponseTone;
}

export function buildDailySkillContext({
  projectName,
  groups,
  gitChanges = [],
  targetDate,
  responseTone,
}: DailySkillContextInput): string {
  const dateLine = targetDate
    ? `Target date: ${formatDailyTargetDateLabel(targetDate)}\n\n`
    : '';
  const toneLine = responseTone
    ? `${buildDailyResponseTonePromptLine(responseTone)}\n\n`
    : '';
  const promptSections = groups
    .filter((group) => group.files.length > 0)
    .map((group) => {
      const prompt = sanitizeAgentPrompt(group.prompt);
      const fileLines = group.files.map(formatAgentFileLine).join('\n');

      return `Prompt: "${prompt}"\nFiles:\n${fileLines}`;
    });

  if (promptSections.length > 0) {
    return `${dateLine}${toneLine}Project: ${projectName}\n\n${promptSections.join('\n\n')}`;
  }

  if (gitChanges.length > 0) {
    const fileLines = gitChanges.map(formatGitFileLine).join('\n');

    return `${dateLine}${toneLine}Project: ${projectName}\n\nGit changes:\n${fileLines}`;
  }

  return `${dateLine}${toneLine}Project: ${projectName}\n\nNo local agent prompt changes or uncommitted git changes. Use recent git history and commits already pushed for this project.`;
}
