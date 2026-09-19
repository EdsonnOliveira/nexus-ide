import { buildAgentSkillPrompt } from '@/utils/agentCliSession';
import { hasAgentPaneSubmit, submitAgentPanePrompt } from '@/utils/agentPaneRegistry';
import { executeHomeDashboardAgentPrompt } from '@/utils/executeHomeDashboardAgentPrompt';
import { isHomeBoundAgentPane, moveAgentPaneToMaestro } from '@/utils/homeDashboardAgents';
import { useProjectNotificationStore } from '@/stores/useProjectNotificationStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { findPaneTab } from '@/utils/tabGroups';

const GIT_SKILL_COMMAND = '/git';
const SUBMIT_ATTEMPTS = 80;
const SUBMIT_POLL_MS = 50;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForSubmit(paneId: string): Promise<boolean> {
  for (let attempt = 0; attempt < SUBMIT_ATTEMPTS; attempt += 1) {
    if (hasAgentPaneSubmit(paneId)) {
      return true;
    }

    await delay(SUBMIT_POLL_MS);
  }

  return false;
}

export interface AgentFinishGitDeps {
  selectPane: (paneId: string) => Promise<void>;
  addAgentTabForProject: (projectId: string, command: string) => Promise<string | null>;
}

async function focusFinishedAgent(
  projectId: string,
  paneId: string,
  selectPane: (paneId: string) => Promise<void>,
): Promise<void> {
  if (isHomeBoundAgentPane(projectId, paneId)) {
    moveAgentPaneToMaestro(projectId, paneId);
    await useProjectStore.getState().leaveActiveProject();
    return;
  }

  await useProjectStore.getState().selectProject(projectId);
  await selectPane(paneId);
}

export async function openAgentFinishPane(
  projectId: string,
  paneId: string,
  selectPane: (paneId: string) => Promise<void>,
): Promise<void> {
  useProjectNotificationStore.getState().clearProjectNotification(projectId);

  if (!projectId) {
    return;
  }

  await focusFinishedAgent(projectId, paneId, selectPane);
}

export async function runAgentFinishGit(
  projectId: string,
  paneId: string,
  deps: AgentFinishGitDeps,
): Promise<void> {
  useProjectNotificationStore.getState().clearProjectNotification(projectId);

  const project = useProjectStore.getState().projects.find((item) => item.id === projectId);
  const prompt = buildAgentSkillPrompt(GIT_SKILL_COMMAND);
  const submitOptions = {
    displayContent: GIT_SKILL_COMMAND,
    skillLabel: GIT_SKILL_COMMAND,
    forceNewTurn: true,
  };

  if (projectId) {
    await focusFinishedAgent(projectId, paneId, deps.selectPane);
  }

  if (paneId && (await waitForSubmit(paneId))) {
    const submitted = await submitAgentPanePrompt(paneId, prompt, submitOptions);
    if (submitted) {
      return;
    }
  }

  if (!project) {
    return;
  }

  if (paneId && findPaneTab(project.tabs, paneId)) {
    return;
  }

  await executeHomeDashboardAgentPrompt({
    project,
    prompt,
    addAgentTabForProject: deps.addAgentTabForProject,
  });
}
