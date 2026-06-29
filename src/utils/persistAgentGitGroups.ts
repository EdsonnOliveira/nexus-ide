import { useAgentGitChangeStore } from '@/stores/useAgentGitChangeStore';
import { useProjectStore } from '@/stores/useProjectStore';
import type { AgentGitChangeGroup, Project } from '@/types';

const pendingProjectIds = new Set<string>();
let flushTimer: number | null = null;

export function hydrateAgentGitGroupsFromProjects(projects: Project[]): void {
  const groupsByProject: Record<string, AgentGitChangeGroup[]> = {};

  for (const project of projects) {
    const groups = project.agentGitGroups ?? [];

    if (groups.length > 0) {
      groupsByProject[project.id] = groups;
    }
  }

  useAgentGitChangeStore.setState({ groupsByProject });
}

function clearPendingAgentGitFlushTimer(): void {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
}

function collectAgentGitProjectIds(projects: Project[]): Set<string> {
  const projectIds = new Set<string>();

  for (const project of projects) {
    projectIds.add(project.id);
  }

  const groupsByProject = useAgentGitChangeStore.getState().groupsByProject;

  for (const projectId of Object.keys(groupsByProject)) {
    projectIds.add(projectId);
  }

  for (const projectId of pendingProjectIds) {
    projectIds.add(projectId);
  }

  return projectIds;
}

export async function flushAgentGitGroupsToDisk(projects: Project[]): Promise<void> {
  clearPendingAgentGitFlushTimer();

  const projectIds = collectAgentGitProjectIds(projects);
  pendingProjectIds.clear();

  if (projectIds.size === 0) {
    return;
  }

  const groupsByProject = useAgentGitChangeStore.getState().groupsByProject;

  for (const projectId of projectIds) {
    const project = projects.find((entry) => entry.id === projectId);

    if (!project) {
      continue;
    }

    await window.nexus.projects.update(projectId, {
      agentGitGroups: groupsByProject[projectId] ?? [],
    });
  }
}

async function flushPendingAgentGitGroups(): Promise<void> {
  clearPendingAgentGitFlushTimer();

  if (pendingProjectIds.size === 0) {
    return;
  }

  const projectIds = [...pendingProjectIds];
  pendingProjectIds.clear();

  const { projects, updateProject } = useProjectStore.getState();
  const groupsByProject = useAgentGitChangeStore.getState().groupsByProject;

  for (const projectId of projectIds) {
    const project = projects.find((entry) => entry.id === projectId);

    if (!project) {
      continue;
    }

    await updateProject(projectId, {
      agentGitGroups: groupsByProject[projectId] ?? [],
    });
  }
}

export function schedulePersistAgentGitGroups(projectId: string): void {
  pendingProjectIds.add(projectId);

  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
  }

  flushTimer = window.setTimeout(() => {
    void flushPendingAgentGitGroups();
  }, 400);
}

export async function flushAgentGitGroupsForProjectSwitch(projects: Project[]): Promise<void> {
  await flushAgentGitGroupsToDisk(projects);
}

export async function flushAgentGitGroupsForLeavingProject(
  leavingProjectId: string,
  projects: Project[],
): Promise<void> {
  clearPendingAgentGitFlushTimer();

  const projectIds = new Set<string>([leavingProjectId]);

  for (const projectId of pendingProjectIds) {
    projectIds.add(projectId);
  }

  pendingProjectIds.clear();

  const groupsByProject = useAgentGitChangeStore.getState().groupsByProject;

  await Promise.all(
    [...projectIds].map(async (projectId) => {
      const project = projects.find((entry) => entry.id === projectId);

      if (!project) {
        return;
      }

      await window.nexus.projects.update(projectId, {
        agentGitGroups: groupsByProject[projectId] ?? [],
      });
    }),
  );
}

export async function flushAgentGitGroupsNow(): Promise<void> {
  clearPendingAgentGitFlushTimer();

  const { projects } = useProjectStore.getState();
  const groupsByProject = useAgentGitChangeStore.getState().groupsByProject;

  for (const project of projects) {
    pendingProjectIds.add(project.id);
  }

  for (const projectId of Object.keys(groupsByProject)) {
    pendingProjectIds.add(projectId);
  }

  await flushPendingAgentGitGroups();
}
