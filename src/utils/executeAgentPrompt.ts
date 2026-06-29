import { useProjectStore } from '@/stores/useProjectStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import type { Project } from '@/types';
import { submitAgentPanePrompt, hasAgentPaneSubmit } from '@/utils/agentPaneRegistry';
import { attachAgentPromptImagesToPane } from '@/utils/attachAgentPromptImage';
import { collectOpenAgentPanes } from '@/utils/collectOpenAgentPanes';
import { resolveAgentLaunchCommand } from '@/utils/resolveAgentLaunchCommand';
import { getTerminalHandle } from '@/utils/terminalHandleRegistry';
import { resetAgentReadyDetectors } from '@/utils/terminalTaskCompletion';
import { findPaneTab } from '@/utils/tabGroups';
import { waitForAgentPaneReady } from '@/utils/waitForAgentPaneReady';

const PANE_FOCUS_DELAY_MS = 100;
const SETUP_COMMAND_DELAY_MS = 220;
const PROMPT_EXTRA_DELAY_MS = 320;
const AGENT_SUBMIT_KEY = '\r';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForWritablePane(paneId: string, attempts = 150): Promise<'agent-ui' | 'terminal' | null> {
  return new Promise((resolve) => {
    let remaining = attempts;

    const tryResolve = async () => {
      if (hasAgentPaneSubmit(paneId)) {
        const project = useProjectStore.getState().getActiveProject();
        const pane = project ? findPaneTab(project.tabs, paneId) : null;

        if (pane?.type === 'agent' && pane.ptyId && (await window.nexus.terminal.has(pane.ptyId))) {
          resolve('agent-ui');
          return;
        }
      }

      const handle = getTerminalHandle(paneId);

      if (handle?.isWritable()) {
        resolve('terminal');
        return;
      }

      remaining -= 1;

      if (remaining <= 0) {
        resolve(null);
        return;
      }

      window.requestAnimationFrame(() => {
        void tryResolve();
      });
    };

    void tryResolve();
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

  const writableMode = await waitForWritablePane(paneId);

  if (!writableMode) {
    return false;
  }

  await waitForAgentPaneReady(paneId, { delayMs: SETUP_COMMAND_DELAY_MS });

  if (writableMode === 'agent-ui') {
    if (hasImages) {
      await attachAgentPromptImagesToPane(project.path, paneId, imageDataUrls, false);
      await delay(PROMPT_EXTRA_DELAY_MS);
    }

    if (!trimmedPrompt && !hasImages) {
      return false;
    }

    if (trimmedPrompt) {
      return await submitAgentPanePrompt(paneId, trimmedPrompt);
    }

    return true;
  }

  const handle = getTerminalHandle(paneId);

  if (!handle?.isWritable()) {
    return false;
  }

  handle.focus();

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
