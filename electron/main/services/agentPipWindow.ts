import { app, screen, BrowserWindow, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import type { AgentPipSnapshot } from '../../types/agentPip';

const PIP_WIDTH = 456;
const PIP_HEIGHT = 520;
const PIP_PAD = 12;
const MOVE_SNAP_MS = 90;

let pipWindow: BrowserWindow | null = null;
let getMainWindow: () => BrowserWindow | null = () => null;
let preloadPath = '';
let loadPipUrl: ((window: BrowserWindow) => Promise<void>) | null = null;
let snapshot: AgentPipSnapshot | null = null;
let snapshotRevision = 0;
let moveSnapTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityWatch: ReturnType<typeof setInterval> | null = null;
let detachMain: (() => void) | null = null;
let detachApp: (() => void) | null = null;
let pipReady = false;

function isNexusInForeground() {
  try {
    const main = getMainWindow();
    if (!main || main.isDestroyed()) {
      return false;
    }

    if (!main.isVisible() || main.isMinimized()) {
      return false;
    }

    if (process.platform === 'darwin' && app.isHidden()) {
      return false;
    }

    if (process.platform === 'darwin') {
      try {
        if (!main.isOnActiveSpace()) {
          return false;
        }
      } catch {
        // ignore
      }
    }

    const pipFocused = Boolean(pipWindow && !pipWindow.isDestroyed() && pipWindow.isFocused());
    if (pipFocused) {
      return false;
    }

    if (process.platform === 'darwin' && !app.isActive()) {
      return false;
    }

    return main.isFocused();
  } catch {
    return false;
  }
}

function resolveCorners(display: Electron.Display) {
  const area = display.workArea;
  const maxX = area.x + Math.max(PIP_PAD, area.width - PIP_WIDTH - PIP_PAD);
  const maxY = area.y + Math.max(PIP_PAD, area.height - PIP_HEIGHT - PIP_PAD);
  const minX = area.x + PIP_PAD;
  const minY = area.y + PIP_PAD;

  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: minX, y: maxY },
    { x: maxX, y: maxY },
  ];
}

function snapToNearestCorner(window: BrowserWindow) {
  if (window.isDestroyed()) {
    return;
  }

  const [cx, cy] = window.getPosition();
  const display = screen.getDisplayNearestPoint({ x: cx, y: cy });
  const corners = resolveCorners(display);
  const nearest = corners.reduce(
    (best, corner) => {
      const distance = Math.hypot(corner.x - cx, corner.y - cy);
      return distance < best.distance ? { corner, distance } : best;
    },
    { corner: corners[3], distance: Number.POSITIVE_INFINITY },
  );

  if (cx === nearest.corner.x && cy === nearest.corner.y) {
    return;
  }

  window.setPosition(nearest.corner.x, nearest.corner.y);
}

function placeAtDefaultCorner(window: BrowserWindow) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const corners = resolveCorners(display);
  window.setBounds({
    x: corners[3].x,
    y: corners[3].y,
    width: PIP_WIDTH,
    height: PIP_HEIGHT,
  });
}

function notifyMainUnpinned() {
  const main = getMainWindow();
  if (main && !main.isDestroyed()) {
    main.webContents.send('agentPip:unpinned');
  }
}

function sendSnapshot(contents: WebContents) {
  if (!snapshot || contents.isDestroyed()) {
    return;
  }

  contents.send('agentPip:snapshot', snapshot);
}

function shouldShowPip() {
  if (!snapshot) {
    return false;
  }

  return !isNexusInForeground();
}

function movePipToCursorDisplayIfNeeded(window: BrowserWindow) {
  if (window.isDestroyed()) {
    return;
  }

  const [cx, cy] = window.getPosition();
  const windowDisplay = screen.getDisplayNearestPoint({ x: cx, y: cy });
  const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

  if (windowDisplay.id !== cursorDisplay.id) {
    placeAtDefaultCorner(window);
  }
}

function revealPipWindow(window: BrowserWindow) {
  sendSnapshot(window.webContents);
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (process.platform === 'darwin' && app.isHidden()) {
    app.show();
  }

  movePipToCursorDisplayIfNeeded(window);
  if (window.isVisible()) {
    window.moveTop();
  } else {
    window.show();
  }
}

function syncVisibility() {
  if (!pipWindow || pipWindow.isDestroyed()) {
    return;
  }

  if (shouldShowPip()) {
    revealPipWindow(pipWindow);
    return;
  }

  if (pipWindow.isVisible()) {
    pipWindow.hide();
  }
}

function startVisibilityWatch() {
  if (visibilityWatch) {
    return;
  }

  visibilityWatch = setInterval(() => {
    syncVisibility();
  }, 250);
}

function stopVisibilityWatch() {
  if (!visibilityWatch) {
    return;
  }

  clearInterval(visibilityWatch);
  visibilityWatch = null;
}

function scheduleVisibility() {
  if (visibilityTimer) {
    clearTimeout(visibilityTimer);
  }

  visibilityTimer = setTimeout(() => {
    visibilityTimer = null;
    syncVisibility();
  }, 60);
}

function attachPipWindowEvents(window: BrowserWindow) {
  window.on('moved', () => {
    if (moveSnapTimer) {
      clearTimeout(moveSnapTimer);
    }

    moveSnapTimer = setTimeout(() => {
      moveSnapTimer = null;
      snapToNearestCorner(window);
    }, MOVE_SNAP_MS);
  });

  window.on('blur', () => {
    scheduleVisibility();
  });

  window.on('focus', () => {
    const paneId = snapshot?.paneId;
    const main = getMainWindow();
    if (!paneId || !main || main.isDestroyed()) {
      return;
    }

    main.webContents.send('agentPip:hostCommand', {
      type: 'ackViewed',
      paneId,
      requestId: randomUUID(),
    });
  });

  window.webContents.on('did-finish-load', () => {
    pipReady = true;
    sendSnapshot(window.webContents);
    scheduleVisibility();
  });
}

async function ensurePipWindow() {
  if (pipWindow && !pipWindow.isDestroyed()) {
    return pipWindow;
  }

  pipReady = false;
  const window = new BrowserWindow({
    width: PIP_WIDTH,
    height: PIP_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: true,
    focusable: true,
    roundedCorners: true,
    ...(process.platform === 'darwin'
      ? { hiddenInMissionControl: true, titleBarStyle: 'hidden' }
      : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: true,
    },
  });

  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setWindowButtonVisibility(false);
  placeAtDefaultCorner(window);
  attachPipWindowEvents(window);
  pipWindow = window;

  if (loadPipUrl) {
    void loadPipUrl(window);
  }

  return window;
}

export function configureAgentPipWindow(options: {
  getMainWindow: () => BrowserWindow | null;
  preload: string;
  loadUrl: (window: BrowserWindow) => Promise<void>;
}) {
  getMainWindow = options.getMainWindow;
  preloadPath = options.preload;
  loadPipUrl = options.loadUrl;
}

function bindAppVisibility() {
  if (detachApp) {
    return;
  }

  const onAppChange = () => scheduleVisibility();
  const onActivate = () => {
    if (pipWindow && !pipWindow.isDestroyed() && pipWindow.isFocused()) {
      scheduleVisibility();
      return;
    }

    if (snapshot && shouldShowPip()) {
      scheduleVisibility();
      return;
    }

    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      if (main.isMinimized()) {
        main.restore();
      }

      main.show();
      main.focus();
    }

    scheduleVisibility();
  };

  app.on('hide', onAppChange);
  app.on('show', onAppChange);
  app.on('activate', onActivate);
  screen.on('display-metrics-changed', onAppChange);
  screen.on('display-added', onAppChange);
  screen.on('display-removed', onAppChange);

  detachApp = () => {
    app.off('hide', onAppChange);
    app.off('show', onAppChange);
    app.off('activate', onActivate);
    screen.off('display-metrics-changed', onAppChange);
    screen.off('display-added', onAppChange);
    screen.off('display-removed', onAppChange);
    detachApp = null;
  };
}

export function bindAgentPipMainWindow(window: BrowserWindow) {
  detachMain?.();
  bindAppVisibility();

  const onVisibility = () => scheduleVisibility();
  const onClosed = () => {
    destroyAgentPipWindow();
  };

  window.on('blur', onVisibility);
  window.on('focus', onVisibility);
  window.on('hide', onVisibility);
  window.on('show', onVisibility);
  window.on('minimize', onVisibility);
  window.on('restore', onVisibility);
  window.on('moved', onVisibility);
  window.on('resized', onVisibility);
  window.on('closed', onClosed);

  detachMain = () => {
    if (!window.isDestroyed()) {
      window.off('blur', onVisibility);
      window.off('focus', onVisibility);
      window.off('hide', onVisibility);
      window.off('show', onVisibility);
      window.off('minimize', onVisibility);
      window.off('restore', onVisibility);
      window.off('moved', onVisibility);
      window.off('resized', onVisibility);
      window.off('closed', onClosed);
    }
    detachMain = null;
  };
}

export async function pinAgentPip(next: AgentPipSnapshot) {
  snapshotRevision = typeof next.revision === 'number' ? next.revision : 0;
  snapshot = next;
  const window = await ensurePipWindow();
  if (pipReady) {
    sendSnapshot(window.webContents);
  }
  startVisibilityWatch();
  syncVisibility();
}

export function updateAgentPip(next: AgentPipSnapshot): boolean {
  const nextRevision = typeof next.revision === 'number' ? next.revision : 0;
  if (nextRevision > 0 && nextRevision < snapshotRevision) {
    return false;
  }

  if (!snapshot || snapshot.paneId !== next.paneId) {
    return false;
  }

  snapshotRevision = nextRevision;
  snapshot = next;
  if (pipWindow && !pipWindow.isDestroyed() && pipReady) {
    sendSnapshot(pipWindow.webContents);
  }

  return true;
}

export function unpinAgentPip(notifyMain = false) {
  snapshot = null;
  snapshotRevision = 0;
  pipReady = false;
  stopVisibilityWatch();

  if (pipWindow && !pipWindow.isDestroyed()) {
    pipWindow.hide();
  }

  if (notifyMain) {
    notifyMainUnpinned();
  }
}

export function getAgentPipSnapshot() {
  return snapshot;
}

export function getAgentPipMainWindow() {
  return getMainWindow();
}

export function focusAgentPipMainWindow() {
  const main = getMainWindow();
  if (!main || main.isDestroyed()) {
    return;
  }

  if (process.platform === 'darwin') {
    app.show();
    app.focus({ steal: true });
  }

  if (main.isMinimized()) {
    main.restore();
  }

  main.show();
  main.moveTop();
  main.focus();
  scheduleVisibility();
}

export function destroyAgentPipWindow() {
  snapshot = null;
  pipReady = false;
  stopVisibilityWatch();

  if (moveSnapTimer) {
    clearTimeout(moveSnapTimer);
    moveSnapTimer = null;
  }

  if (visibilityTimer) {
    clearTimeout(visibilityTimer);
    visibilityTimer = null;
  }

  if (pipWindow && !pipWindow.isDestroyed()) {
    pipWindow.destroy();
  }

  pipWindow = null;
}
