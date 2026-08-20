delete process.env.NODE_OPTIONS;

import {
  app,
  BrowserWindow,
  globalShortcut,
  Menu,
  nativeImage,
  powerMonitor,
  session,
  shell,
  type NativeImage,
} from 'electron';
import {
  appendFileSync,
  closeSync,
  existsSync,
  openSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
import { startIdleWakeLock, stopIdleWakeLock } from './services/idleWakeLock';
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

function ignoreBrokenPipe(stream: NodeJS.WriteStream | undefined): void {
  stream?.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED') {
      return;
    }
  });
}

ignoreBrokenPipe(process.stdout);
ignoreBrokenPipe(process.stderr);

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
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');

function isBrokenPipeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = 'code' in error ? String((error as { code?: unknown }).code) : '';
  const message = 'message' in error ? String((error as { message?: unknown }).message) : '';
  return code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED' || message.includes('EPIPE');
}

const MAX_LIFECYCLE_LOG_BYTES = 8 * 1024 * 1024;
const LIFECYCLE_LOG_KEEP_BYTES = 1024 * 1024;

let isWritingLifecycleLog = false;
let lifecycleWriteCount = 0;

function resolveLifecycleLogPath(): string {
  return path.join(app.getPath('userData'), 'main.log');
}

function trimLifecycleLogIfNeeded(logPath: string): void {
  try {
    if (!existsSync(logPath)) {
      return;
    }

    const size = statSync(logPath).size;

    if (size <= MAX_LIFECYCLE_LOG_BYTES) {
      return;
    }

    const fd = openSync(logPath, 'r');
    const keep = Buffer.alloc(LIFECYCLE_LOG_KEEP_BYTES);
    readSync(fd, keep, 0, LIFECYCLE_LOG_KEEP_BYTES, size - LIFECYCLE_LOG_KEEP_BYTES);
    closeSync(fd);
    const newline = keep.indexOf(10);
    writeFileSync(logPath, keep.subarray(newline >= 0 ? newline + 1 : 0));
  } catch {
  }
}

function logLifecycle(message: string, extra?: unknown): void {
  if (isWritingLifecycleLog) {
    return;
  }

  isWritingLifecycleLog = true;

  try {
    const line = extra === undefined
      ? `[lifecycle] ${message}`
      : `[lifecycle] ${message} ${JSON.stringify(extra)}`;
    const logPath = resolveLifecycleLogPath();
    appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);
    lifecycleWriteCount += 1;

    if (lifecycleWriteCount === 1 || lifecycleWriteCount % 40 === 0) {
      trimLifecycleLogIfNeeded(logPath);
    }
  } catch {
  } finally {
    isWritingLifecycleLog = false;
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
let isRecreatingWindow = false;
let blockSignalQuit = false;
let userQuitRequested = false;

function markUserQuitRequested(source: string): void {
  userQuitRequested = true;
  blockSignalQuit = false;
  logLifecycle(`user quit requested via ${source}`);
}

function clearUserQuitRequested(): void {
  userQuitRequested = false;
}

if (VITE_DEV_SERVER_URL) {
  const ignoreDevKill = (signal: string) => {
    blockSignalQuit = true;
    const hasWindow = Boolean(win && !win.isDestroyed());
    logLifecycle(`ignored ${signal} hasWindow=${hasWindow}`);
  };

  process.on('SIGTERM', () => ignoreDevKill('SIGTERM'));
  process.on('SIGINT', () => ignoreDevKill('SIGINT'));
  process.on('SIGHUP', () => ignoreDevKill('SIGHUP'));
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
    logLifecycle(`send failed (${channel})`, String(error));
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

function recreateMainWindow(source: string): void {
  if (isQuitting || isRecreatingWindow) {
    return;
  }

  isRecreatingWindow = true;
  logLifecycle(`recreating window after ${source}`);

  const appIcon = applyAppBranding();
  const dying = win && !win.isDestroyed() ? win : null;

  void createWindow(appIcon)
    .then(() => {
      if (!dying || dying.isDestroyed() || dying === win) {
        return;
      }

      dying.removeAllListeners('close');
      dying.destroy();
    })
    .catch((error: unknown) => {
      logLifecycle('recreate window failed', String(error));

      if ((!win || win.isDestroyed()) && dying && !dying.isDestroyed()) {
        win = dying;
      }
    })
    .finally(() => {
      isRecreatingWindow = false;
    });
}

function scheduleRendererRecovery(webContents: Electron.WebContents | null, source: string): void {
  if (isQuitting || isRecreatingWindow) {
    return;
  }

  if (!win || win.isDestroyed()) {
    noteRendererFailure();
    pendingRecoveryMessage = recoveryMessageFor(source);
    recreateMainWindow(source);
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

    if (isQuitting || isRecreatingWindow) {
      return;
    }

    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      recreateMainWindow(source);
      return;
    }

    logLifecycle(`recovering renderer after ${source}`);
    win.show();
    win.focus();
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
    if (isBrokenPipeError(error)) {
      return;
    }

    logLifecycle('uncaughtException', String(error?.stack ?? error));
  });

  process.on('unhandledRejection', (reason) => {
    if (isBrokenPipeError(reason)) {
      return;
    }

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

    const type = String(details.type ?? '');
    if (type.toLowerCase().includes('gpu')) {
      scheduleRendererRecovery(win?.webContents ?? null, 'gpu-gone');
    }
  });
}

registerProcessDiagnostics();

const preload = path.join(__dirname, '../preload/index.cjs');

function cancelPendingSessionFlush(): void {
  isSessionFlushing = false;
  flushMode = 'quit';
  isQuitting = false;
  clearUserQuitRequested();

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

      if (!userQuitRequested) {
        logLifecycle('session flush timeout — blocked force quit without user request');
        cancelPendingSessionFlush();
        win?.show();
        win?.focus();
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
    logLifecycle('preload-error', `${preloadPath} ${String(error)}`);
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    logLifecycle('window render-process-gone', details);
    noteRendererFailure();

    if (shouldRecoverRendererProcess(details.reason)) {
      scheduleRendererRecovery(win!.webContents, details.reason);
    }
  });

  win.webContents.on('unresponsive', () => {
    logLifecycle('window unresponsive');
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) {
      return;
    }

    logLifecycle('did-fail-load', { errorCode, errorDescription, validatedURL });
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
    if (isQuitting || isRecreatingWindow || !win) {
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
      event.preventDefault();
      markUserQuitRequested('Cmd+Q');
      requestSessionFlush('quit');
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

function installApplicationMenu(): void {
  const quitItem: Electron.MenuItemConstructorOptions = {
    label: 'Quit Nexus',
    accelerator: process.platform === 'darwin' ? 'Command+Q' : 'Alt+F4',
    click: () => {
      markUserQuitRequested('menu');
      requestSessionFlush('quit');
    },
  };

  const template: Electron.MenuItemConstructorOptions[] =
    process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [{ role: 'about' }, { type: 'separator' }, quitItem],
          },
          { role: 'editMenu' },
          { role: 'windowMenu' },
        ]
      : [
          {
            label: 'File',
            submenu: [quitItem],
          },
          { role: 'editMenu' },
          { role: 'windowMenu' },
        ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
  logLifecycle('app ready');
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
  startIdleWakeLock();
  registerSessionHandlers(() => {
    completeSessionFlush();
  });
  registerWebviewHandlers();
  registerYouTubeSidebarWebviewSession();
  const appIcon = applyAppBranding();
  installApplicationMenu();
  powerMonitor.on('shutdown', () => {
    markUserQuitRequested('shutdown');
  });
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
        markUserQuitRequested('Cmd+Q-webview');
        requestSessionFlush('quit');
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

  if (process.platform === 'darwin' || isRecreatingWindow) {
    return;
  }

  globalShortcut.unregisterAll();
  ptyManager.killAll();
  agentPrintRunner.stopAll();
  testRunnerSession.stopAll();
  stopDesktopControlServer();
  stopIdleWakeLock();
  void cleanupEmulatorSessions();
  stopMemoryWatch();
  stopManagedRuntime();
  app.quit();
});

app.on('before-quit', (event) => {
  const windowCount = BrowserWindow.getAllWindows().length;
  logLifecycle(
    `before-quit isQuitting=${isQuitting} windows=${windowCount} visible=${Boolean(win && !win.isDestroyed() && win.isVisible())} signal=${blockSignalQuit} user=${userQuitRequested}`,
  );

  if (blockSignalQuit) {
    blockSignalQuit = false;
    event.preventDefault();
    cancelPendingSessionFlush();
    logLifecycle('blocked signal quit');

    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }

    return;
  }

  if (isQuitting) {
    stopMemoryWatch();
    return;
  }

  if (!userQuitRequested) {
    event.preventDefault();
    cancelPendingSessionFlush();
    logLifecycle('blocked unexpected quit');

    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    } else {
      void createWindow(applyAppBranding());
    }

    return;
  }

  const recoveringFromCrash = Date.now() - lastRendererFailureAt < CRASH_QUIT_GRACE_MS;

  if (recoveringFromCrash && win && !win.isDestroyed()) {
    event.preventDefault();
    clearUserQuitRequested();
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
  stopIdleWakeLock();
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
