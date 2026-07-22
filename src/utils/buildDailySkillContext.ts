import type { AgentGitChangeGroup } from '@/types/agentGit';
import type { GitChangeStatus } from '@/types/git';
import type { GitFlatChange } from '@/utils/gitFlatChanges';
import {
  isTranscriptionOnLocalDay,
  type LinkedTranscriptionSummary,
} from '@/utils/brainTranscriptionLinks';
import { sanitizeAgentPrompt } from '@/utils/terminalShellPrompt';
import { formatDailyTargetDateLabel } from '@/utils/dailyGenerateDate';
import {
  buildDailyResponseTonePromptLine,
  type DailyResponseTone,
} from '@/utils/dailyResponseTone';
import {
  formatMacParakeetDate,
  formatMacParakeetDuration,
  resolveMacParakeetSourceLabel,
} from '@/utils/macParakeetLabels';

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

function formatTranscriptionSection(items: LinkedTranscriptionSummary[]): string {
  if (items.length === 0) {
    return '';
  }

  const blocks = items.map((item) => {
    const meta = [
      resolveMacParakeetSourceLabel(item.sourceType),
      formatMacParakeetDuration(item.durationMs),
      formatMacParakeetDate(item.createdAt),
    ].join(' · ');
    const lines = [`- ${item.title} (${meta})`];

    if (item.conclusion?.trim()) {
      lines.push(`  Conclusion: ${item.conclusion.trim()}`);
    } else if (item.snippet.trim()) {
      lines.push(`  Snippet: ${item.snippet.trim()}`);
    }

    return lines.join('\n');
  });

  return `Linked transcriptions:\n${blocks.join('\n')}`;
}

export interface DailySkillContextInput {
  projectName: string;
  groups: AgentGitChangeGroup[];
  gitChanges?: GitFlatChange[];
  transcriptions?: LinkedTranscriptionSummary[];
  targetDate?: Date;
  responseTone?: DailyResponseTone;
}

export function buildDailySkillContext({
  projectName,
  groups,
  gitChanges = [],
  transcriptions = [],
  targetDate,
  responseTone,
}: DailySkillContextInput): string {
  const dateLine = targetDate
    ? `Target date: ${formatDailyTargetDateLabel(targetDate)}\n\n`
    : '';
  const toneLine = responseTone
    ? `${buildDailyResponseTonePromptLine(responseTone)}\n\n`
    : '';
  const dayTranscriptions = targetDate
    ? transcriptions.filter((item) => isTranscriptionOnLocalDay(item.createdAt, targetDate))
    : transcriptions;
  const transcriptionSection = formatTranscriptionSection(dayTranscriptions);
  const promptSections = groups
    .filter((group) => group.files.length > 0)
    .map((group) => {
      const prompt = sanitizeAgentPrompt(group.prompt);
      const fileLines = group.files.map(formatAgentFileLine).join('\n');

      return `Prompt: "${prompt}"\nFiles:\n${fileLines}`;
    });

  const sections: string[] = [];

  if (promptSections.length > 0) {
    sections.push(promptSections.join('\n\n'));
  } else if (gitChanges.length > 0) {
    sections.push(`Git changes:\n${gitChanges.map(formatGitFileLine).join('\n')}`);
  } else {
    sections.push(
      'No local agent prompt changes or uncommitted git changes. Use recent git history and commits already pushed for this project.',
    );
  }

  if (transcriptionSection) {
    sections.push(transcriptionSection);
  }

  return `${dateLine}${toneLine}Project: ${projectName}\n\n${sections.join('\n\n')}`;
}
