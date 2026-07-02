import type { AgentTab, AgentTurn, Tab, TabBarItem } from '@/types';

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
  return new TextEncoder().encode(JSON.stringify(turns)).length;
}

export function rawAgentTurnHistoryNeedsTrim(items: TabBarItem[]): boolean {
  for (const item of items) {
    const panes = item.type === 'split' ? item.panes : [item];

    for (const pane of panes) {
      if (pane.type !== 'agent') {
        continue;
      }

      const turns = pane.turns ?? [];

      if (turns.length > MAX_AGENT_TURN_HISTORY_COUNT) {
        return true;
      }

      if (measureAgentTurnHistoryBytes(turns) > MAX_AGENT_TURN_HISTORY_BYTES) {
        return true;
      }

      if (isHeavyAgentTranscript(turns)) {
        return true;
      }
    }
  }

  return false;
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

function trimAgentTab(tab: Tab): Tab {
  if (tab.type !== 'agent') {
    return tab;
  }

  const turns = sanitizeAgentTurnHistory(tab.turns ?? []);

  if (turns === tab.turns && !(turns.length === 0 && tab.ptyId)) {
    return tab;
  }

  return { ...tab, turns, ptyId: turns.length === 0 ? null : tab.ptyId };
}

export function trimAgentTurnsInTabBarItems(items: TabBarItem[]): TabBarItem[] {
  return items.map((item) => {
    if (item.type === 'split') {
      return {
        ...item,
        panes: item.panes.map((pane) => trimAgentTab(pane)),
      };
    }

    return trimAgentTab(item);
  });
}

export function trimAgentTabState(tab: AgentTab): AgentTab {
  const turns = sanitizeAgentTurnHistory(tab.turns ?? []);

  if (turns === tab.turns && !(turns.length === 0 && tab.ptyId)) {
    return tab;
  }

  return { ...tab, turns, ptyId: turns.length === 0 ? null : tab.ptyId };
}

export function resolveSanitizedAgentTab(tab: AgentTab): AgentTab {
  return trimAgentTabState(tab);
}
