import type { AutomationAgentMode } from '@/constants/agentModes';
import { useTerminalPasteImageStore } from '@/stores/useTerminalPasteImageStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import type { Project, ProjectTask } from '@/types';
import {
  hasAgentPaneSubmit,
  runAgentPaneCommand,
  submitAgentPanePrompt,
} from '@/utils/agentPaneRegistry';
import { isCursorAgentStreamJsonCli } from '@/utils/agentCliSession';
import { resolveAgentTabCli } from '@/utils/agentTabHelpers';
import { toProjectRelativePath } from '@/utils/explorerRelativePath';
import { resolvePaneAgentCommand } from '@/utils/projectAgentStatus';
import { getTerminalHandle } from '@/utils/terminalHandleRegistry';
import { buildImagePathReference } from '@/utils/terminalPasteImageTokens';
import { resetAgentReadyDetectors } from '@/utils/terminalTaskCompletion';
import { collectProjectPanes } from '@/utils/tabGroups';
import { waitForActiveAgent, waitForAgentPaneReady } from '@/utils/waitForAgentPaneReady';

interface ExecuteTaskInAgentOptions {
  project: Project;
  task: ProjectTask;
  paneId: string;
  agentMode: AutomationAgentMode;
  selectPane: (paneId: string) => Promise<void>;
}

const SETUP_COMMAND_DELAY_MS = 220;
const PROMPT_EXTRA_DELAY_MS = 320;
const PANE_FOCUS_DELAY_MS = 100;

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

async function waitForAgentUiPane(paneId: string, attempts = 150): Promise<boolean> {
  return new Promise((resolve) => {
    let remaining = attempts;

    const tryResolve = () => {
      if (hasAgentPaneSubmit(paneId)) {
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

function ensurePaneAgentRegistered(project: Project, paneId: string): boolean {
  const pane = collectProjectPanes(project.tabs).find((item) => item.id === paneId);

  if (!pane) {
    return false;
  }

  const session = useTerminalSessionStore.getState();
  const agentCommand = resolvePaneAgentCommand(pane, session.activeAgentByPane);

  if (!agentCommand) {
    return false;
  }

  if (!session.activeAgentByPane[paneId]) {
    session.setActiveAgent(paneId, agentCommand);
  }

  return true;
}

async function buildTaskPrompt(project: Project, task: ProjectTask, paneId: string): Promise<string> {
  const lines = [`# ${task.title.trim()}`, ''];

  if (task.local?.dueDate) {
    lines.push(`Prazo: ${task.local.dueDate}`, '');
  }

  if (task.local?.priority?.trim()) {
    lines.push(`Prioridade: ${task.local.priority.trim()}`, '');
  }

  if (task.local?.labels && task.local.labels.length > 0) {
    lines.push(`Tags: ${task.local.labels.join(', ')}`, '');
  }

  if (task.description.trim()) {
    lines.push(task.description.trim(), '');
  }

  for (const attachment of task.attachments) {
    if (attachment.kind === 'image') {
      const relativePath = toProjectRelativePath(project.path, attachment.path);
      lines.push(buildImagePathReference(relativePath));

      const dataUrl = await window.nexus.files.readImageAsDataUrl(attachment.path);

      if (dataUrl) {
        useTerminalPasteImageStore.getState().addImage(paneId, dataUrl, {
          relativePath,
          absolutePath: attachment.path,
        });
      }

      continue;
    }

    const relativePath = toProjectRelativePath(project.path, attachment.path);
    lines.push(`@${relativePath}`);
  }

  return lines.join('\n').trim();
}

export async function executeTaskInAgent({
  project,
  task,
  paneId,
  agentMode,
  selectPane,
}: ExecuteTaskInAgentOptions): Promise<boolean> {
  if (!ensurePaneAgentRegistered(project, paneId)) {
    return false;
  }

  const pane = collectProjectPanes(project.tabs).find((item) => item.id === paneId);
  const isAgentUi = pane?.type === 'agent';

  await selectPane(paneId);
  await delay(PANE_FOCUS_DELAY_MS);

  if (isAgentUi) {
    const ready = await waitForAgentUiPane(paneId);

    if (!ready) {
      return false;
    }

    await waitForAgentPaneReady(paneId, { delayMs: SETUP_COMMAND_DELAY_MS });

    const prompt = await buildTaskPrompt(project, task, paneId);

    if (!prompt) {
      return false;
    }

    const usesStreamJson = isCursorAgentStreamJsonCli(resolveAgentTabCli(pane!));

    if (usesStreamJson) {
      useTerminalSessionStore.getState().setLastCommand(paneId, `/${agentMode}`);
    } else {
      runAgentPaneCommand(paneId, `/${agentMode}\n`);
      await delay(PROMPT_EXTRA_DELAY_MS);
    }

    return await submitAgentPanePrompt(paneId, prompt, { forceNewTurn: true });
  }

  const handle = await waitForWritableHandle(paneId);

  if (!handle?.isWritable()) {
    return false;
  }

  await waitForActiveAgent(paneId);

  handle.focus();

  const prompt = await buildTaskPrompt(project, task, paneId);

  if (!prompt) {
    return false;
  }

  resetAgentReadyDetectors(paneId);

  const writeLine = (line: string) => {
    handle.write(`${line}\n`);
    useTerminalSessionStore.getState().setLastCommand(paneId, line);
    useTerminalSessionStore.getState().markAwaitingResponse(paneId);
  };

  await delay(SETUP_COMMAND_DELAY_MS);
  writeLine(`/${agentMode}`);
  await delay(PROMPT_EXTRA_DELAY_MS);
  writeLine(prompt);

  return true;
}
