import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { resetAgentReadyDetectors } from '@/utils/terminalTaskCompletion';

export const AGENT_PANE_READY_DELAY_MS = 220;
export const AGENT_PANE_READY_ATTEMPTS = 150;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function waitForActiveAgent(
  paneId: string,
  attempts = AGENT_PANE_READY_ATTEMPTS,
  shouldAbort?: () => boolean,
): Promise<boolean> {
  return new Promise((resolve) => {
    let remaining = attempts;

    const tryResolve = () => {
      if (shouldAbort?.()) {
        resolve(false);
        return;
      }

      if (useTerminalSessionStore.getState().activeAgentByPane[paneId]) {
        resolve(true);
        return;
      }

      remaining -= 1;

      if (remaining <= 0) {
        resolve(false);
        return;
      }

      window.requestAnimationFrame(tryResolve);
    };

    tryResolve();
  });
}

export function waitForIdleAgent(
  paneId: string,
  attempts = AGENT_PANE_READY_ATTEMPTS,
  shouldAbort?: () => boolean,
): Promise<boolean> {
  return new Promise((resolve) => {
    let remaining = attempts;

    const tryResolve = () => {
      if (shouldAbort?.()) {
        resolve(false);
        return;
      }

      const session = useTerminalSessionStore.getState();

      if (!session.agentBusyByPane[paneId] && !session.awaitingResponseByPane[paneId]) {
        resolve(true);
        return;
      }

      remaining -= 1;

      if (remaining <= 0) {
        resolve(false);
        return;
      }

      window.requestAnimationFrame(tryResolve);
    };

    tryResolve();
  });
}

export async function waitForAgentPaneReady(
  paneId: string,
  options?: { resetDetectors?: boolean; delayMs?: number; shouldAbort?: () => boolean },
): Promise<boolean> {
  const resetDetectors = options?.resetDetectors ?? true;
  const delayMs = options?.delayMs ?? AGENT_PANE_READY_DELAY_MS;
  const shouldAbort = options?.shouldAbort;

  if (shouldAbort?.()) {
    return false;
  }

  const activeOk = await waitForActiveAgent(paneId, AGENT_PANE_READY_ATTEMPTS, shouldAbort);

  if (!activeOk || shouldAbort?.()) {
    return false;
  }

  const idleOk = await waitForIdleAgent(paneId, AGENT_PANE_READY_ATTEMPTS, shouldAbort);

  if (!idleOk || shouldAbort?.()) {
    return false;
  }

  if (resetDetectors) {
    resetAgentReadyDetectors(paneId);
  }

  if (delayMs > 0) {
    await delay(delayMs);
  }

  return !shouldAbort?.();
}
