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

async function flushPendingAgentGitGroups(): Promise<void> {
  flushTimer = null;

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

export async function flushAgentGitGroupsNow(): Promise<void> {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }

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
