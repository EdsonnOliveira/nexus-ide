import {
  createAgentStreamJsonParserState,
  type AgentStreamJsonParserState,
} from '@/utils/agentStreamJsonParser';

const stateByPane = new Map<string, AgentStreamJsonParserState>();

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
}
