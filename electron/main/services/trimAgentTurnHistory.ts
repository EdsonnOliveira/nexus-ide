import type { AgentTurn } from '../../types';

export const MAX_AGENT_TURN_HISTORY_COUNT = 5;
export const MAX_AGENT_TURN_HISTORY_BYTES = 512 * 1024;
export const HEAVY_AGENT_TURN_THRESHOLD = 4;
export const HEAVY_AGENT_ACTIVITY_THRESHOLD = 40;

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
  return Buffer.byteLength(JSON.stringify(turns), 'utf8');
}

function trimTurnActivities(turn: AgentTurn, maxBytes: number): AgentTurn {
  let activities = turn.activities;

  while (activities.length > 0 && measureAgentTurnHistoryBytes([{ ...turn, activities }]) > maxBytes) {
    activities = activities.slice(1);
  }

  return { ...turn, activities };
}

export function trimAgentTurnHistory(turns: AgentTurn[]): AgentTurn[] {
  if (turns.length === 0) {
    return turns;
  }

  let next =
    turns.length > MAX_AGENT_TURN_HISTORY_COUNT
      ? turns.slice(-MAX_AGENT_TURN_HISTORY_COUNT)
      : [...turns];

  while (next.length > 0 && measureAgentTurnHistoryBytes(next) > MAX_AGENT_TURN_HISTORY_BYTES) {
    if (next.length > 1) {
      next = next.slice(1);
      continue;
    }

    const trimmedTurn = trimTurnActivities(next[0]!, MAX_AGENT_TURN_HISTORY_BYTES);

    if (measureAgentTurnHistoryBytes([trimmedTurn]) > MAX_AGENT_TURN_HISTORY_BYTES) {
      return [{ ...trimmedTurn, activities: [] }];
    }

    return [trimmedTurn];
  }

  return next;
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
