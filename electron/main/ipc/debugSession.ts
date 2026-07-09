import { ipcMain } from 'electron';
import { writeDebugSessionLog } from '../utils/debugSessionLog';

export function registerDebugSessionHandlers(): void {
  ipcMain.on('debug:sessionLog', (_, payload: Record<string, unknown>) => {
    writeDebugSessionLog(payload);
  });
}
