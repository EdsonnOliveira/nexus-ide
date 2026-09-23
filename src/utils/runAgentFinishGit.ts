import { buildAgentSkillPrompt } from '@/utils/agentCliSession';
import {
  acceptAgentPanePlan,
  hasAgentPaneSubmit,
  rejectAgentPanePlan,
  submitAgentPanePrompt,
  submitAgentPaneQuestion,
} from '@/utils/agentPaneRegistry';
import { executeHomeDashboardAgentPrompt } from '@/utils/executeHomeDashboardAgentPrompt';
import { isComputerProject } from '@/utils/computerProject';
import { isHomeBoundAgentPane, moveAgentPaneToMaestro } from '@/utils/homeDashboardAgents';
import { useProjectNotificationStore } from '@/stores/useProjectNotificationStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { findPaneTab } from '@/utils/tabGroups';

const GIT_SKILL_COMMAND = '/git';
const SUBMIT_ATTEMPTS = 80;
const SUBMIT_POLL_MS = 50;
const ANSWER_PREFIX = 'answer:';

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

  if (isComputerProject(project)) {
    return;
  }
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

export interface AgentFinishActionInput {
  action: string;
  projectId: string;
  paneId: string;
  kind?: 'git' | 'plan' | 'question';
  activityId?: string;
  questionId?: string;
}

export async function runAgentFinishAction(
  payload: AgentFinishActionInput,
  deps: AgentFinishGitDeps,
): Promise<void> {
  if (payload.action === 'git') {
    await runAgentFinishGit(payload.projectId, payload.paneId, deps);
    return;
  }

  if (payload.action === 'open') {
    await openAgentFinishPane(payload.projectId, payload.paneId, deps.selectPane);
    return;
  }

  useProjectNotificationStore.getState().clearProjectNotification(payload.projectId);

  if (payload.projectId) {
    await focusFinishedAgent(payload.projectId, payload.paneId, deps.selectPane);
  }

  if (!payload.paneId || !(await waitForSubmit(payload.paneId))) {
    return;
  }

  if (payload.action === 'plan-accept' && payload.activityId) {
    await acceptAgentPanePlan(payload.paneId, payload.activityId);
    return;
  }

  if (payload.action === 'plan-reject' && payload.activityId) {
    rejectAgentPanePlan(payload.paneId, payload.activityId);
    return;
  }

  if (!payload.activityId || !payload.questionId) {
    return;
  }

  const optionId = payload.action.startsWith(ANSWER_PREFIX)
    ? payload.action.slice(ANSWER_PREFIX.length)
    : payload.action;
  if (!optionId) {
    return;
  }

  await submitAgentPaneQuestion(payload.paneId, payload.activityId, {
    [payload.questionId]: optionId,
  });
}
