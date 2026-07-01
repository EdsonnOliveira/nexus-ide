import { ipcMain } from 'electron';
import {
  getCalendarEventsSnapshot,
  openCalendarEvent,
  openCalendarPrivacySettings,
  requestCalendarAccess,
} from '../services/appleCalendar';

export function registerCalendarHandlers(): void {
  ipcMain.handle('calendar:getTodayEvents', () => getCalendarEventsSnapshot());
  ipcMain.handle('calendar:requestAccess', () => requestCalendarAccess());
  ipcMain.handle('calendar:openEvent', (_, startAt: number) => openCalendarEvent(startAt));
  ipcMain.handle('calendar:openPrivacySettings', () => openCalendarPrivacySettings());
}
