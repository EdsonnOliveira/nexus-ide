import { ipcMain } from 'electron';
import { dismissCliSetup, getCliSetupStatus, installOpenCode } from '../services/openCodeInstaller';

export function registerCliSetupHandlers(): void {
  ipcMain.handle('cliSetup:getStatus', () => getCliSetupStatus());
  ipcMain.handle('cliSetup:installOpenCode', () => installOpenCode());
  ipcMain.handle('cliSetup:dismissSetup', () => {
    dismissCliSetup();
  });
}
