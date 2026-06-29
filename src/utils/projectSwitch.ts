import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';

let projectSwitchInFlight = false;

export function isProjectSwitching(): boolean {
  return projectSwitchInFlight;
}

export function beginProjectSwitch(): boolean {
  if (projectSwitchInFlight) {
    return false;
  }

  projectSwitchInFlight = true;
  return true;
}

export async function endProjectSwitch(): Promise<void> {
  if (!projectSwitchInFlight) {
    return;
  }

  projectSwitchInFlight = false;
  const { drainDeferredAgentGitTurns } = await import('@/utils/agentGitTurn');
  await drainDeferredAgentGitTurns();
}

export function countBusyAgentPanes(): number {
  const session = useTerminalSessionStore.getState();
  const counted = new Set<string>();

  for (const [paneId, busy] of Object.entries(session.agentBusyByPane)) {
    if (busy) {
      counted.add(paneId);
    }
  }

  for (const [paneId, awaiting] of Object.entries(session.awaitingResponseByPane)) {
    if (awaiting) {
      counted.add(paneId);
    }
  }

  return counted.size;
}
