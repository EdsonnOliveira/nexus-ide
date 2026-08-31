import {
  createAgentStreamJsonParserState,
  type AgentStreamJsonParserState,
} from '@/utils/agentStreamJsonParser';

const stateByPane = new Map<string, AgentStreamJsonParserState>();
const incompleteContinueAtByPane = new Map<string, number>();
const INCOMPLETE_CONTINUE_LOCK_MS = 2_500;

export function getOrCreateAgentStreamJsonSession(paneId: string): AgentStreamJsonParserState {
  const existing = stateByPane.get(paneId);

  if (existing) {
    return existing;
  }

  const created = createAgentStreamJsonParserState();
  stateByPane.set(paneId, created);
  return created;
}

export function replaceAgentStreamJsonSession(paneId: string): AgentStreamJsonParserState {
  const created = createAgentStreamJsonParserState();
  stateByPane.set(paneId, created);
  return created;
}

export function clearAgentStreamJsonSession(paneId: string): void {
  stateByPane.delete(paneId);
  incompleteContinueAtByPane.delete(paneId);
}

export function beginAgentStreamJsonIncompleteContinue(paneId: string): boolean {
  const lastAt = incompleteContinueAtByPane.get(paneId) ?? 0;

  if (Date.now() - lastAt < INCOMPLETE_CONTINUE_LOCK_MS) {
    return false;
  }

  incompleteContinueAtByPane.set(paneId, Date.now());
  return true;
}

export function clearAgentStreamJsonIncompleteContinue(paneId: string): void {
  incompleteContinueAtByPane.delete(paneId);
}
