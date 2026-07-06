import type { AgentTurn } from '../../types';

export const MAX_AGENT_TURN_HISTORY_COUNT = 30;
export const MAX_AGENT_TURN_HISTORY_BYTES = 2 * 1024 * 1024;
export const HEAVY_AGENT_TURN_THRESHOLD = 20;
export const HEAVY_AGENT_ACTIVITY_THRESHOLD = 120;

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

function stripOlderAttachments(turns: AgentTurn[]): AgentTurn[] {
  if (turns.length <= 1) {
    return turns;
  }

  const last = turns[turns.length - 1]!;
  const older = turns.slice(0, -1).map((t) => (t.running ? t : stripAttachmentDataUrls(t)));

  return [...older, last];
}

export function trimAgentTurnHistory(turns: AgentTurn[]): AgentTurn[] {
  if (turns.length === 0) {
    return turns;
  }

  const hasRunningTurn = turns.some((turn) => turn.running);

  if (hasRunningTurn && turns.length <= MAX_AGENT_TURN_HISTORY_COUNT) {
    return stripOlderAttachments(turns);
  }

  let next =
    turns.length > MAX_AGENT_TURN_HISTORY_COUNT
      ? turns.slice(-MAX_AGENT_TURN_HISTORY_COUNT)
      : [...turns];

  next = stripOlderAttachments(next);

  if (JSON.stringify(next).length <= MAX_AGENT_TURN_HISTORY_BYTES) {
    return next;
  }

  while (next.length > 1) {
    next = next.slice(1);

    if (JSON.stringify(next).length <= MAX_AGENT_TURN_HISTORY_BYTES) {
      return next;
    }
  }

  const trimmedTurn = trimTurnActivities(next[0]!, MAX_AGENT_TURN_HISTORY_BYTES);

  if (JSON.stringify([trimmedTurn]).length > MAX_AGENT_TURN_HISTORY_BYTES) {
    return [{ ...trimmedTurn, activities: [] }];
  }

  return [trimmedTurn];
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
