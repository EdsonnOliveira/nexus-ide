import { ipcMain } from 'electron';
import { getAiProviderUsage } from '../services/aiProviderUsage';

export function registerAiUsageHandlers(): void {
  ipcMain.handle('aiUsage:getSnapshot', (_, force?: boolean) => getAiProviderUsage(Boolean(force)));
}
