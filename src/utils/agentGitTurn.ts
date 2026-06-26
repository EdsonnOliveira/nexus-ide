import { useAgentGitChangeStore } from '@/stores/useAgentGitChangeStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { resolveRepoPathForAgentTurn } from '@/utils/agentGitDiff';
import { findProjectIdByPaneId } from '@/utils/findProjectIdByPaneId';
import { persistTerminalCommand } from '@/utils/persistTerminalSession';
import { resolvePaneAgentForGitTurn } from '@/utils/projectAgentStatus';
import { sanitizeAgentPrompt } from '@/utils/terminalShellPrompt';

const finalizeTurnInFlight = new Map<string, Promise<void>>();

async function beginAgentGitTurn(paneId: string, prompt: string): Promise<void> {
  const projectId = findProjectIdByPaneId(paneId);

  if (!projectId) {
    return;
  }

  const project = useProjectStore.getState().projects.find((entry) => entry.id === projectId);

  if (!project) {
    return;
  }

  const repoPath = await resolveRepoPathForAgentTurn(project.path, paneId);

  if (!repoPath) {
    return;
  }

  await useAgentGitChangeStore.getState().beginTurn(paneId, projectId, prompt, repoPath);
}

export function trackAgentGitPrompt(paneId: string, prompt: string): void {
  const trimmed = sanitizeAgentPrompt(prompt);

  if (!trimmed || trimmed.startsWith('/')) {
    return;
  }

  const session = useTerminalSessionStore.getState();
  const activeAgent = resolvePaneAgentForGitTurn(
    paneId,
    useProjectStore.getState().projects,
    session.activeAgentByPane,
  );

  if (!activeAgent) {
    return;
  }

  if (!session.activeAgentByPane[paneId]) {
    session.setActiveAgent(paneId, activeAgent);
  }

  persistTerminalCommand(paneId, trimmed);
  useAgentGitChangeStore.getState().rememberPrompt(paneId, trimmed);
  void beginAgentGitTurn(paneId, trimmed);
}

export function completeAgentGitTurn(paneId: string): void {
  const existing = finalizeTurnInFlight.get(paneId);

  if (existing) {
    return;
  }

  const task = useAgentGitChangeStore.getState().finalizeTurn(paneId);
  finalizeTurnInFlight.set(paneId, task);

  void task.finally(() => {
    if (finalizeTurnInFlight.get(paneId) === task) {
      finalizeTurnInFlight.delete(paneId);
    }
  });
}
