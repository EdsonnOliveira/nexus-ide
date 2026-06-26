delete process.env.NODE_OPTIONS;

import { app, BrowserWindow, globalShortcut, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { registerApiHandlers } from './ipc/api';
import { registerBrowserHandlers } from './ipc/browser';
import { registerDialogHandlers } from './ipc/dialog';
import { cleanupEmulatorSessions, registerEmulatorHandlers } from './ipc/emulator';
import { registerFileHandlers } from './ipc/files';
import { registerProjectHandlers } from './ipc/projects';
import { registerGitHandlers } from './ipc/git';
import { registerMusicHandlers } from './ipc/music';
import { registerMailHandlers } from './ipc/mail';
import { registerVercelHandlers } from './ipc/vercel';
import { registerWhatsAppHandlers } from './ipc/whatsapp';
import { registerSessionHandlers } from './ipc/session';
import { registerTaskHandlers } from './ipc/tasks';
import { registerPasswordHandlers } from './ipc/passwords';
import { registerTerminalHandlers } from './ipc/terminal';
import {
  registerLocalFileProtocol,
  registerLocalFileScheme,
} from './protocol/localFiles';
import { ptyManager } from './services/ptyManager';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

registerLocalFileScheme();

process.env.APP_ROOT = path.join(__dirname, '../..');

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST;

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win: BrowserWindow | null = null;
let isQuitting = false;
let flushMode: 'quit' | 'close' = 'quit';
const preload = path.join(__dirname, '../preload/index.cjs');
const indexHtml = path.join(RENDERER_DIST, 'index.html');

async function createWindow() {
  win = new BrowserWindow({
    title: 'Nexus IDE',
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#08080c',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 10, y: 10 },
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  ptyManager.setWindow(win);

  win.webContents.on('preload-error', (_, preloadPath, error) => {
    console.error('Preload error:', preloadPath, error);
  });

  win.once('ready-to-show', () => {
    win?.show();
    win?.focus();
  });

  if (VITE_DEV_SERVER_URL) {
    await win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    await win.loadFile(indexHtml);
  }

  if (!win.isVisible()) {
    win.show();
    win.focus();
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) {
      shell.openExternal(url);
    }

    return { action: 'deny' };
  });

  win.on('closed', () => {
    ptyManager.setWindow(null);
    win = null;
  });

  win.on('close', (event) => {
    if (isQuitting || !win) {
      return;
    }

    event.preventDefault();
    flushMode = 'close';
    win.webContents.send('app:flush-session');
  });

  registerWindowShortcuts(win);
}

function isOpenTabAddMenuShortcut(input: Electron.Input): boolean {
  if (input.type !== 'keyDown' || input.key.toLowerCase() !== 't') {
    return false;
  }

  const primaryModifier = process.platform === 'darwin' ? input.meta : input.control;

  return primaryModifier && !input.alt && !input.shift;
}

let lastGlobalSearchShortcutAt = 0;

function isOpenGlobalSearchShortcut(input: Electron.Input): boolean {
  if (input.type !== 'keyDown' || input.key.toLowerCase() !== 'o') {
    return false;
  }

  const primaryModifier = process.platform === 'darwin' ? input.meta : input.control;

  return primaryModifier && !input.alt && !input.shift;
}

function isBrowserReloadShortcut(input: Electron.Input): boolean {
  if (input.type !== 'keyDown') {
    return false;
  }

  if (input.key === 'F5') {
    return !input.meta && !input.control && !input.alt && !input.shift;
  }

  if (input.key.toLowerCase() !== 'r') {
    return false;
  }

  const primaryModifier = process.platform === 'darwin' ? input.meta : input.control;

  return primaryModifier && !input.alt && !input.shift;
}

function requestBrowserReloadFromShortcut(): void {
  win?.webContents.send('app:browser-reload');
}

function openGlobalSearchFromShortcut(): void {
  const now = Date.now();

  if (now - lastGlobalSearchShortcutAt < 120) {
    return;
  }

  lastGlobalSearchShortcutAt = now;
  win?.webContents.send('app:open-global-search');
}

function registerWindowShortcuts(window: BrowserWindow): void {
  window.webContents.on('before-input-event', (event, input) => {
    if (!window.isFocused()) {
      return;
    }

    if (isBrowserReloadShortcut(input)) {
      event.preventDefault();
      requestBrowserReloadFromShortcut();
      return;
    }

    if (isOpenTabAddMenuShortcut(input)) {
      event.preventDefault();
      window.webContents.send('app:open-tab-add-menu');
    }
  });
}

function registerShortcuts() {
  globalShortcut.register('CommandOrControl+B', () => {
    win?.webContents.send('app:toggle-explorer');
  });

  globalShortcut.register('CommandOrControl+O', () => {
    openGlobalSearchFromShortcut();
  });
}

app.whenReady().then(() => {
  registerLocalFileProtocol();
  registerProjectHandlers();
  registerFileHandlers(() => win);
  registerTerminalHandlers();
  registerTaskHandlers();
  registerPasswordHandlers();
  registerDialogHandlers(() => win);
  registerBrowserHandlers();
  registerApiHandlers();
  registerGitHandlers(() => win);
  registerMusicHandlers();
  registerMailHandlers();
  registerVercelHandlers();
  registerWhatsAppHandlers();
  registerEmulatorHandlers(() => win);
  registerSessionHandlers(() => {
    isQuitting = true;

    if (flushMode === 'close') {
      ptyManager.killAll();
      win?.destroy();
      isQuitting = false;
      flushMode = 'quit';
      return;
    }

    app.quit();
  });
  registerWebviewHandlers();
  createWindow();
  registerShortcuts();
});

function registerWebviewHandlers(): void {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') {
      return;
    }

    contents.on('before-input-event', (event, input) => {
      if (isBrowserReloadShortcut(input)) {
        event.preventDefault();
        requestBrowserReloadFromShortcut();
        return;
      }

      if (!isOpenGlobalSearchShortcut(input)) {
        return;
      }

      event.preventDefault();
      openGlobalSearchFromShortcut();
    });

    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https:') || url.startsWith('http:')) {
        void shell.openExternal(url);
      }

      return { action: 'deny' };
    });
  });
}

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  ptyManager.killAll();
  void cleanupEmulatorSessions();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (isQuitting || !win || win.isDestroyed()) {
    return;
  }

  event.preventDefault();
  flushMode = 'quit';
  win.webContents.send('app:flush-session');
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  ptyManager.killAll();
  void cleanupEmulatorSessions();
});

app.on('second-instance', () => {
  if (!win) {
    return;
  }

  if (win.isMinimized()) {
    win.restore();
  }

  win.focus();
});
