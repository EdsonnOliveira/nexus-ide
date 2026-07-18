import { ipcMain } from 'electron';
import {
  getLocalRuntimeStatus,
  listOpenAgentSessionsFromRuntime,
} from '../services/cloudRuntimeClient';

export function registerCloudHandlers(): void {
  ipcMain.handle('cloud:getLocalRuntimeStatus', async () => getLocalRuntimeStatus());
  ipcMain.handle('cloud:pingRuntime', async () => {
    const status = await getLocalRuntimeStatus();
    return status.online;
  });
  ipcMain.handle('cloud:listOpenAgentSessions', async () => listOpenAgentSessionsFromRuntime());
}
