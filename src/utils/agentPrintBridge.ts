type AgentPrintDataHandler = (paneId: string, data: string, runToken: string) => void;

type AgentPrintDoneHandler = (
  paneId: string,
  payload: { code: number; error?: string; runToken: string },
) => void;

interface AgentPrintPaneHandlers {
  onData: AgentPrintDataHandler;
  onDone: AgentPrintDoneHandler;
}

type BufferedAgentPrintEvent =
  | { type: 'data'; runToken: string; data: string }
  | { type: 'done'; payload: { code: number; error?: string; runToken: string } };

const handlersByPane = new Map<string, AgentPrintPaneHandlers>();
const bufferByPane = new Map<string, BufferedAgentPrintEvent[]>();
const MAX_BUFFERED_DATA_CHARS = 2_000_000;
let bridgeInstalled = false;

function getOrCreateBuffer(paneId: string): BufferedAgentPrintEvent[] {
  const existing = bufferByPane.get(paneId);

  if (existing) {
    return existing;
  }

  const created: BufferedAgentPrintEvent[] = [];
  bufferByPane.set(paneId, created);
  return created;
}

function bufferDataChars(buffer: BufferedAgentPrintEvent[]): number {
  let total = 0;

  for (const event of buffer) {
    if (event.type === 'data') {
      total += event.data.length;
    }
  }

  return total;
}

function enqueueBufferedEvent(paneId: string, event: BufferedAgentPrintEvent): void {
  const buffer = getOrCreateBuffer(paneId);
  buffer.push(event);

  while (bufferDataChars(buffer) > MAX_BUFFERED_DATA_CHARS && buffer.length > 1) {
    const first = buffer[0];

    if (first?.type === 'done') {
      break;
    }

    buffer.shift();
  }
}

function flushBufferedEvents(paneId: string, handlers: AgentPrintPaneHandlers): void {
  const buffer = bufferByPane.get(paneId);

  if (!buffer || buffer.length === 0) {
    return;
  }

  bufferByPane.delete(paneId);

  for (const event of buffer) {
    if (event.type === 'data') {
      handlers.onData(paneId, event.data, event.runToken);
      continue;
    }

    handlers.onDone(paneId, event.payload);
  }
}

function dispatchData(paneId: string, data: string, runToken: string): void {
  const handlers = handlersByPane.get(paneId);

  if (handlers) {
    handlers.onData(paneId, data, runToken);
    return;
  }

  enqueueBufferedEvent(paneId, { type: 'data', runToken, data });
}

function dispatchDone(
  paneId: string,
  payload: { code: number; error?: string; runToken: string },
): void {
  const handlers = handlersByPane.get(paneId);

  if (handlers) {
    handlers.onDone(paneId, payload);
    return;
  }

  enqueueBufferedEvent(paneId, { type: 'done', payload });
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

export function clearAgentPrintBridgeBuffer(paneId: string): void {
  bufferByPane.delete(paneId);
}

export function registerAgentPrintPaneHandlers(
  paneId: string,
  handlers: AgentPrintPaneHandlers,
): () => void {
  ensureAgentPrintBridge();
  handlersByPane.set(paneId, handlers);
  flushBufferedEvents(paneId, handlers);

  return () => {
    if (handlersByPane.get(paneId) === handlers) {
      handlersByPane.delete(paneId);
    }
  };
}
