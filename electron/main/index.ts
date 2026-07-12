delete process.env.NODE_OPTIONS;

import { app, BrowserWindow, globalShortcut, nativeImage, shell, type NativeImage } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { registerApiHandlers } from './ipc/api';
import { registerBrowserHandlers } from './ipc/browser';
import { registerDialogHandlers } from './ipc/dialog';
import { cleanupEmulatorSessions, registerEmulatorHandlers } from './ipc/emulator';
import { registerFileHandlers } from './ipc/files';
import { registerProjectHandlers } from './ipc/projects';
import { registerGitHandlers } from './ipc/git';
import { registerHomeDashboardHandlers } from './ipc/homeDashboard';
import { registerMusicHandlers } from './ipc/music';
import { registerMailHandlers } from './ipc/mail';
import { registerCalendarHandlers } from './ipc/calendar';
import { registerMacParakeetHandlers } from './ipc/macParakeet';
import { registerVercelHandlers } from './ipc/vercel';
import { registerCursorUsageHandlers } from './ipc/cursorUsage';
import { registerWhatsAppHandlers } from './ipc/whatsapp';
import { registerSessionHandlers } from './ipc/session';
import { registerTaskHandlers } from './ipc/tasks';
import { registerTestHandlers } from './ipc/tests';
import { registerPasswordHandlers } from './ipc/passwords';
import { registerTerminalHandlers } from './ipc/terminal';
import { registerAgentPrintHandlers } from './ipc/agentPrint';
import { registerDebugSessionHandlers } from './ipc/debugSession';
import { registerSystemStatusHandlers } from './ipc/systemStatus';
import { registerSystemNotificationsHandlers } from './ipc/systemNotifications';
import {
  registerLocalFileProtocol,
  registerLocalFileScheme,
} from './protocol/localFiles';
import { attachBrowserWebviewContextMenu } from './services/browserWebviewContextMenu';
import { registerYouTubeSidebarWebviewSession } from './services/youtubeSidebarWebviewSession';
import { ptyManager } from './services/ptyManager';
import { agentPrintRunner } from './services/agentPrintRunner';
import { testRunnerSession } from './services/testRunnerSession';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DOCK_APP_NAME = 'Nexus';
const APP_WINDOW_TITLE = 'Nexus IDE';

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

app.setName(DOCK_APP_NAME);
app.setPath('userData', path.join(app.getPath('appData'), 'nexus-ide'));

function shouldRecoverRendererProcess(reason: string): boolean {
  return reason === 'crashed' || reason === 'oom' || reason === 'abnormal-exit';
}

function scheduleRendererRecovery(webContents: Electron.WebContents, source: string): void {
  if (isQuitting || !win || win.isDestroyed() || win.webContents !== webContents) {
    return;
  }

  if (rendererReloadTimer) {
    clearTimeout(rendererReloadTimer);
  }

  rendererReloadTimer = setTimeout(() => {
    rendererReloadTimer = null;

    if (isQuitting || !win || win.isDestroyed() || win.webContents.isDestroyed()) {
      return;
    }

    console.warn(`[window] recovering renderer after ${source}`);
    win.webContents.reload();
  }, 300);
}

function registerProcessDiagnostics(): void {
  process.on('uncaughtException', (error) => {
    console.error('[main] uncaughtException', error);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[main] unhandledRejection', reason);
  });

  app.on('render-process-gone', (_event, webContents, details) => {
    console.error('[main] render-process-gone', details);

    if (shouldRecoverRendererProcess(details.reason)) {
      scheduleRendererRecovery(webContents, details.reason);
    }
  });

  app.on('child-process-gone', (_event, details) => {
    console.error('[main] child-process-gone', details);
  });
}

registerProcessDiagnostics();

let win: BrowserWindow | null = null;
let isQuitting = false;
let rendererReloadTimer: ReturnType<typeof setTimeout> | null = null;
let flushMode: 'quit' | 'close' = 'quit';
let sessionFlushTimer: ReturnType<typeof setTimeout> | null = null;
const SESSION_FLUSH_TIMEOUT_MS = 5000;
const preload = path.join(__dirname, '../preload/index.cjs');

function completeSessionFlush(): void {
  if (sessionFlushTimer) {
    clearTimeout(sessionFlushTimer);
    sessionFlushTimer = null;
  }

  isQuitting = true;

  if (flushMode === 'close') {
    ptyManager.killAll();
    agentPrintRunner.stopAll();
    testRunnerSession.stopAll();
    win?.destroy();
    isQuitting = false;
    flushMode = 'quit';
    return;
  }

  app.quit();
}

function requestSessionFlush(mode: 'quit' | 'close'): void {
  if (!win || win.isDestroyed()) {
    return;
  }

  flushMode = mode;

  if (sessionFlushTimer) {
    clearTimeout(sessionFlushTimer);
  }

  sessionFlushTimer = setTimeout(() => {
    console.warn('[session] flush timeout — forcing close');
    completeSessionFlush();
  }, SESSION_FLUSH_TIMEOUT_MS);

  win.webContents.send('app:flush-session');
}

const indexHtml = path.join(RENDERER_DIST, 'index.html');

function resolveAppIcon(): NativeImage | undefined {
  const appRoot = process.env.APP_ROOT ?? '';
  const candidates =
    process.platform === 'darwin'
      ? [
          path.join(appRoot, 'build/icon.icns'),
          path.join(appRoot, 'build/icon.png'),
          path.join(process.env.VITE_PUBLIC ?? '', 'nexus-logo.png'),
          path.join(RENDERER_DIST, 'nexus-logo.png'),
        ]
      : [
          path.join(appRoot, 'build/icon.png'),
          path.join(appRoot, 'build/icon.ico'),
          path.join(process.env.VITE_PUBLIC ?? '', 'nexus-logo.png'),
          path.join(RENDERER_DIST, 'nexus-logo.png'),
        ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const image = nativeImage.createFromPath(candidate);

    if (!image.isEmpty()) {
      return image;
    }
  }

  return undefined;
}

function applyAppBranding(): NativeImage | undefined {
  app.setName(DOCK_APP_NAME);

  const appIcon = resolveAppIcon();

  if (!appIcon) {
    return undefined;
  }

  return appIcon;
}

async function createWindow(appIcon?: NativeImage) {
  const windowIcon = appIcon ?? resolveAppIcon();

  win = new BrowserWindow({
    title: APP_WINDOW_TITLE,
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#08080c',
    ...(windowIcon && process.platform !== 'darwin' ? { icon: windowIcon } : {}),
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
  agentPrintRunner.setWindow(win);
  testRunnerSession.setWindow(win);

  if (windowIcon && process.platform !== 'darwin') {
    win.setIcon(windowIcon);
  }

  win.webContents.on('preload-error', (_, preloadPath, error) => {
    console.error('Preload error:', preloadPath, error);
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[window] render-process-gone', details);

    if (shouldRecoverRendererProcess(details.reason)) {
      scheduleRendererRecovery(win!.webContents, details.reason);
    }
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
    agentPrintRunner.setWindow(null);
    testRunnerSession.setWindow(null);
    win = null;
  });

  win.on('close', (event) => {
    if (isQuitting || !win) {
      return;
    }

    event.preventDefault();
    requestSessionFlush('close');
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

function isAppReloadShortcut(input: Electron.Input): boolean {
  if (input.type !== 'keyDown' || input.key.toLowerCase() !== 'r') {
    return false;
  }

  const primaryModifier = process.platform === 'darwin' ? input.meta : input.control;

  return primaryModifier && input.shift && !input.alt;
}

function requestAppReloadFromShortcut(): void {
  win?.webContents.reload();
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

    if (isAppReloadShortcut(input)) {
      event.preventDefault();
      requestAppReloadFromShortcut();
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
  registerAgentPrintHandlers();
  registerDebugSessionHandlers();
  registerTaskHandlers();
  registerTestHandlers();
  registerPasswordHandlers();
  registerDialogHandlers(() => win);
  registerBrowserHandlers();
  registerApiHandlers();
  registerGitHandlers(() => win);
  registerHomeDashboardHandlers();
  registerMusicHandlers();
  registerSystemStatusHandlers();
  registerSystemNotificationsHandlers();
  registerMailHandlers();
  registerCalendarHandlers();
  registerMacParakeetHandlers();
  registerVercelHandlers();
  registerCursorUsageHandlers();
  registerWhatsAppHandlers();
  registerEmulatorHandlers(() => win);
  registerSessionHandlers(() => {
    completeSessionFlush();
  });
  registerWebviewHandlers();
  registerYouTubeSidebarWebviewSession();
  const appIcon = applyAppBranding();
  createWindow(appIcon);
  registerShortcuts();
});

function requestOpenBrowserTab(url: string): void {
  if (!url.startsWith('https:') && !url.startsWith('http:')) {
    return;
  }

  win?.webContents.send('browser:open-in-tab', url);
}

function registerWebviewHandlers(): void {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') {
      return;
    }

    attachBrowserWebviewContextMenu(contents, {
      onOpenInAppTab: requestOpenBrowserTab,
    });

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
      requestOpenBrowserTab(url);
      return { action: 'deny' };
    });
  });
}

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  ptyManager.killAll();
  agentPrintRunner.stopAll();
  testRunnerSession.stopAll();
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
  requestSessionFlush('quit');
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow(applyAppBranding());
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  ptyManager.killAll();
  agentPrintRunner.stopAll();
  testRunnerSession.stopAll();
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
