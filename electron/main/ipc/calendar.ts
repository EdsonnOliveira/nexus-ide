import { ipcMain } from 'electron';
import {
  createCalendarEvent,
  deleteCalendarEvent,
  getCalendarCalendarsSnapshot,
  getCalendarEventsInRange,
  getCalendarEventsSnapshot,
  openCalendarEvent,
  openCalendarPrivacySettings,
  requestCalendarAccess,
  updateCalendarEvent,
} from '../services/appleCalendar';
import type {
  CalendarCreateEventInput,
  CalendarDeleteEventInput,
  CalendarUpdateEventInput,
} from '../../types';

export function registerCalendarHandlers(): void {
  ipcMain.handle('calendar:getTodayEvents', () => getCalendarEventsSnapshot());
  ipcMain.handle('calendar:requestAccess', () => requestCalendarAccess());
  ipcMain.handle('calendar:getCalendars', () => getCalendarCalendarsSnapshot());
  ipcMain.handle('calendar:getEventsInRange', (_, startAt: number, endAt: number) =>
    getCalendarEventsInRange(startAt, endAt),
  );
  ipcMain.handle('calendar:createEvent', (_, input: CalendarCreateEventInput) => createCalendarEvent(input));
  ipcMain.handle('calendar:updateEvent', (_, input: CalendarUpdateEventInput) => updateCalendarEvent(input));
  ipcMain.handle('calendar:deleteEvent', (_, input: CalendarDeleteEventInput) => deleteCalendarEvent(input));
  ipcMain.handle('calendar:openEvent', (_, startAt: number) => openCalendarEvent(startAt));
  ipcMain.handle('calendar:openPrivacySettings', () => openCalendarPrivacySettings());
}
