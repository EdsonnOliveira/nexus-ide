import { ipcMain } from 'electron';
import { loadApiProjectData, saveApiProjectData } from '../services/apiProjectStore';
import { executeApiRequest } from '../services/apiRequest';
import type { ApiProjectData, ApiSendRequestPayload } from '../../types/api';

export function registerApiHandlers(): void {
  ipcMain.handle('api:loadProjectData', (_, projectId: string) => {
    if (typeof projectId !== 'string' || !projectId.trim()) {
      return loadApiProjectData('');
    }

    return loadApiProjectData(projectId);
  });

  ipcMain.handle('api:saveProjectData', (_, projectId: string, data: ApiProjectData) => {
    if (typeof projectId !== 'string' || !projectId.trim() || !data) {
      return;
    }

    saveApiProjectData(projectId, data);
  });

  ipcMain.handle('api:sendRequest', (_, payload: ApiSendRequestPayload) => {
    if (!payload?.request?.url) {
      throw new Error('Invalid API request payload.');
    }

    return executeApiRequest(payload);
  });
}
