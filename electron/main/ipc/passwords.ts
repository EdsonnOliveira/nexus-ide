import { ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { passwordCredentialStore } from '../services/passwordCredentialStore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const browserGuestPreload = pathToFileURL(
  path.join(__dirname, '../preload/browser-guest.cjs'),
).toString();

export function registerPasswordHandlers(): void {
  ipcMain.handle(
    'passwords:getValues',
    (_event, projectId: string, collectionId: string): Record<string, string> => {
      return passwordCredentialStore.getValues(projectId, collectionId);
    },
  );

  ipcMain.handle(
    'passwords:saveValues',
    (_event, projectId: string, collectionId: string, values: Record<string, string>) => {
      passwordCredentialStore.saveValues(projectId, collectionId, values);
    },
  );

  ipcMain.handle(
    'passwords:deleteValues',
    (_event, projectId: string, collectionId: string) => {
      passwordCredentialStore.deleteValues(projectId, collectionId);
    },
  );

  ipcMain.handle('passwords:getGuestPreloadPath', (): string => browserGuestPreload);
}
