import { useAgentShellTerminalStore } from '@/stores/useAgentShellTerminalStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { registerTerminalHandle } from '@/utils/terminalHandleRegistry';

function isLiveInteractiveStatus(status: string): boolean {
  return status === 'starting' || status === 'running';
}

export function ensureAgentInteractiveTerminal(
  agentPaneId: string,
  projectPath: string,
): string {
  const store = useAgentShellTerminalStore.getState();
  const entries = store.getEntries(agentPaneId);
  const liveInteractive = entries.find(
    (entry) => entry.kind === 'interactive' && isLiveInteractiveStatus(entry.status),
  );

  if (liveInteractive) {
    return liveInteractive.paneId;
  }

  for (const entry of entries) {
    if (entry.kind !== 'interactive') {
      continue;
    }

    if (entry.ptyId) {
      window.nexus.terminal.kill(entry.ptyId);
    }

    useTerminalSessionStore.getState().disposePaneSession(entry.paneId);
    registerTerminalHandle(entry.paneId, null);
    store.removeEntry(agentPaneId, entry.paneId);
  }

  const paneId = crypto.randomUUID();
  const cwd = projectPath.trim();

  store.addEntry(agentPaneId, {
    paneId,
    kind: 'interactive',
    command: '',
    title: 'Terminal',
    cwd,
    startedAt: Date.now(),
    status: 'running',
    exitCode: null,
    ptyId: null,
    commandDispatched: false,
    dispatchedAt: null,
    launchRetryCount: 0,
  });

  return paneId;
}

export function disposeAgentShellTerminals(agentPaneId: string): void {
  const entries = useAgentShellTerminalStore.getState().clearEntries(agentPaneId);

  for (const entry of entries) {
    if (entry.ptyId) {
      window.nexus.terminal.kill(entry.ptyId);
    }

    useTerminalSessionStore.getState().disposePaneSession(entry.paneId);
    registerTerminalHandle(entry.paneId, null);
  }

  void window.nexus.terminal.removeAgentShellHome(agentPaneId);
}
