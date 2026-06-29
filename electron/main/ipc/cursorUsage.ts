import { ipcMain } from 'electron';
import { getCursorPeriodUsage } from '../services/cursorUsage';

export function registerCursorUsageHandlers(): void {
  ipcMain.handle('cursorUsage:getCurrentPeriod', (_, force?: boolean) =>
    getCursorPeriodUsage(Boolean(force)),
  );
}
