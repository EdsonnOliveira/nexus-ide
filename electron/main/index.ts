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
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { registerApiHandlers } from './ipc/api';
import { registerAgentPipHandlers } from './ipc/agentPip';
import { registerBrowserHandlers } from './ipc/browser';
import { registerDialogHandlers } from './ipc/dialog';
import { cleanupEmulatorSessions, registerEmulatorHandlers } from './ipc/emulator';
import {
  startDesktopControlServer,
  stopDesktopControlServer,
} from './services/desktopControlServer';
import { startIdleWakeLock, stopIdleWakeLock } from './services/idleWakeLock';
import { startManagedRuntime, stopManagedRuntime } from './services/cloudRuntimeSupervisor';
import { ensureDevServerRunning, stopEnsuredDevServer } from './services/devServerKeepAlive';
import { registerFileHandlers } from './ipc/files';
import { registerProjectHandlers } from './ipc/projects';
import { flushProjectStoreWrites } from './services/projectStore';
import { registerGitHandlers } from './ipc/git';
import { registerHomeDashboardHandlers } from './ipc/homeDashboard';
import { registerMissionHandlers } from './ipc/missions';
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
  bindAgentPipMainWindow,
  configureAgentPipWindow,
  destroyAgentPipWindow,
} from './services/agentPipWindow';
import { registerLocalFileProtocol, registerLocalFileScheme } from './protocol/localFiles';
import { applyChromeUserAgentToWebContents } from './services/browserChromeUserAgent';
import { attachBrowserWebviewContextMenu } from './services/browserWebviewContextMenu';
import { registerYouTubeSidebarWebviewSession } from './services/youtubeSidebarWebviewSession';
import { ptyManager } from './services/ptyManager';
import { agentPrintRunner } from './services/agentPrintRunner';
import { testRunnerSession } from './services/testRunnerSession';
import { pruneSessionScrollbacksOnBoot } from './services/pruneSessionScrollbacks';
import {
  pruneBrowserDayCacheOnBoot,
  startBrowserDayCacheWatch,
  stopBrowserDayCacheWatch,
} from './services/browserDayCache';

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

function resolveDevServerUrl(): string | undefined {
  if (!VITE_DEV_SERVER_URL) {
    return undefined;
  }

  try {
    const url = new URL(VITE_DEV_SERVER_URL);

    if (url.hostname === 'localhost' || url.hostname === '::1') {
      url.hostname = '127.0.0.1';
    }

    return url.toString();
  } catch {
    return VITE_DEV_SERVER_URL;
  }
}

const DEV_SERVER_URL = resolveDevServerUrl();

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST;

app.setName(DOCK_APP_NAME);
app.setPath('userData', path.join(app.getPath('appData'), 'nexus-ide'));
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disk-cache-size', '268435456');

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
  } catch {}
}

function logLifecycle(message: string, extra?: unknown): void {
  if (isWritingLifecycleLog) {
    return;
  }

  isWritingLifecycleLog = true;

  try {
    const line =
      extra === undefined
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
const MEMORY_RELOAD_THRESHOLD_KB = 1536 * 1024;
const MEMORY_RELOAD_COOLDOWN_MS = 5 * 60_000;
const RECOVERY_TOAST_DELAY_MS = 900;
const DEV_LOAD_RETRY_MS = 1500;
const DEV_HEARTBEAT_MS = 3000;
const DEV_LOAD_FAIL_CODES = new Set([-2, -101, -102, -103, -106, -118, -324]);
const DEV_RECONNECT_MARKER = 'nexus-dev-reconnect';

let win: BrowserWindow | null = null;
let isQuitting = false;
let rendererReloadTimer: ReturnType<typeof setTimeout> | null = null;
let failLoadRetryTimer: ReturnType<typeof setTimeout> | null = null;
let lastMainFrameLoadFailed = false;
let currentLoadFailed = false;
let watchingDevServer = false;
let devServerHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
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
    reason === 'crashed' || reason === 'oom' || reason === 'abnormal-exit' || reason === 'killed'
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

function clearFailLoadRetry(): void {
  if (!failLoadRetryTimer) {
    return;
  }

  clearTimeout(failLoadRetryTimer);
  failLoadRetryTimer = null;
}

function stopDevServerWatch(): void {
  watchingDevServer = false;
  clearFailLoadRetry();
}

function isDevReconnectUrl(url: string): boolean {
  return url.includes(DEV_RECONNECT_MARKER);
}

function probeDevServer(): Promise<boolean> {
  if (!DEV_SERVER_URL) {
    return Promise.resolve(false);
  }

  let parsed: URL;

  try {
    parsed = new URL(DEV_SERVER_URL);
  } catch {
    return Promise.resolve(false);
  }

  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  const host = parsed.hostname || '127.0.0.1';
  const hosts = host === 'localhost' ? ['127.0.0.1', '::1'] : [host];

  return new Promise((resolve) => {
    const tryHost = (index: number) => {
      if (index >= hosts.length) {
        resolve(false);
        return;
      }

      const socket = net.connect({ port, host: hosts[index] });
      const done = (ok: boolean) => {
        socket.removeAllListeners();
        socket.destroy();

        if (ok) {
          resolve(true);
          return;
        }

        tryHost(index + 1);
      };

      socket.setTimeout(600);
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      socket.once('timeout', () => done(false));
    };

    tryHost(0);
  });
}

function buildDevReconnectHtml(): string {
  const targetJson = JSON.stringify(DEV_SERVER_URL ?? 'http://127.0.0.1:5260/');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Nexus IDE</title>
<style>
html,body{margin:0;height:100%;background:#08080c;color:#e8e8ef;font-family:Inter,system-ui,sans-serif;}
.wrap{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;}
p{margin:0;opacity:.72;font-size:14px;}
</style>
</head>
<body data-${DEV_RECONNECT_MARKER}="1">
<div class="wrap"><p>Reconectando ao Nexus…</p></div>
<script>
const target = ${targetJson};
const ping = () => {
  fetch(target, { mode: 'no-cors', cache: 'no-store' })
    .then(() => { location.replace(target); })
    .catch(() => {});
};
ping();
setInterval(ping, 1500);
</script>
</body>
</html>`;
}

function showDevReconnectPage(): void {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return;
  }

  if (isDevReconnectUrl(win.webContents.getURL())) {
    return;
  }

  logLifecycle('showing dev reconnect page');
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildDevReconnectHtml())}`);
}

async function tickDevServerWatch(source: string): Promise<void> {
  if (!watchingDevServer || !DEV_SERVER_URL || isQuitting) {
    return;
  }

  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    stopDevServerWatch();
    return;
  }

  const up = await probeDevServer();

  if (up) {
    logLifecycle('dev server reachable, loading', source);
    stopDevServerWatch();
    lastMainFrameLoadFailed = false;
    currentLoadFailed = false;

    try {
      await win.loadURL(DEV_SERVER_URL);
    } catch (error: unknown) {
      logLifecycle('retry loadURL failed', String(error));
      watchDevServer('load-failed');
    }

    return;
  }

  ensureDevServerRunning(process.env.APP_ROOT ?? '', logLifecycle);
  showDevReconnectPage();
  clearFailLoadRetry();
  failLoadRetryTimer = setTimeout(() => {
    failLoadRetryTimer = null;
    void tickDevServerWatch(source);
  }, DEV_LOAD_RETRY_MS);
}

function watchDevServer(source: string): void {
  if (!DEV_SERVER_URL || isQuitting) {
    return;
  }

  lastMainFrameLoadFailed = true;

  if (watchingDevServer) {
    return;
  }

  watchingDevServer = true;
  logLifecycle('watching dev server', source);
  void tickDevServerWatch(source);
}

function stopDevServerHeartbeat(): void {
  if (!devServerHeartbeatTimer) {
    return;
  }

  clearInterval(devServerHeartbeatTimer);
  devServerHeartbeatTimer = null;
}

function startDevServerHeartbeat(): void {
  if (!DEV_SERVER_URL || devServerHeartbeatTimer) {
    return;
  }

  const beat = () => {
    if (isQuitting) {
      return;
    }

    void probeDevServer().then((up) => {
      if (isQuitting || !win || win.isDestroyed() || win.webContents.isDestroyed()) {
        return;
      }

      const url = win.webContents.getURL();
      const onReconnect = isDevReconnectUrl(url);

      if (up) {
        if (onReconnect) {
          watchDevServer('heartbeat-up');
        }

        return;
      }

      logLifecycle('dev server lost');
      ensureDevServerRunning(process.env.APP_ROOT ?? '', logLifecycle);

      if (onReconnect || lastMainFrameLoadFailed) {
        watchDevServer('heartbeat');
      }
    });
  };

  beat();
  devServerHeartbeatTimer = setInterval(beat, DEV_HEARTBEAT_MS);
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

    if (VITE_DEV_SERVER_URL) {
      void probeDevServer().then((up) => {
        if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
          return;
        }

        if (up && DEV_SERVER_URL) {
          void win.loadURL(DEV_SERVER_URL);
          return;
        }

        watchDevServer(source);
      });
      return;
    }

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

  if (isDevReconnectUrl(win.webContents.getURL())) {
    logLifecycle('session flush skipped — reconnect page');
    isSessionFlushing = true;
    flushMode = mode;
    completeSessionFlush();
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
        if (isDevReconnectUrl(win.webContents.getURL()) || lastMainFrameLoadFailed) {
          logLifecycle('session flush timeout — quitting reconnect page');
          completeSessionFlush();
          return;
        }

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

configureAgentPipWindow({
  getMainWindow: () => win,
  preload,
  loadUrl: async (window) => {
    if (DEV_SERVER_URL) {
      const url = new URL(DEV_SERVER_URL);
      url.hash = 'agent-pip';
      await window.loadURL(url.toString());
      return;
    }

    await window.loadFile(indexHtml, { hash: 'agent-pip' });
  },
});

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
  bindAgentPipMainWindow(win);

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

  win.webContents.on('did-start-loading', () => {
    currentLoadFailed = false;
  });

  win.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) {
        return;
      }

      currentLoadFailed = true;
      lastMainFrameLoadFailed = true;
      logLifecycle('did-fail-load', { errorCode, errorDescription, validatedURL });

      const failedDevUrl = Boolean(
        validatedURL &&
        ((DEV_SERVER_URL && validatedURL.startsWith(DEV_SERVER_URL)) ||
          (VITE_DEV_SERVER_URL && validatedURL.startsWith(VITE_DEV_SERVER_URL))),
      );

      if (failedDevUrl || DEV_LOAD_FAIL_CODES.has(errorCode)) {
        watchDevServer(errorDescription);
      }
    },
  );

  win.webContents.on('did-finish-load', () => {
    const url = win?.webContents.getURL() ?? '';

    if (isDevReconnectUrl(url)) {
      return;
    }

    if (currentLoadFailed) {
      watchDevServer('finish-after-fail');
      return;
    }

    lastMainFrameLoadFailed = false;
    stopDevServerWatch();
    deliverPendingRecoveryMessage();
  });

  win.once('ready-to-show', () => {
    win?.show();
    win?.focus();
  });

  if (DEV_SERVER_URL) {
    startDevServerHeartbeat();

    try {
      await win.loadURL(DEV_SERVER_URL);
    } catch (error) {
      logLifecycle('loadURL failed', String(error));
      watchDevServer('loadURL failed');
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

    if (process.platform !== 'darwin') {
      markUserQuitRequested('window-close');
      requestSessionFlush('quit');
      return;
    }

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
  pruneBrowserDayCacheOnBoot();
  registerProjectHandlers();
  registerCloudHandlers();
  registerAgentPipHandlers();
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
  registerMissionHandlers();
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
  if (process.platform === 'win32') {
    powerMonitor.on('session-end', () => {
      markUserQuitRequested('session-end');
    });
  }
  createWindow(appIcon);
  registerShortcuts();
  startMemoryWatch();
  startBrowserDayCacheWatch();
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
  stopBrowserDayCacheWatch();
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
    stopBrowserDayCacheWatch();
    return;
  }

  if (!userQuitRequested) {
    if (process.platform !== 'darwin' && windowCount === 0) {
      stopMemoryWatch();
      stopBrowserDayCacheWatch();
      logLifecycle('allowing quit after last window closed');
      return;
    }

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

    if (lastMainFrameLoadFailed && VITE_DEV_SERVER_URL) {
      watchDevServer('activate');
    }

    return;
  }

  createWindow(applyAppBranding());
});

app.on('will-quit', () => {
  flushProjectStoreWrites();
  stopDevServerWatch();
  stopDevServerHeartbeat();
  stopEnsuredDevServer();
  stopMemoryWatch();
  stopBrowserDayCacheWatch();
  globalShortcut.unregisterAll();
  ptyManager.killAll();
  agentPrintRunner.stopAll();
  testRunnerSession.stopAll();
  stopManagedRuntime();
  stopDesktopControlServer();
  stopIdleWakeLock();
  void cleanupEmulatorSessions();
  destroyAgentPipWindow();
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
