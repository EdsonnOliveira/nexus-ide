import { useProjectStore } from '@/stores/useProjectStore';
import type { AgentTab, AgentTurn, Tab } from '@/types';
import { extractAgentFinalResponseText } from '@/utils/agentTurnSummary';
import { isAgentTurnActivelyRunning } from '@/utils/projectAgentStatus';
import { findPaneTab } from '@/utils/tabGroups';

const POLL_MS = 400;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

function asAgentTab(pane: Tab | null): AgentTab | null {
  if (!pane || pane.type !== 'agent') {
    return null;
  }
  return pane;
}

function getAgentPaneFromStores(paneId: string): AgentTab | null {
  const projects = useProjectStore.getState().projects;
  for (const project of projects) {
    const pane = findPaneTab(project.tabs, paneId);
    const agentPane = asAgentTab(pane);
    if (agentPane) {
      return agentPane;
    }
  }
  return null;
}

export function getAgentPaneLatestResponseText(paneId: string): string {
  const pane = getAgentPaneFromStores(paneId);
  const turns = pane?.turns ?? [];
  if (turns.length === 0) {
    return '';
  }

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (!turn || isAgentTurnActivelyRunning(turn)) {
      continue;
    }
    const text = extractAgentFinalResponseText(turn.activities ?? []);
    if (text.trim()) {
      return text.trim();
    }
  }

  return '';
}

export function isAgentPaneSettled(paneId: string): boolean {
  const pane = getAgentPaneFromStores(paneId);
  if (!pane) {
    return false;
  }

  const turns = pane.turns ?? [];
  if (turns.length === 0) {
    return false;
  }

  const latest = turns[turns.length - 1];
  if (!latest) {
    return false;
  }

  return !isAgentTurnActivelyRunning(latest);
}

export async function waitForAgentPaneSettled(
  paneId: string,
  options?: { timeoutMs?: number; turnCountBefore?: number },
): Promise<AgentTurn | null> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const turnCountBefore = options?.turnCountBefore ?? 0;
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const tick = () => {
      const pane = getAgentPaneFromStores(paneId);
      const turns = pane?.turns ?? [];

      if (turns.length > turnCountBefore) {
        const latest = turns[turns.length - 1];
        if (latest && !isAgentTurnActivelyRunning(latest)) {
          resolve(latest);
          return;
        }
      }

      if (Date.now() - startedAt >= timeoutMs) {
        resolve(null);
        return;
      }

      window.setTimeout(tick, POLL_MS);
    };

    tick();
  });
}

export async function waitForJarvisAgentAnswer(
  paneId: string,
  turnCountBefore: number,
): Promise<string> {
  const turn = await waitForAgentPaneSettled(paneId, { turnCountBefore });
  if (!turn) {
    return '';
  }

  return extractAgentFinalResponseText(turn.activities ?? []).trim();
}
