import { dialog, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';

const IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'ico',
  'bmp',
  'tif',
  'tiff',
  'avif',
  'heic',
  'heif',
];

export function registerDialogHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('dialog:openDirectory', async () => {
    const window = getWindow();
    const result = await dialog.showOpenDialog(window ?? undefined, {
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle('dialog:openImage', async () => {
    const window = getWindow();
    const result = await dialog.showOpenDialog(window ?? undefined, {
      properties: ['openFile'],
      filters: [
        { name: 'Imagens', extensions: IMAGE_EXTENSIONS },
        { name: 'Todos os arquivos', extensions: ['*'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle('dialog:openFile', async () => {
    const window = getWindow();
    const result = await dialog.showOpenDialog(window ?? undefined, {
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle('dialog:openFiles', async () => {
    const window = getWindow();
    const result = await dialog.showOpenDialog(window ?? undefined, {
      properties: ['openFile', 'multiSelections'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths;
  });
}
