import type { AgentTab, AgentTurn, Tab, TabBarItem } from '@/types';

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
