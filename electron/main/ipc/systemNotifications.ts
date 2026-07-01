import { ipcMain } from 'electron';
import {
  deleteAllSystemNotifications,
  deleteSystemNotification,
  getSystemNotificationAppIcon,
  listSystemNotifications,
  openFullDiskAccessSettings,
  openSystemNotificationApp,
  revealFullDiskAccessAppInFinder,
} from '../services/systemNotifications';

export function registerSystemNotificationsHandlers(): void {
  ipcMain.handle('systemNotifications:list', (_, limit?: number) => listSystemNotifications(limit));
  ipcMain.handle('systemNotifications:getAppIcon', (_, appId: string, appLabel?: string) =>
    getSystemNotificationAppIcon(appId, appLabel),
  );
  ipcMain.handle('systemNotifications:delete', (_, id: string) => deleteSystemNotification(id));
  ipcMain.handle('systemNotifications:deleteAll', (_, limit?: number) =>
    deleteAllSystemNotifications(limit),
  );
  ipcMain.handle('systemNotifications:openApp', (_, appId: string) =>
    openSystemNotificationApp(appId),
  );
  ipcMain.handle('systemNotifications:openFullDiskAccessSettings', () =>
    openFullDiskAccessSettings(),
  );
  ipcMain.handle('systemNotifications:revealFullDiskAccessApp', () =>
    revealFullDiskAccessAppInFinder(),
  );
}
