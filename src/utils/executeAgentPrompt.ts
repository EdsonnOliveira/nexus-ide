import { useProjectStore } from '@/stores/useProjectStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import type { Project } from '@/types';
import { attachAgentPromptImagesToPane } from '@/utils/attachAgentPromptImage';
import { collectOpenAgentPanes } from '@/utils/collectOpenAgentPanes';
import { resolveAgentLaunchCommand } from '@/utils/resolveAgentLaunchCommand';
import { getTerminalHandle } from '@/utils/terminalHandleRegistry';
import { resetAgentReadyDetectors } from '@/utils/terminalTaskCompletion';
import { collectProjectPanes } from '@/utils/tabGroups';

const PANE_FOCUS_DELAY_MS = 100;
const SETUP_COMMAND_DELAY_MS = 220;
const PROMPT_EXTRA_DELAY_MS = 320;
const AGENT_SUBMIT_KEY = '\r';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function waitForWritableHandle(
  paneId: string,
  attempts = 120,
): Promise<NonNullable<ReturnType<typeof getTerminalHandle>> | null> {
  return new Promise((resolve) => {
    let remaining = attempts;

    const tryResolve = () => {
      const handle = getTerminalHandle(paneId);

      if (handle?.isWritable()) {
        resolve(handle);
        return;
      }

      remaining -= 1;

      if (remaining <= 0) {
        resolve(handle);
        return;
      }

      window.requestAnimationFrame(tryResolve);
    };

    tryResolve();
  });
}

function waitForActiveAgent(paneId: string, attempts = 150): Promise<boolean> {
  return new Promise((resolve) => {
    let remaining = attempts;

    const tryResolve = () => {
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

function waitForIdleAgent(paneId: string, attempts = 150): Promise<boolean> {
  return new Promise((resolve) => {
    let remaining = attempts;

    const tryResolve = () => {
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

interface ExecuteAgentPromptOptions {
  project: Project;
  prompt: string;
  paneId?: string | null;
  createNew?: boolean;
  imageDataUrls?: string[];
  addAgentTab: (command: string) => Promise<void>;
  selectPane: (paneId: string) => Promise<void>;
}

export async function executeAgentPrompt({
  project,
  prompt,
  paneId: preferredPaneId = null,
  createNew = false,
  imageDataUrls = [],
  addAgentTab,
  selectPane,
}: ExecuteAgentPromptOptions): Promise<boolean> {
  const trimmedPrompt = prompt.trim();
  const hasImages = imageDataUrls.length > 0;

  if (!trimmedPrompt && !hasImages) {
    return false;
  }

  let paneId = !createNew ? preferredPaneId : null;

  if (!paneId) {
    const openAgents = collectOpenAgentPanes(project);

    if (!createNew && openAgents.length > 0) {
      paneId = openAgents[0]?.pane.id ?? null;
    }
  }

  if (!paneId) {
    const command = await resolveAgentLaunchCommand(project.path);
    resetAgentReadyDetectors('');
    await addAgentTab(command);
    await delay(PANE_FOCUS_DELAY_MS);

    const refreshedProject = useProjectStore.getState().getActiveProject();

    if (!refreshedProject) {
      return false;
    }

    paneId =
      collectOpenAgentPanes(refreshedProject)[0]?.pane.id ??
      refreshedProject.activeTabId ??
      null;
  }

  if (!paneId) {
    return false;
  }

  await selectPane(paneId);
  await delay(PANE_FOCUS_DELAY_MS);

  const handle = await waitForWritableHandle(paneId);

  if (!handle?.isWritable()) {
    return false;
  }

  await waitForActiveAgent(paneId);
  await waitForIdleAgent(paneId);
  handle.focus();

  resetAgentReadyDetectors(paneId);
  await delay(SETUP_COMMAND_DELAY_MS);

  if (trimmedPrompt) {
    handle.write(trimmedPrompt);
  }

  if (hasImages) {
    await attachAgentPromptImagesToPane(project.path, paneId, imageDataUrls, true);
    await delay(PROMPT_EXTRA_DELAY_MS);
  }

  if (!trimmedPrompt && !hasImages) {
    return false;
  }

  handle.write(AGENT_SUBMIT_KEY);
  useTerminalSessionStore.getState().markAwaitingResponse(paneId);

  return true;
}
