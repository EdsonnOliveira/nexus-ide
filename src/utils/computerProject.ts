import type { Project } from '@/types';

export const COMPUTER_PROJECT_ID = 'nexus-computer';
export const COMPUTER_PROJECT_NAME = 'Neste computador';

export function isComputerProjectId(projectId: string | null | undefined): boolean {
  return projectId === COMPUTER_PROJECT_ID;
}

export function isComputerProject(project: Pick<Project, 'id'> | null | undefined): boolean {
  return isComputerProjectId(project?.id);
}

export function listUserProjects(projects: Project[]): Project[] {
  return projects.filter((project) => !isComputerProject(project));
}
