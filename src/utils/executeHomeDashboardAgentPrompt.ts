import type { Project } from '@/types';
import { hasAgentPaneSubmit, submitAgentPanePrompt } from '@/utils/agentPaneRegistry';
import { resolveAgentPaneRootPath } from '@/utils/agentTabHelpers';
import {
  buildAgentPromptImageMentionAppendFragment,
  hasAgentPromptImageMentions,
} from '@/utils/agentPromptImageBadge';
import { attachAgentPromptImagesToPane } from '@/utils/attachAgentPromptImage';
import { bindHomeDashboardProjectAgent } from '@/utils/homeDashboardAgents';
import { resolveAgentLaunchCommand } from '@/utils/resolveAgentLaunchCommand';
import { findPaneTab } from '@/utils/tabGroups';
import { resetAgentReadyDetectors } from '@/utils/terminalTaskCompletion';
import { waitForAgentPaneReady } from '@/utils/waitForAgentPaneReady';

const SUBMIT_ATTEMPTS = 80;
const SUBMIT_POLL_MS = 50;
const READY_DELAY_MS = 220;
const IMAGE_ATTACH_DELAY_MS = 120;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForHomeAgentSubmit(paneId: string): Promise<boolean> {
  for (let attempt = 0; attempt < SUBMIT_ATTEMPTS; attempt += 1) {
    if (hasAgentPaneSubmit(paneId)) {
      return true;
    }

    await delay(SUBMIT_POLL_MS);
  }

  return false;
}

interface ExecuteHomeDashboardAgentPromptOptions {
  project: Project;
  prompt: string;
  imageDataUrls?: string[];
  preferredPaneId?: string | null;
  addAgentTabForProject: (projectId: string, command: string) => Promise<string | null>;
  syncAgentWorkingDirectory?: (paneId: string, workingDirectory: string) => Promise<void>;
}

export async function executeHomeDashboardAgentPrompt({
  project,
  prompt,
  imageDataUrls = [],
  preferredPaneId = null,
  addAgentTabForProject,
  syncAgentWorkingDirectory,
}: ExecuteHomeDashboardAgentPromptOptions): Promise<string | null> {
  const trimmedPrompt = prompt.trim();
  const hasImages = imageDataUrls.length > 0;

  if (!trimmedPrompt && !hasImages) {
    return null;
  }

  let paneId =
    preferredPaneId && findPaneTab(project.tabs, preferredPaneId)?.type === 'agent'
      ? preferredPaneId
      : null;

  if (!paneId) {
    const command = await resolveAgentLaunchCommand(project.path);
    resetAgentReadyDetectors('');
    paneId = await addAgentTabForProject(project.id, command);
  }

  if (!paneId) {
    return null;
  }

  const workingDirectory = resolveAgentPaneRootPath(project.path);

  if (syncAgentWorkingDirectory) {
    await syncAgentWorkingDirectory(paneId, workingDirectory);
  }

  bindHomeDashboardProjectAgent(project.id, paneId);

  const ready = await waitForHomeAgentSubmit(paneId);

  if (!ready) {
    return paneId;
  }

  await waitForAgentPaneReady(paneId, { delayMs: READY_DELAY_MS });

  let finalPrompt = trimmedPrompt;

  if (hasImages) {
    const attached = await attachAgentPromptImagesToPane(
      project.path,
      paneId,
      imageDataUrls,
      false,
    );

    if (attached.length > 0) {
      await delay(IMAGE_ATTACH_DELAY_MS);

      if (!hasAgentPromptImageMentions(trimmedPrompt)) {
        let mentionPrefix = '';

        for (const image of attached) {
          mentionPrefix = `${mentionPrefix}${buildAgentPromptImageMentionAppendFragment(mentionPrefix, image.imageNumber)}`;
        }

        finalPrompt = trimmedPrompt
          ? `${mentionPrefix}${trimmedPrompt}`
          : mentionPrefix.trim();
      }
    }
  }

  if (!finalPrompt.trim()) {
    return paneId;
  }

  await submitAgentPanePrompt(paneId, finalPrompt);

  return paneId;
}
