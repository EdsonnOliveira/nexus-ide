import { clipboard, ipcMain, webContents } from 'electron';
import { probeUrlReachable } from '../services/browserProbe';

export function registerBrowserHandlers(): void {
  ipcMain.handle('browser:probeUrl', (_, url: string) => {
    if (typeof url !== 'string' || !url.trim()) {
      return false;
    }

    return probeUrlReachable(url.trim());
  });

  ipcMain.handle(
    'browser:openDevTools',
    (_, guestWebContentsId: number, devtoolsWebContentsId: number) => {
      const guest = webContents.fromId(guestWebContentsId);
      const devtoolsTarget = webContents.fromId(devtoolsWebContentsId);

      if (!guest || guest.isDestroyed()) {
        throw new Error('Guest web contents not found');
      }

      if (!devtoolsTarget || devtoolsTarget.isDestroyed()) {
        throw new Error('DevTools web contents not found');
      }

      guest.setDevToolsWebContents(devtoolsTarget);
      guest.openDevTools();
    },
  );

  ipcMain.handle('browser:closeDevTools', (_, guestWebContentsId: number) => {
    const guest = webContents.fromId(guestWebContentsId);

    if (!guest || guest.isDestroyed()) {
      return;
    }

    guest.closeDevTools();
  });

  ipcMain.handle('browser:captureScreenshot', async (_, guestWebContentsId: number) => {
    const guest = webContents.fromId(guestWebContentsId);

    if (!guest || guest.isDestroyed()) {
      return false;
    }

    try {
      const image = await guest.capturePage();

      if (image.isEmpty()) {
        return false;
      }

      clipboard.writeImage(image);
      return true;
    } catch {
      return false;
    }
  });
}
