import { ipcMain } from 'electron';
import { sessionStore } from '../services/sessionStore';

export function registerSessionHandlers(onFlushComplete: () => void): void {
  ipcMain.handle('session:getScrollback', (_, paneId: string) => {
    return sessionStore.getScrollback(paneId);
  });

  ipcMain.handle('session:saveScrollbacks', (_, entries: Record<string, string>) => {
    sessionStore.saveScrollbacks(entries);
  });

  ipcMain.handle('session:removePane', (_, paneId: string) => {
    sessionStore.removePane(paneId);
  });

  ipcMain.handle('session:flush-complete', () => {
    onFlushComplete();
  });
}
