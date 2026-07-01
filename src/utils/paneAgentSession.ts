import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';

export interface PaneAgentSessionSnapshot {
  agentPrintRunTokenByPane: Record<string, string>;
  agentBusyByPane: Record<string, boolean>;
  awaitingResponseByPane: Record<string, boolean>;
}

export function isPaneAgentSessionLive(
  paneId: string,
  session: PaneAgentSessionSnapshot,
): boolean {
  return Boolean(
    session.agentPrintRunTokenByPane[paneId] ||
      session.agentBusyByPane[paneId] ||
      session.awaitingResponseByPane[paneId],
  );
}

export function readPaneAgentSessionSnapshot(): PaneAgentSessionSnapshot {
  const session = useTerminalSessionStore.getState();

  return {
    agentPrintRunTokenByPane: session.agentPrintRunTokenByPane,
    agentBusyByPane: session.agentBusyByPane,
    awaitingResponseByPane: session.awaitingResponseByPane,
  };
}
