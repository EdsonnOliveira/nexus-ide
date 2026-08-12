import type { Project } from '@/types';
import { buildSidebarProjects } from '@/utils/projectNotificationVisibility';

const LOCAL_DEV_PORT_BASE = 3000;

export function getProjectCommandNumber(
  projects: Project[],
  projectId: string | null,
  activeWorkspaceId: string | null,
  notifiedAgentPaneByProject: Record<string, string> = {},
): number | null {
  if (!projectId) {
    return null;
  }

  const filteredProjects =
    activeWorkspaceId === null
      ? projects
      : projects.filter((project) => project.workspaceId === activeWorkspaceId);

  const sidebarProjects = buildSidebarProjects(
    projects,
    filteredProjects,
    projectId,
    notifiedAgentPaneByProject,
  );

  const index = sidebarProjects.findIndex((project) => project.id === projectId);

  if (index < 0) {
    return null;
  }

  return index + 1;
}

export function buildProjectLocalDevUrl(commandNumber: number): string {
  return `http://localhost:${LOCAL_DEV_PORT_BASE + commandNumber}`;
}

export function getSuggestedProjectLocalDevUrl(
  projects: Project[],
  projectId: string | null,
  activeWorkspaceId: string | null,
  notifiedAgentPaneByProject: Record<string, string> = {},
): string {
  const commandNumber = getProjectCommandNumber(
    projects,
    projectId,
    activeWorkspaceId,
    notifiedAgentPaneByProject,
  );

  if (commandNumber == null) {
    return `http://localhost:${LOCAL_DEV_PORT_BASE}`;
  }

  return buildProjectLocalDevUrl(commandNumber);
}
