type AgentPrintDataHandler = (paneId: string, data: string, runToken: string) => void;

type AgentPrintDoneHandler = (
  paneId: string,
  payload: { code: number; error?: string; runToken: string },
) => void;

interface AgentPrintPaneHandlers {
  onData: AgentPrintDataHandler;
  onDone: AgentPrintDoneHandler;
}

const handlersByPane = new Map<string, AgentPrintPaneHandlers>();
let bridgeInstalled = false;

function dispatchData(paneId: string, data: string, runToken: string): void {
  handlersByPane.get(paneId)?.onData(paneId, data, runToken);
}

function dispatchDone(
  paneId: string,
  payload: { code: number; error?: string; runToken: string },
): void {
  handlersByPane.get(paneId)?.onDone(paneId, payload);
}

export function ensureAgentPrintBridge(): void {
  if (bridgeInstalled || typeof window === 'undefined' || !window.nexus) {
    return;
  }

  bridgeInstalled = true;

  window.nexus.agentPrint.onData((paneId, data, runToken) => {
    dispatchData(paneId, data, runToken);
  });

  window.nexus.agentPrint.onDone((paneId, payload) => {
    dispatchDone(paneId, payload);
  });
}

export function registerAgentPrintPaneHandlers(
  paneId: string,
  handlers: AgentPrintPaneHandlers,
): () => void {
  ensureAgentPrintBridge();
  handlersByPane.set(paneId, handlers);

  return () => {
    handlersByPane.delete(paneId);
  };
}
