import type {
  AgentActivity,
  AgentTurnSummary,
  AgentTurnSummaryCommandRef,
  AgentTurnSummaryFileRef,
} from '@/types';
import { sanitizeResponseText } from '@/utils/agentTranscriptParser';
import { normalizeMarkdownSource } from '@/utils/markdownText';

export function isAgentTurnSummaryVisible(summary: AgentTurnSummary | undefined): boolean {
  if (!summary) {
    return false;
  }

  return (
    summary.editedFileCount > 0 ||
    summary.exploredFileCount > 0 ||
    summary.commandCount > 0 ||
    summary.additions > 0 ||
    summary.deletions > 0
  );
}

export function computeAgentTurnSummaryFromActivities(
  activities: AgentActivity[],
): AgentTurnSummary | undefined {
  const editedPaths = new Set<string>();
  const exploredPaths = new Set<string>();
  const exploredFiles: AgentTurnSummaryFileRef[] = [];
  const editedFiles: AgentTurnSummaryFileRef[] = [];
  const commands: AgentTurnSummaryCommandRef[] = [];
  let commandCount = 0;
  let additions = 0;
  let deletions = 0;
  const leadChunks: string[] = [];
  let reachedTools = false;

  for (const activity of activities) {
    if (activity.kind === 'file_edit' || activity.kind === 'file_read') {
      reachedTools = true;
    }

    if (!reachedTools && activity.kind === 'response') {
      const text = sanitizeResponseText(activity.label).trim();

      if (text) {
        leadChunks.push(text);
      }
    }

    if (activity.kind === 'file_edit') {
      const path = activity.filePath?.trim();

      if (path) {
        const key = path.toLowerCase();

        if (!editedPaths.has(key)) {
          editedPaths.add(key);
          editedFiles.push({ path });
        }
      }

      additions += activity.additions ?? 0;
      deletions += activity.deletions ?? 0;
      continue;
    }

    if (activity.kind === 'file_read') {
      const path = activity.filePath?.trim();

      if (path) {
        const key = path.toLowerCase();

        if (!exploredPaths.has(key)) {
          exploredPaths.add(key);
          exploredFiles.push({ path });
        }
      }

      continue;
    }

    if (activity.kind === 'status' && /^Ran\b/i.test(activity.label.trim())) {
      const command = activity.label.trim().replace(/^Ran\s+/i, '').trim();

      if (command) {
        commands.push({ command });
      }

      commandCount += 1;
      continue;
    }

    if (activity.kind === 'tool_run' && activity.toolCommand?.trim()) {
      commands.push({ command: activity.toolCommand.trim() });
      commandCount += 1;
      continue;
    }

    if (activity.kind === 'live_status') {
      const runningMatch = activity.label.trim().match(/^Running\s+(.+)$/i);

      if (runningMatch?.[1]?.trim()) {
        commands.push({ command: runningMatch[1].trim() });
        commandCount += 1;
      }
    }
  }

  const resolvedCommandCount = commands.length > 0 ? commands.length : commandCount;
  const responseLead = leadChunks.join('\n\n').trim();
  const summary: AgentTurnSummary = {
    editedFileCount: editedPaths.size,
    exploredFileCount: exploredPaths.size,
    commandCount: resolvedCommandCount,
    additions,
    deletions,
    ...(responseLead ? { responseLead } : {}),
    ...(exploredFiles.length > 0 ? { exploredFiles } : {}),
    ...(editedFiles.length > 0 ? { editedFiles } : {}),
    ...(commands.length > 0 ? { commands } : {}),
  };

  return isAgentTurnSummaryVisible(summary) ? summary : undefined;
}

export function buildAgentTurnSummaryParts(summary: AgentTurnSummary): string[] {
  const parts: string[] = [];

  if (summary.editedFileCount > 0) {
    parts.push(
      `Edited ${summary.editedFileCount} file${summary.editedFileCount === 1 ? '' : 's'}`,
    );
  }

  if (summary.exploredFileCount > 0) {
    parts.push(
      `explored ${summary.exploredFileCount} file${summary.exploredFileCount === 1 ? '' : 's'}`,
    );
  }

  if (summary.commandCount > 0) {
    parts.push(
      `ran ${summary.commandCount} command${summary.commandCount === 1 ? '' : 's'}`,
    );
  }

  return parts;
}

export type AgentTurnSummarySegmentKind = 'edited' | 'explored' | 'commands';

export interface AgentTurnSummarySegment {
  kind: AgentTurnSummarySegmentKind;
  label: string;
  files?: AgentTurnSummaryFileRef[];
  commands?: AgentTurnSummaryCommandRef[];
}

export function buildAgentTurnSummarySegments(summary: AgentTurnSummary): AgentTurnSummarySegment[] {
  const segments: AgentTurnSummarySegment[] = [];

  if (summary.editedFileCount > 0) {
    segments.push({
      kind: 'edited',
      label: `Edited ${summary.editedFileCount} file${summary.editedFileCount === 1 ? '' : 's'}`,
      files: summary.editedFiles,
    });
  }

  if (summary.exploredFileCount > 0) {
    segments.push({
      kind: 'explored',
      label: `explored ${summary.exploredFileCount} file${summary.exploredFileCount === 1 ? '' : 's'}`,
      files: summary.exploredFiles,
    });
  }

  if (summary.commandCount > 0) {
    segments.push({
      kind: 'commands',
      label: `ran ${summary.commandCount} command${summary.commandCount === 1 ? '' : 's'}`,
      commands: summary.commands,
    });
  }

  return segments;
}

export function getAgentTurnSummaryFileName(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] ?? path;
}

function normalizeResponseComparison(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function splitAgentResponseForSummary(
  content: string,
  responseLead?: string,
): { lead: string; rest: string } | null {
  const trimmed = content.trim();

  if (!trimmed) {
    return null;
  }

  const leadCandidate = responseLead?.trim();

  if (leadCandidate) {
    if (trimmed.startsWith(leadCandidate)) {
      const rest = trimmed.slice(leadCandidate.length).trim();

      if (rest) {
        return { lead: leadCandidate, rest };
      }
    }

    const normalizedLead = normalizeResponseComparison(leadCandidate);
    const normalizedContent = normalizeResponseComparison(trimmed);

    if (
      normalizedLead &&
      normalizedContent.startsWith(normalizedLead) &&
      normalizedContent.length > normalizedLead.length
    ) {
      const ratio = leadCandidate.length / normalizedLead.length;
      const approximateEnd = Math.min(trimmed.length, Math.round(normalizedLead.length * ratio));
      const rest = trimmed.slice(approximateEnd).trim();

      if (rest) {
        return { lead: trimmed.slice(0, approximateEnd).trim(), rest };
      }
    }
  }

  const headingSplitIndex = trimmed.search(/\n(?=#{1,6}\s|\*\*[^*\n]+\*\*)/);

  if (headingSplitIndex > 0) {
    const lead = trimmed.slice(0, headingSplitIndex).trim();
    const rest = trimmed.slice(headingSplitIndex).trim();

    if (lead && rest) {
      return { lead, rest };
    }
  }

  return null;
}

export function extractAgentFinalResponseText(activities: AgentActivity[]): string {
  return activities
    .filter((activity) => activity.kind === 'response')
    .map((activity) => sanitizeResponseText(normalizeMarkdownSource(activity.label)).trim())
    .filter(Boolean)
    .join('\n\n');
}

export function isAgentToolActivity(activity: AgentActivity): boolean {
  if (activity.kind === 'file_edit' || activity.kind === 'file_read') {
    return Boolean(activity.filePath?.trim());
  }

  if (activity.kind === 'tool_run') {
    return Boolean(activity.label.trim() || activity.toolCommand?.trim());
  }

  if (activity.kind === 'live_status') {
    return Boolean(activity.label.trim());
  }

  if (activity.kind === 'status') {
    return /^Ran\b/i.test(activity.label.trim());
  }

  return false;
}

export function isAgentScrollGroupActivity(activity: AgentActivity, running: boolean): boolean {
  if (activity.kind === 'file_edit') {
    return Boolean(activity.filePath?.trim());
  }

  if (activity.kind === 'file_read') {
    return running && Boolean(activity.filePath?.trim());
  }

  if (activity.kind === 'tool_run') {
    return running && Boolean(activity.label.trim() || activity.toolCommand?.trim());
  }

  if (activity.kind === 'live_status') {
    return running && Boolean(activity.label.trim());
  }

  if (activity.kind === 'status') {
    return Boolean(/^Ran\b/i.test(activity.label.trim()));
  }

  return false;
}

export interface AgentActivityRenderChunk {
  key: string;
  type: 'single' | 'tool-group';
  activity?: AgentActivity;
  activities?: AgentActivity[];
}

export function buildAgentActivityRenderChunks(
  activities: AgentActivity[],
  running: boolean,
): AgentActivityRenderChunk[] {
  const chunks: AgentActivityRenderChunk[] = [];
  let toolGroup: AgentActivity[] = [];

  const flushToolGroup = () => {
    if (toolGroup.length === 0) {
      return;
    }

    chunks.push({
      key: `tool-group-${toolGroup[0]?.id ?? chunks.length}`,
      type: 'tool-group',
      activities: toolGroup,
    });
    toolGroup = [];
  };

  for (const activity of activities) {
    if (isAgentScrollGroupActivity(activity, running)) {
      toolGroup.push(activity);
      continue;
    }

    flushToolGroup();
    chunks.push({
      key: activity.id,
      type: 'single',
      activity,
    });
  }

  flushToolGroup();

  return chunks;
}

export function buildLiveToolBatchSummary(
  activities: AgentActivity[],
  running: boolean,
): string | null {
  const fileReads = activities.filter((activity) => activity.kind === 'file_read');
  const fileEdits = activities.filter((activity) => activity.kind === 'file_edit');
  const searchCount = activities.filter(
    (activity) =>
      (activity.kind === 'tool_run' || activity.kind === 'live_status') &&
      /^(?:Glob|Grep)/i.test(activity.label.trim()),
  ).length;

  if (running) {
    const liveStatus = [...activities]
      .reverse()
      .find((activity) => activity.kind === 'live_status' && activity.label.trim());

    if (liveStatus?.label.trim()) {
      return liveStatus.label.trim();
    }

    const streamingShell = [...activities]
      .reverse()
      .find(
        (activity) =>
          activity.kind === 'tool_run' &&
          activity.streaming &&
          activity.toolCommand?.trim(),
      );

    if (streamingShell?.toolCommand?.trim()) {
      const command = streamingShell.toolCommand.trim();
      const preview = command.length > 56 ? `${command.slice(0, 53)}…` : command;

      return `Executando ${preview}`;
    }

    const streamingTool = [...activities]
      .reverse()
      .find((activity) => activity.kind === 'tool_run' && activity.streaming && activity.label.trim());

    if (streamingTool?.label.trim()) {
      return streamingTool.label.trim();
    }
  }

  if (fileEdits.length > 0) {
    const additions = fileEdits.reduce((sum, entry) => sum + (entry.additions ?? 0), 0);
    const deletions = fileEdits.reduce((sum, entry) => sum + (entry.deletions ?? 0), 0);
    let label = `Editing ${fileEdits.length} file${fileEdits.length === 1 ? '' : 's'}`;

    if (additions > 0 || deletions > 0) {
      label += ` +${additions} -${deletions}`;
    }

    return label;
  }

  const exploredCount = fileReads.length;

  if (exploredCount > 0 || searchCount > 0) {
    const prefix = running ? 'Exploring' : 'Explored';
    const fileLabel = `${exploredCount} file${exploredCount === 1 ? '' : 's'}`;
    const searchLabel =
      searchCount > 0 ? `, ${searchCount} search${searchCount === 1 ? '' : 'es'}` : '';

    return `${prefix} ${fileLabel}${searchLabel}`;
  }

  const shellRuns = activities.filter(
    (activity) => activity.kind === 'tool_run' && activity.toolCommand?.trim(),
  );

  if (shellRuns.length > 0) {
    return running
      ? `Running ${shellRuns.length} command${shellRuns.length === 1 ? '' : 's'}`
      : `Ran ${shellRuns.length} command${shellRuns.length === 1 ? '' : 's'}`;
  }

  return null;
}

export function findLiveToolBatchDetailActivity(
  activities: AgentActivity[],
): AgentActivity | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const entry = activities[index];

    if (!entry) {
      continue;
    }

    if (entry.kind === 'live_status') {
      return entry;
    }

    if (entry.kind === 'tool_run' && entry.streaming) {
      return entry;
    }
  }

  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const entry = activities[index];

    if (
      entry &&
      (entry.kind === 'file_edit' ||
        entry.kind === 'tool_run' ||
        entry.kind === 'file_read')
    ) {
      return entry;
    }
  }

  return null;
}

export function shouldShowLiveToolBatchDetail(
  detail: AgentActivity | null,
  summary: string | null,
): boolean {
  if (!detail) {
    return false;
  }

  if (detail.kind === 'live_status') {
    const detailLabel = detail.label.trim();
    const summaryLabel = summary?.trim() ?? '';

    if (!detailLabel || detailLabel === summaryLabel) {
      return false;
    }
  }

  if (detail.streaming || detail.kind === 'live_status') {
    return true;
  }

  if (detail.kind === 'file_edit' || detail.toolCommand?.trim()) {
    return true;
  }

  return !summary;
}

export function partitionAgentToolActivitiesForResponse(activities: AgentActivity[]): {
  activities: AgentActivity[];
  responseTools: AgentActivity[];
} {
  const responseIndex = activities.findIndex((activity) => activity.kind === 'response');

  if (responseIndex === -1) {
    return { activities, responseTools: [] };
  }

  const responseTools = activities.filter((activity) => isAgentToolActivity(activity));

  if (responseTools.length === 0) {
    return { activities, responseTools: [] };
  }

  const responseToolIds = new Set(responseTools.map((activity) => activity.id));

  return {
    activities: activities.filter((activity) => !responseToolIds.has(activity.id)),
    responseTools,
  };
}
