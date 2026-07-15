import type { Project } from '@/types';
import { isProjectSurfaceNotification } from '@/utils/homeDashboardAgents';

export function buildSidebarProjects(
  projects: Project[],
  filteredProjects: Project[],
  activeProjectId: string | null,
  notifiedAgentPaneByProject: Record<string, string>,
  selectingProjectId: string | null = null,
): Project[] {
  const allowedIds = new Set(filteredProjects.map((project) => project.id));

  if (activeProjectId) {
    allowedIds.add(activeProjectId);
  }

  if (selectingProjectId) {
    allowedIds.add(selectingProjectId);
  }

  for (const project of projects) {
    if (isProjectSurfaceNotification(project.id, notifiedAgentPaneByProject[project.id])) {
      allowedIds.add(project.id);
    }
  }

  return projects.filter((project) => allowedIds.has(project.id));
}

export function getHiddenNotifiedProjects(
  projects: Project[],
  filteredProjects: Project[],
  notifiedAgentPaneByProject: Record<string, string>,
): Project[] {
  const visibleIds = new Set(filteredProjects.map((project) => project.id));

  return projects.filter(
    (project) =>
      isProjectSurfaceNotification(project.id, notifiedAgentPaneByProject[project.id]) &&
      !visibleIds.has(project.id),
  );
}

export function getNotifiedWorkspaceIds(
  projects: Project[],
  notifiedAgentPaneByProject: Record<string, string>,
): Set<string> {
  const workspaceIds = new Set<string>();

  for (const project of projects) {
    if (
      isProjectSurfaceNotification(project.id, notifiedAgentPaneByProject[project.id]) &&
      project.workspaceId
    ) {
      workspaceIds.add(project.workspaceId);
    }
  }

  return workspaceIds;
}

export function getRunningAgentWorkspaceIds(
  projects: Project[],
  runningAgentProjectIds: Set<string>,
): Set<string> {
  const workspaceIds = new Set<string>();

  for (const project of projects) {
    if (runningAgentProjectIds.has(project.id) && project.workspaceId) {
      workspaceIds.add(project.workspaceId);
    }
  }

  return workspaceIds;
}
