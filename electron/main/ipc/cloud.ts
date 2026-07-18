import { ipcMain, app } from 'electron';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  getLocalRuntimeStatus,
  listOpenAgentSessionsFromRuntime,
} from '../services/cloudRuntimeClient';

export function getMobileReleaseSnapshotPath(): string {
  return path.join(app.getPath('userData'), 'mobile-release-snapshot.json');
}

export function registerCloudHandlers(): void {
  ipcMain.handle('cloud:getLocalRuntimeStatus', async () => getLocalRuntimeStatus());
  ipcMain.handle('cloud:pingRuntime', async () => {
    const status = await getLocalRuntimeStatus();
    return status.online;
  });
  ipcMain.handle('cloud:listOpenAgentSessions', async () => listOpenAgentSessionsFromRuntime());
  ipcMain.handle('cloud:writeMobileReleaseSnapshot', async (_, payload: unknown) => {
    const filePath = getMobileReleaseSnapshotPath();
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(payload ?? null), 'utf8');
    return { ok: true, path: filePath };
  });
}
