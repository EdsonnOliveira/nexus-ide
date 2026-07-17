import { ipcMain, type BrowserWindow } from 'electron';
import type { EmulatorPlatform } from '../../types';
import { getEmulatorSetupStatus, listEmulatorDevices, recordEmulatorDeviceUsage } from '../services/emulatorDevices';
import { emulatorSessionManager } from '../services/emulatorSessionManager';

type WindowGetter = () => BrowserWindow | null;

export function registerEmulatorHandlers(getWindow: WindowGetter): void {
  emulatorSessionManager.setWindowGetter(getWindow);

  ipcMain.handle('emulator:getSetupStatus', () => {
    return getEmulatorSetupStatus();
  });

  ipcMain.handle('emulator:listDevices', (_event, platform: EmulatorPlatform) => {
    return listEmulatorDevices(platform);
  });

  ipcMain.handle(
    'emulator:recordDeviceUsage',
    (_event, platform: EmulatorPlatform, deviceId: string) => {
      recordEmulatorDeviceUsage(platform, deviceId);
    },
  );

  ipcMain.handle(
    'emulator:start',
    async (_event, tabId: string, platform: EmulatorPlatform, deviceId: string) => {
      return emulatorSessionManager.start(tabId, platform, deviceId);
    },
  );

  ipcMain.handle('emulator:stop', async (_event, sessionId: string) => {
    await emulatorSessionManager.stop(sessionId);
  });

  ipcMain.handle('emulator:stopByTabId', async (_event, tabId: string) => {
    await emulatorSessionManager.stopByTabId(tabId);
  });

  ipcMain.handle('emulator:attachTab', (_event, tabId: string) => {
    return emulatorSessionManager.attachTab(tabId);
  });

  ipcMain.handle('emulator:tap', async (_event, sessionId: string, x: number, y: number) => {
    await emulatorSessionManager.tap(sessionId, x, y);
  });

  ipcMain.handle(
    'emulator:swipe',
    async (
      _event,
      sessionId: string,
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      durationMs: number,
    ) => {
      await emulatorSessionManager.swipe(sessionId, x1, y1, x2, y2, durationMs);
    },
  );

  ipcMain.handle('emulator:pressHome', async (_event, sessionId: string) => {
    await emulatorSessionManager.pressHome(sessionId);
  });

  ipcMain.handle('emulator:pressAppSwitcher', async (_event, sessionId: string) => {
    await emulatorSessionManager.pressAppSwitcher(sessionId);
  });

  ipcMain.handle('emulator:pressBack', async (_event, sessionId: string) => {
    await emulatorSessionManager.pressBack(sessionId);
  });

  ipcMain.handle('emulator:rotate', async (_event, sessionId: string) => {
    return emulatorSessionManager.rotate(sessionId);
  });

  ipcMain.handle('emulator:typeText', async (_event, sessionId: string, text: string) => {
    await emulatorSessionManager.typeText(sessionId, text);
  });

  ipcMain.handle('emulator:sendInput', async (_event, sessionId: string, line: string) => {
    return emulatorSessionManager.sendInput(sessionId, line);
  });

  ipcMain.handle('emulator:screenshot', async (_event, sessionId: string) => {
    return emulatorSessionManager.screenshot(sessionId);
  });
}

export async function cleanupEmulatorSessions(): Promise<void> {
  await emulatorSessionManager.stopAll();
}
