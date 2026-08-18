delete process.env.NODE_OPTIONS;

import {
  app,
  BrowserWindow,
  globalShortcut,
  nativeImage,
  session,
  shell,
  type NativeImage,
} from 'electron';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { registerApiHandlers } from './ipc/api';
import { registerBrowserHandlers } from './ipc/browser';
import { registerDialogHandlers } from './ipc/dialog';
import { cleanupEmulatorSessions, registerEmulatorHandlers } from './ipc/emulator';
import {
  startDesktopControlServer,
  stopDesktopControlServer,
} from './services/desktopControlServer';
import {
  startManagedRuntime,
  stopManagedRuntime,
} from './services/cloudRuntimeSupervisor';
import { registerFileHandlers } from './ipc/files';
import { registerProjectHandlers } from './ipc/projects';
import { registerGitHandlers } from './ipc/git';
import { registerHomeDashboardHandlers } from './ipc/homeDashboard';
import { registerMusicHandlers } from './ipc/music';
import { registerMailHandlers } from './ipc/mail';
import { registerCalendarHandlers } from './ipc/calendar';
import { registerMacParakeetHandlers } from './ipc/macParakeet';
import { registerJarvisHandlers } from './ipc/jarvis';
import { registerVercelHandlers } from './ipc/vercel';
import { registerRenderHandlers } from './ipc/render';
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
import { registerCloudHandlers } from './ipc/cloud';
import {
  registerLocalFileProtocol,
  registerLocalFileScheme,
} from './protocol/localFiles';
import { applyChromeUserAgentToWebContents } from './services/browserChromeUserAgent';
import { attachBrowserWebviewContextMenu } from './services/browserWebviewContextMenu';
import { registerYouTubeSidebarWebviewSession } from './services/youtubeSidebarWebviewSession';
import { ptyManager } from './services/ptyManager';
import { agentPrintRunner } from './services/agentPrintRunner';
import { testRunnerSession } from './services/testRunnerSession';
import { pruneSessionScrollbacksOnBoot } from './services/pruneSessionScrollbacks';

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

app.setName(DOCK_APP_NAME);
app.setPath('userData', path.join(app.getPath('appData'), 'nexus-ide'));
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');

function logLifecycle(message: string, extra?: unknown): void {
  const line = extra === undefined
    ? `[lifecycle] ${message}`
    : `[lifecycle] ${message} ${JSON.stringify(extra)}`;
  console.error(line);

  try {
    appendFileSync(
      path.join(app.getPath('userData'), 'main.log'),
      `${new Date().toISOString()} ${line}\n`,
    );
  } catch {
  }
}

if (!app.requestSingleInstanceLock()) {
  logLifecycle('another instance is already running — quitting');
  app.quit();
  process.exit(0);
}

const SESSION_FLUSH_TIMEOUT_MS = 5000;
const CRASH_QUIT_GRACE_MS = 12_000;
const MEMORY_CHECK_INTERVAL_MS = 60_000;
const MEMORY_RELOAD_THRESHOLD_KB = 3 * 1024 * 1024;
const MEMORY_RELOAD_COOLDOWN_MS = 5 * 60_000;
const RECOVERY_TOAST_DELAY_MS = 900;

let win: BrowserWindow | null = null;
let isQuitting = false;
let rendererReloadTimer: ReturnType<typeof setTimeout> | null = null;
let flushMode: 'quit' | 'close' = 'quit';
let isSessionFlushing = false;
let sessionFlushTimer: ReturnType<typeof setTimeout> | null = null;
let lastRendererFailureAt = 0;
let lastMemoryReloadAt = 0;
let lastQuitAttemptAt = 0;
let quitFlushAttempts = 0;
let pendingRecoveryMessage: string | null = null;
let memoryWatchTimer: ReturnType<typeof setInterval> | null = null;

if (VITE_DEV_SERVER_URL) {
  const exitForDevRestart = (signal: string) => {
    logLifecycle(`received ${signal} — exiting for dev restart`);
    isQuitting = true;
    app.exit(0);
  };

  process.on('SIGTERM', () => exitForDevRestart('SIGTERM'));
  process.on('SIGINT', () => exitForDevRestart('SIGINT'));
  process.on('SIGHUP', () => {
    logLifecycle('ignored SIGHUP');
  });
}

function shouldRecoverRendererProcess(reason: string): boolean {
  return (
    reason === 'crashed' ||
    reason === 'oom' ||
    reason === 'abnormal-exit' ||
    reason === 'killed'
  );
}

function recoveryMessageFor(source: string): string {
  if (source === 'memory-pressure') {
    return 'O Nexus recarregou a janela para liberar memória.';
  }

  if (source === 'quit-flush-timeout') {
    return 'O Nexus travou ao sair e foi recuperado. Cmd+Q de novo para fechar.';
  }

  return 'O Nexus recuperou a janela depois de um fechamento inesperado.';
}

function noteRendererFailure(): void {
  lastRendererFailureAt = Date.now();
}

function sendToWindow(channel: string, ...args: unknown[]): void {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return;
  }

  try {
    win.webContents.send(channel, ...args);
  } catch (error) {
    console.error(`[main] send failed (${channel})`, error);
  }
}

function deliverPendingRecoveryMessage(): void {
  if (!pendingRecoveryMessage) {
    return;
  }

  const message = pendingRecoveryMessage;
  pendingRecoveryMessage = null;

  setTimeout(() => {
    sendToWindow('app:renderer-recovered', message);
  }, RECOVERY_TOAST_DELAY_MS);
}

function scheduleRendererRecovery(webContents: Electron.WebContents | null, source: string): void {
  if (isQuitting || !win || win.isDestroyed()) {
    return;
  }

  if (webContents && win.webContents !== webContents) {
    return;
  }

  noteRendererFailure();
  pendingRecoveryMessage = recoveryMessageFor(source);

  if (rendererReloadTimer) {
    clearTimeout(rendererReloadTimer);
  }

  rendererReloadTimer = setTimeout(() => {
    rendererReloadTimer = null;

    if (isQuitting || !win || win.isDestroyed()) {
      return;
    }

    if (win.webContents.isDestroyed()) {
      logLifecycle(`recreating window after ${source}`);
      const appIcon = applyAppBranding();
      const dying = win;
      dying.destroy();
      void createWindow(appIcon);
      return;
    }

    logLifecycle(`recovering renderer after ${source}`);
    win.webContents.reload();
  }, 300);
}

function checkRendererMemory(): void {
  if (isQuitting || !win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return;
  }

  if (Date.now() - lastMemoryReloadAt < MEMORY_RELOAD_COOLDOWN_MS) {
    return;
  }

  const rendererPid = win.webContents.getOSProcessId();
  const metric = app.getAppMetrics().find((entry) => entry.pid === rendererPid);
  const workingSetKb = metric?.memory.workingSetSize ?? 0;

  if (workingSetKb < MEMORY_RELOAD_THRESHOLD_KB) {
    return;
  }

  lastMemoryReloadAt = Date.now();
  logLifecycle(`renderer memory ${workingSetKb} KB — scheduling reload`);
  scheduleRendererRecovery(win.webContents, 'memory-pressure');
}

function startMemoryWatch(): void {
  if (memoryWatchTimer) {
    return;
  }

  memoryWatchTimer = setInterval(() => {
    checkRendererMemory();
  }, MEMORY_CHECK_INTERVAL_MS);
}

function stopMemoryWatch(): void {
  if (!memoryWatchTimer) {
    return;
  }

  clearInterval(memoryWatchTimer);
  memoryWatchTimer = null;
}

function registerProcessDiagnostics(): void {
  process.on('uncaughtException', (error) => {
    logLifecycle('uncaughtException', String(error?.stack ?? error));
  });

  process.on('unhandledRejection', (reason) => {
    logLifecycle('unhandledRejection', String(reason));
  });

  app.on('render-process-gone', (_event, webContents, details) => {
    logLifecycle('render-process-gone', details);
    noteRendererFailure();

    if (shouldRecoverRendererProcess(details.reason)) {
      scheduleRendererRecovery(webContents, details.reason);
    }
  });

  app.on('child-process-gone', (_event, details) => {
    logLifecycle('child-process-gone', details);
  });
}

registerProcessDiagnostics();

const preload = path.join(__dirname, '../preload/index.cjs');

function cancelPendingSessionFlush(): void {
  isSessionFlushing = false;
  flushMode = 'quit';
  isQuitting = false;

  if (sessionFlushTimer) {
    clearTimeout(sessionFlushTimer);
    sessionFlushTimer = null;
  }
}

function completeSessionFlush(): void {
  if (!isSessionFlushing) {
    return;
  }

  isSessionFlushing = false;

  if (sessionFlushTimer) {
    clearTimeout(sessionFlushTimer);
    sessionFlushTimer = null;
  }

  const mode = flushMode;
  logLifecycle(`session flush complete mode=${mode}`);

  if (mode === 'close') {
    if (process.platform === 'darwin' && win && !win.isDestroyed()) {
      win.hide();
      flushMode = 'quit';
      return;
    }

    isQuitting = true;
    ptyManager.killAll();
    agentPrintRunner.stopAll();
    testRunnerSession.stopAll();
    win?.destroy();
    isQuitting = false;
    flushMode = 'quit';
    return;
  }

  isQuitting = true;
  app.quit();
}

function requestSessionFlush(mode: 'quit' | 'close'): void {
  if (!win || win.isDestroyed() || isSessionFlushing) {
    return;
  }

  isSessionFlushing = true;
  flushMode = mode;

  if (sessionFlushTimer) {
    clearTimeout(sessionFlushTimer);
  }

  sessionFlushTimer = setTimeout(() => {
    if (flushMode === 'quit') {
      const now = Date.now();

      if (now - lastQuitAttemptAt > 15_000) {
        quitFlushAttempts = 0;
      }

      quitFlushAttempts += 1;
      lastQuitAttemptAt = now;

      if (quitFlushAttempts < 2 && win && !win.isDestroyed()) {
        logLifecycle('session flush timeout — canceling quit and recovering');
        cancelPendingSessionFlush();
        scheduleRendererRecovery(win.webContents, 'quit-flush-timeout');
        win.show();
        win.focus();
        return;
      }

      logLifecycle('session flush timeout — forcing quit after retry');
    } else {
      logLifecycle('session flush timeout — forcing close');
    }

    completeSessionFlush();
  }, SESSION_FLUSH_TIMEOUT_MS);

  sendToWindow('app:flush-session');
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
    logLifecycle('window render-process-gone', details);
    noteRendererFailure();

    if (shouldRecoverRendererProcess(details.reason)) {
      scheduleRendererRecovery(win!.webContents, details.reason);
    }
  });

  win.webContents.on('did-finish-load', () => {
    deliverPendingRecoveryMessage();
  });

  win.once('ready-to-show', () => {
    win?.show();
    win?.focus();
  });

  if (VITE_DEV_SERVER_URL) {
    try {
      await win.loadURL(VITE_DEV_SERVER_URL);
    } catch (error) {
      logLifecycle('loadURL failed', String(error));
    }
  } else {
    try {
      await win.loadFile(indexHtml);
    } catch (error) {
      logLifecycle('loadFile failed', String(error));
    }
  }

  if (!win.isDestroyed() && !win.isVisible()) {
    win.show();
    win.focus();
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) {
      shell.openExternal(url);
    }

    return { action: 'deny' };
  });

  const createdWindow = win;

  win.on('closed', () => {
    if (win !== createdWindow) {
      return;
    }

    ptyManager.setWindow(null);
    agentPrintRunner.setWindow(null);
    testRunnerSession.setWindow(null);
    win = null;
    logLifecycle('window closed');
  });

  win.on('close', (event) => {
    if (isQuitting || !win) {
      return;
    }

    logLifecycle('window close requested');
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

function isBrowserFocusUrlShortcut(input: Electron.Input): boolean {
  if (input.type !== 'keyDown' || input.key.toLowerCase() !== 'l') {
    return false;
  }

  const primaryModifier = process.platform === 'darwin' ? input.meta : input.control;

  return primaryModifier && !input.alt && !input.shift;
}

function isQuitShortcut(input: Electron.Input): boolean {
  if (input.type !== 'keyDown' || input.key.toLowerCase() !== 'q') {
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

function requestBrowserFocusUrlFromShortcut(): void {
  win?.webContents.send('app:browser-focus-url');
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

    if (isQuitShortcut(input)) {
      logLifecycle('Cmd+Q from main window');
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
  const allowedPermissions = new Set([
    'media',
    'mediaKeySystem',
    'clipboard-sanitized-write',
    'clipboard-read',
  ]);

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowedPermissions.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) =>
    allowedPermissions.has(permission),
  );

  registerLocalFileProtocol();
  pruneSessionScrollbacksOnBoot();
  registerProjectHandlers();
  registerCloudHandlers();
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
  registerJarvisHandlers();
  registerVercelHandlers();
  registerRenderHandlers();
  registerCursorUsageHandlers();
  registerWhatsAppHandlers();
  registerEmulatorHandlers(() => win);
  startDesktopControlServer();
  registerSessionHandlers(() => {
    completeSessionFlush();
  });
  registerWebviewHandlers();
  registerYouTubeSidebarWebviewSession();
  const appIcon = applyAppBranding();
  createWindow(appIcon);
  registerShortcuts();
  startMemoryWatch();
  setImmediate(() => {
    startManagedRuntime();
  });
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

    applyChromeUserAgentToWebContents(contents);

    attachBrowserWebviewContextMenu(contents, {
      onOpenInAppTab: requestOpenBrowserTab,
    });

    contents.on('before-input-event', (event, input) => {
      if (isQuitShortcut(input)) {
        event.preventDefault();
        logLifecycle('blocked Cmd+Q from webview');
        return;
      }
      if (isBrowserReloadShortcut(input)) {
        event.preventDefault();
        requestBrowserReloadFromShortcut();
        return;
      }

      if (isBrowserFocusUrlShortcut(input)) {
        event.preventDefault();
        requestBrowserFocusUrlFromShortcut();
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
  logLifecycle('window-all-closed');

  if (process.platform === 'darwin') {
    return;
  }

  globalShortcut.unregisterAll();
  ptyManager.killAll();
  agentPrintRunner.stopAll();
  testRunnerSession.stopAll();
  stopDesktopControlServer();
  void cleanupEmulatorSessions();
  stopMemoryWatch();
  stopManagedRuntime();
  app.quit();
});

app.on('before-quit', (event) => {
  const windowCount = BrowserWindow.getAllWindows().length;
  logLifecycle(
    `before-quit isQuitting=${isQuitting} windows=${windowCount} visible=${Boolean(win && !win.isDestroyed() && win.isVisible())}`,
  );

  if (isQuitting) {
    stopMemoryWatch();
    return;
  }

  const recoveringFromCrash = Date.now() - lastRendererFailureAt < CRASH_QUIT_GRACE_MS;

  if (recoveringFromCrash && win && !win.isDestroyed()) {
    event.preventDefault();
    scheduleRendererRecovery(win.webContents, 'quit-during-crash');
    return;
  }

  if (!win || win.isDestroyed()) {
    return;
  }

  event.preventDefault();
  requestSessionFlush('quit');
});

app.on('quit', (_event, exitCode) => {
  logLifecycle(`quit exitCode=${exitCode}`);
});

app.on('activate', () => {
  logLifecycle('activate');

  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return;
  }

  createWindow(applyAppBranding());
});

app.on('will-quit', () => {
  stopMemoryWatch();
  globalShortcut.unregisterAll();
  ptyManager.killAll();
  agentPrintRunner.stopAll();
  testRunnerSession.stopAll();
  stopManagedRuntime();
  stopDesktopControlServer();
  void cleanupEmulatorSessions();
});

app.on('second-instance', () => {
  if (!win) {
    return;
  }

  if (win.isMinimized()) {
    win.restore();
  }

  win.show();
  win.focus();
});
