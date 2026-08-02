import type { AgentTurn } from '@/types';

const ACTIVE_TURN_BOTTOM_THRESHOLD_PX = 96;

export function resolveActiveAgentTurnId(
  container: HTMLElement,
  turns: AgentTurn[],
  turnElements: Map<string, HTMLElement>,
): string | null {
  if (turns.length === 0) {
    return null;
  }

  const lastTurnId = turns[turns.length - 1]?.id ?? null;
  const distanceFromBottom =
    container.scrollHeight - container.scrollTop - container.clientHeight;

  if (distanceFromBottom <= ACTIVE_TURN_BOTTOM_THRESHOLD_PX) {
    return lastTurnId;
  }

  const containerRect = container.getBoundingClientRect();
  const focusY = containerRect.top + Math.min(140, container.clientHeight * 0.32);
  let containingId: string | null = null;
  let crossedId: string | null = null;
  let crossedTop = Number.NEGATIVE_INFINITY;
  let firstVisibleId: string | null = null;

  for (const turn of turns) {
    const element = turnElements.get(turn.id);

    if (!element) {
      continue;
    }

    const rect = element.getBoundingClientRect();
    const isVisible =
      rect.bottom > containerRect.top + 8 && rect.top < containerRect.bottom - 8;

    if (isVisible && !firstVisibleId) {
      firstVisibleId = turn.id;
    }

    if (rect.top <= focusY && rect.bottom > focusY) {
      containingId = turn.id;
    }

    if (rect.top <= focusY && rect.top >= crossedTop) {
      crossedTop = rect.top;
      crossedId = turn.id;
    }
  }

  if (containingId) {
    return containingId;
  }

  if (crossedId) {
    return crossedId;
  }

  if (firstVisibleId) {
    return firstVisibleId;
  }

  return lastTurnId;
}
