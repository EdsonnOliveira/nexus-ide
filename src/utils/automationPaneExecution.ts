import { useAutomationExecutionStore } from '@/stores/useAutomationExecutionStore';
import type { Automation } from '@/types/automation';
import { buildAgentSetupCommands } from '@/utils/buildAgentSetupCommands';
import { collectPendingCommands } from '@/utils/buildAutomationTabs';

export function markAutomationPaneExecuting(paneId: string): void {
  useAutomationExecutionStore.getState().markAutomationPaneExecuting(paneId);
}

export function markAutomationPanesFromRun(automation: Automation): void {
  const paneIds = new Set<string>();

  for (const { paneId } of collectPendingCommands(automation)) {
    paneIds.add(paneId);
  }

  for (const step of automation.steps) {
    if (step.type === 'agent' && buildAgentSetupCommands(step).length > 0) {
      paneIds.add(step.id);
    }
  }

  for (const paneId of paneIds) {
    markAutomationPaneExecuting(paneId);
  }
}

export function handleAutomationPaneShellPrompt(paneId: string): void {
  void import('@/stores/useTerminalSessionStore').then(({ useTerminalSessionStore }) => {
    const session = useTerminalSessionStore.getState();
    const isAgent = Boolean(session.activeAgentByPane[paneId]);

    if (
      isAgent &&
      (session.awaitingResponseByPane[paneId] ||
        session.agentBusyByPane[paneId] ||
        session.agentNotifyEligibleByPane[paneId] ||
        session.pendingLaunchCommands[paneId])
    ) {
      return;
    }

    useAutomationExecutionStore.getState().clearAutomationPaneExecuting(paneId);
  });
}

export function handleAutomationPaneTaskComplete(paneId: string): void {
  useAutomationExecutionStore.getState().clearAutomationPaneExecuting(paneId);
}
