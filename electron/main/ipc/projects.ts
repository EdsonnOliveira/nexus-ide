import { ipcMain } from 'electron';
import { removeProjectLogo, saveProjectLogo, saveProjectLogoFromDataUrl } from '../services/logoStore';
import { projectStore } from '../services/projectStore';
import type { AppState, ProjectUpdatePayload } from '../../types';

export function registerProjectHandlers(): void {
  ipcMain.handle('projects:list', () => projectStore.list());

  ipcMain.handle('projects:add', (_, projectPath: string, workspaceId?: string | null) =>
    projectStore.add(projectPath, workspaceId),
  );

  ipcMain.handle('projects:remove', (_, id: string) => {
    const project = projectStore.list().projects.find((item) => item.id === id);
    removeProjectLogo(project?.logo ?? null);
    projectStore.remove(id);
  });

  ipcMain.handle('projects:select', (_, id: string) => {
    projectStore.select(id);
  });

  ipcMain.handle('projects:clearActiveProject', () => {
    projectStore.clearActiveProject();
  });

  ipcMain.handle('projects:selectWorkspace', (_, id: string | null) => {
    projectStore.selectWorkspace(id);
  });

  ipcMain.handle('projects:createWorkspace', (_, name: string) => projectStore.createWorkspace(name));

  ipcMain.handle('projects:removeWorkspace', (_, id: string) => {
    projectStore.removeWorkspace(id);
  });

  ipcMain.handle('projects:update', (_, id: string, data: ProjectUpdatePayload) =>
    projectStore.update(id, data),
  );

  ipcMain.handle(
    'projects:setSidebarVideoSession',
    (_, session: AppState['sidebarVideoSession']) => {
      projectStore.setSidebarVideoSession(session);
    },
  );

  ipcMain.handle('projects:saveLogo', async (_, projectId: string, sourcePath: string) => {
    const project = projectStore.list().projects.find((item) => item.id === projectId);

    if (!project) {
      throw new Error('Project not found');
    }

    if (project.logo) {
      removeProjectLogo(project.logo);
    }

    const logoPath = saveProjectLogo(projectId, sourcePath);
    projectStore.update(projectId, { logo: logoPath });

    return logoPath;
  });

  ipcMain.handle('projects:removeLogo', (_, logoPath: string | null) => {
    removeProjectLogo(logoPath);
  });

  ipcMain.handle('projects:saveLogoFromDataUrl', async (_, projectId: string, dataUrl: string) => {
    const project = projectStore.list().projects.find((item) => item.id === projectId);

    if (!project) {
      throw new Error('Project not found');
    }

    if (project.logo) {
      removeProjectLogo(project.logo);
    }

    const logoPath = saveProjectLogoFromDataUrl(projectId, dataUrl);
    projectStore.update(projectId, { logo: logoPath });

    return logoPath;
  });
}
