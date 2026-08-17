import { useProjectStore } from '@/stores/useProjectStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import type { Project } from '@/types';
import { isCursorAgentStreamJsonCli } from '@/utils/agentCliSession';
import { submitAgentPanePrompt, hasAgentPaneSubmit } from '@/utils/agentPaneRegistry';
import { resolveAgentTabCli } from '@/utils/agentTabHelpers';
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
const WRITABLE_POLL_MS = 50;
const WRITABLE_ATTEMPTS = 80;
const SUBMIT_ATTEMPTS = 40;
const SUBMIT_POLL_MS = 50;
const AGENT_SUBMIT_KEY = '\r';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForWritablePane(paneId: string): Promise<'agent-ui' | 'terminal' | null> {
  for (let attempt = 0; attempt < WRITABLE_ATTEMPTS; attempt += 1) {
    if (hasAgentPaneSubmit(paneId)) {
      const project = useProjectStore.getState().getActiveProject();
      const pane = project ? findPaneTab(project.tabs, paneId) : null;

      if (pane?.type === 'agent') {
        if (isCursorAgentStreamJsonCli(resolveAgentTabCli(pane))) {
          return 'agent-ui';
        }

        if (pane.ptyId && (await window.nexus.terminal.has(pane.ptyId))) {
          return 'agent-ui';
        }
      }
    }

    const handle = getTerminalHandle(paneId);

    if (handle?.isWritable()) {
      return 'terminal';
    }

    await delay(WRITABLE_POLL_MS);
  }

  return null;
}

async function submitAgentUiPrompt(paneId: string, prompt: string): Promise<boolean> {
  for (let attempt = 0; attempt < SUBMIT_ATTEMPTS; attempt += 1) {
    if (!hasAgentPaneSubmit(paneId)) {
      await delay(SUBMIT_POLL_MS);
      continue;
    }

    const submitted = await submitAgentPanePrompt(paneId, prompt);

    if (submitted) {
      return true;
    }

    await delay(SUBMIT_POLL_MS);
  }

  return false;
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

    paneId = refreshedProject.activeTabId ?? null;
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
      return await submitAgentUiPrompt(paneId, trimmedPrompt);
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
