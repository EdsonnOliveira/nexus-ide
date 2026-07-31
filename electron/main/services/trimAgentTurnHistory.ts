import type { AgentActivity, AgentTurn, AgentTurnSummary } from '../../types';

export const MAX_AGENT_TURN_HISTORY_COUNT = 15;
export const MAX_AGENT_TURN_HISTORY_BYTES = 512 * 1024;
export const MAX_RUNNING_TURN_HISTORY_BYTES = 2 * 1024 * 1024;
export const HEAVY_AGENT_TURN_THRESHOLD = 12;
export const HEAVY_AGENT_ACTIVITY_THRESHOLD = 80;

const MAX_USER_CONTENT_CHARS = 16_000;
const MAX_AGENT_PROMPT_CHARS = 16_000;
const MAX_ACTIVITY_LABEL_CHARS = 4_000;
const MAX_TOOL_OUTPUT_CHARS = 8_000;
const MAX_PLAN_BODY_CHARS = 16_000;
const MAX_PLAN_OVERVIEW_CHARS = 4_000;
const MAX_SUMMARY_LEAD_CHARS = 2_000;

export function countAgentTranscriptActivities(turns: AgentTurn[]): number {
  return turns.reduce((total, turn) => total + turn.activities.length, 0);
}

export function isHeavyAgentTranscript(turns: AgentTurn[]): boolean {
  if (turns.length === 0) {
    return false;
  }

  if (turns.some((turn) => turn.running)) {
    return false;
  }

  return (
    turns.length >= HEAVY_AGENT_TURN_THRESHOLD ||
    countAgentTranscriptActivities(turns) > HEAVY_AGENT_ACTIVITY_THRESHOLD
  );
}

export function measureAgentTurnHistoryBytes(turns: AgentTurn[]): number {
  return JSON.stringify(turns).length;
}

function truncateText(value: string | undefined, maxChars: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value.length <= maxChars) {
    return value;
  }

  return value.slice(0, maxChars);
}

function compactActivity(activity: AgentActivity): AgentActivity {
  const label = truncateText(activity.label, MAX_ACTIVITY_LABEL_CHARS) ?? activity.label;
  const toolOutput = truncateText(activity.toolOutput, MAX_TOOL_OUTPUT_CHARS);
  const planBody = truncateText(activity.planBody, MAX_PLAN_BODY_CHARS);
  const planOverview = truncateText(activity.planOverview, MAX_PLAN_OVERVIEW_CHARS);

  if (
    label === activity.label &&
    toolOutput === activity.toolOutput &&
    planBody === activity.planBody &&
    planOverview === activity.planOverview
  ) {
    return activity;
  }

  return {
    ...activity,
    label,
    ...(toolOutput !== undefined ? { toolOutput } : {}),
    ...(planBody !== undefined ? { planBody } : {}),
    ...(planOverview !== undefined ? { planOverview } : {}),
  };
}

function compactSummary(summary: AgentTurnSummary | undefined): AgentTurnSummary | undefined {
  if (!summary) {
    return undefined;
  }

  const responseLead = truncateText(summary.responseLead, MAX_SUMMARY_LEAD_CHARS);

  if (responseLead === summary.responseLead) {
    return summary;
  }

  return { ...summary, responseLead };
}

function compactTurnFields(turn: AgentTurn): AgentTurn {
  const content = truncateText(turn.user.content, MAX_USER_CONTENT_CHARS) ?? turn.user.content;
  const agentPrompt =
    turn.user.agentPrompt !== undefined
      ? truncateText(turn.user.agentPrompt, MAX_AGENT_PROMPT_CHARS)
      : undefined;
  const activities = turn.activities.map(compactActivity);
  const summary = compactSummary(turn.summary);
  const userChanged = content !== turn.user.content || agentPrompt !== turn.user.agentPrompt;
  const activitiesChanged = activities.some(
    (activity, index) => activity !== turn.activities[index],
  );
  const summaryChanged = summary !== turn.summary;

  if (!userChanged && !activitiesChanged && !summaryChanged) {
    return turn;
  }

  return {
    ...turn,
    user: userChanged
      ? {
          ...turn.user,
          content,
          ...(agentPrompt !== undefined ? { agentPrompt } : {}),
        }
      : turn.user,
    activities: activitiesChanged ? activities : turn.activities,
    summary: summaryChanged ? summary : turn.summary,
  };
}

function trimTurnActivities(turn: AgentTurn, maxBytes: number): AgentTurn {
  const { activities } = turn;

  if (activities.length === 0) {
    return turn;
  }

  let lo = 0;
  let hi = activities.length;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;

    if (JSON.stringify([{ ...turn, activities: activities.slice(mid) }]).length <= maxBytes) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  if (lo === 0) {
    return turn;
  }

  return { ...turn, activities: activities.slice(lo) };
}

function stripAttachmentDataUrls(turn: AgentTurn): AgentTurn {
  const attachments = turn.user.attachments;

  if (!attachments || attachments.length === 0) {
    return turn;
  }

  const hasHeavy = attachments.some((a) => a.dataUrl.length > 256);

  if (!hasHeavy) {
    return turn;
  }

  return {
    ...turn,
    user: {
      ...turn.user,
      attachments: attachments.map((a) =>
        a.dataUrl.length > 256 ? { ...a, dataUrl: '' } : a,
      ),
    },
  };
}

function stripPersistedAttachments(turns: AgentTurn[]): AgentTurn[] {
  if (turns.length <= 1) {
    return turns;
  }

  const lastIndex = turns.length - 1;

  return turns.map((turn, index) =>
    turn.running || index === lastIndex ? turn : stripAttachmentDataUrls(turn),
  );
}

function enforceByteBudget(turns: AgentTurn[], maxBytes: number): AgentTurn[] {
  if (JSON.stringify(turns).length <= maxBytes) {
    return turns;
  }

  let next = turns;

  while (next.length > 1) {
    next = next.slice(1);

    if (JSON.stringify(next).length <= maxBytes) {
      return next;
    }
  }

  const trimmedTurn = trimTurnActivities(next[0]!, maxBytes);

  if (JSON.stringify([trimmedTurn]).length > maxBytes) {
    return [{ ...trimmedTurn, activities: [] }];
  }

  return [trimmedTurn];
}

export function trimAgentTurnHistory(turns: AgentTurn[]): AgentTurn[] {
  if (turns.length === 0) {
    return turns;
  }

  const compacted = turns.map(compactTurnFields);
  const hasRunningTurn = compacted.some((turn) => turn.running);

  if (hasRunningTurn && compacted.length <= MAX_AGENT_TURN_HISTORY_COUNT) {
    return enforceByteBudget(stripPersistedAttachments(compacted), MAX_RUNNING_TURN_HISTORY_BYTES);
  }

  let next =
    compacted.length > MAX_AGENT_TURN_HISTORY_COUNT
      ? compacted.slice(-MAX_AGENT_TURN_HISTORY_COUNT)
      : compacted;

  next = stripPersistedAttachments(next);

  return enforceByteBudget(next, MAX_AGENT_TURN_HISTORY_BYTES);
}

export function sanitizeAgentTurnHistory(turns: AgentTurn[]): AgentTurn[] {
  return trimAgentTurnHistory(turns);
}

function collectAgentTurnSnapshots(projects: unknown): Map<string, string> {
  const snapshots = new Map<string, string>();

  if (!Array.isArray(projects)) {
    return snapshots;
  }

  for (const project of projects) {
    if (!project || typeof project !== 'object' || !Array.isArray((project as { tabs?: unknown }).tabs)) {
      continue;
    }

    for (const item of (project as { tabs: unknown[] }).tabs) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const tabItem = item as { type?: string; id?: string; panes?: unknown[]; turns?: unknown[] };

      if (tabItem.type === 'agent' && typeof tabItem.id === 'string') {
        snapshots.set(tabItem.id, JSON.stringify(tabItem.turns ?? []));
        continue;
      }

      if (tabItem.type === 'split' && Array.isArray(tabItem.panes)) {
        for (const pane of tabItem.panes) {
          if (!pane || typeof pane !== 'object') {
            continue;
          }

          const agentPane = pane as { type?: string; id?: string; turns?: unknown[] };

          if (agentPane.type === 'agent' && typeof agentPane.id === 'string') {
            snapshots.set(agentPane.id, JSON.stringify(agentPane.turns ?? []));
          }
        }
      }
    }
  }

  return snapshots;
}

export function agentTurnHistoryChanged(rawProjects: unknown, normalizedProjects: unknown): boolean {
  const rawSnapshots = collectAgentTurnSnapshots(rawProjects);
  const normalizedSnapshots = collectAgentTurnSnapshots(normalizedProjects);

  if (rawSnapshots.size !== normalizedSnapshots.size) {
    return true;
  }

  for (const [paneId, rawTurns] of rawSnapshots.entries()) {
    if (rawTurns !== normalizedSnapshots.get(paneId)) {
      return true;
    }
  }

  return false;
}
