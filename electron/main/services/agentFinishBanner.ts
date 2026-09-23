import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, screen } from 'electron';

const BANNER_WIDTH = 420;
const BANNER_HEIGHT = 120;
const BANNER_PAD = 14;
const BANNER_TIMEOUT_MS = 45_000;

export interface AgentBannerAction {
  id: string;
  label: string;
  primary?: boolean;
}

let bannerWindow: BrowserWindow | null = null;
let bannerTimer: ReturnType<typeof setTimeout> | null = null;
let bannerHandlerBound = false;
let currentOnAction: ((id: string) => void) | null = null;
let currentOpen: (() => void) | null = null;

function resolvePreloadPath(): string {
  const appRoot = process.env.APP_ROOT ?? app.getAppPath();
  return path.join(appRoot, 'dist-electron/preload/index.cjs');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function bindBannerIpc(): void {
  if (bannerHandlerBound) {
    return;
  }

  bannerHandlerBound = true;
  ipcMain.on('agentFinish:bannerAction', (_event, action: unknown) => {
    if (typeof action !== 'string' || !action.trim()) {
      return;
    }

    const actionId = action.trim();
    if (actionId === 'open') {
      currentOpen?.();
      closeAgentFinishBanner();
      return;
    }

    if (actionId === 'dismiss' || actionId === 'ignore') {
      closeAgentFinishBanner();
      return;
    }

    currentOnAction?.(actionId);
    closeAgentFinishBanner();
  });
}

function resolveFocusedWindowHelper(): string | null {
  const candidates = [
    path.join(
      process.cwd(),
      'resources/shell/NotificationHelper.app/Contents/MacOS/NotificationHelper',
    ),
    path.join(
      app.getAppPath(),
      'Contents/Helpers/NotificationHelper.app/Contents/MacOS/NotificationHelper',
    ),
    path.join(
      app.getPath('exe'),
      '../../Helpers/NotificationHelper.app/Contents/MacOS/NotificationHelper',
    ),
    path.join(process.cwd(), 'resources/shell/macosNotificationReader'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function readFocusedWindowCenter(): { x: number; y: number } | null {
  const binaryPath = resolveFocusedWindowHelper();
  if (!binaryPath) {
    return null;
  }

  try {
    const outputPath = path.join(os.tmpdir(), 'nexus-focused-window.json');
    execFileSync(binaryPath, [outputPath, 'focused-window'], {
      encoding: 'utf8',
      timeout: 1500,
    });
    const raw = existsSync(outputPath) ? readFileSync(outputPath, 'utf8').trim() : '';
    const line = raw.split('\n').filter((entry) => entry.trim().startsWith('{')).at(-1);
    if (!line) {
      return null;
    }

    const parsed = JSON.parse(line) as { x?: unknown; y?: unknown };
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') {
      return null;
    }

    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

function resolveTargetDisplay(): Electron.Display {
  const focused = readFocusedWindowCenter();
  if (focused) {
    return screen.getDisplayNearestPoint(focused);
  }

  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function bannerBounds(display: Electron.Display, height = BANNER_HEIGHT) {
  const area = display.workArea;
  return {
    x: area.x + Math.max(BANNER_PAD, area.width - BANNER_WIDTH - BANNER_PAD),
    y: area.y + BANNER_PAD,
    width: BANNER_WIDTH,
    height,
  };
}

function placeBanner(
  window: BrowserWindow,
  display: Electron.Display,
  height = BANNER_HEIGHT,
): void {
  window.setBounds(bannerBounds(display, height));
}

function buildBannerHtml(
  projectName: string,
  bodyText: string,
  projectLogoDataUrl: string | null,
  actions: AgentBannerAction[],
): string {
  const title = escapeHtml(projectName);
  const body = escapeHtml(bodyText);
  const projectImg = projectLogoDataUrl
    ? `<img class="logo" src="${projectLogoDataUrl}" alt="" />`
    : '';
  const buttons = actions
    .map(
      (action) =>
        `<button class="${action.primary ? 'git' : 'ignore'}" data-action="${escapeHtml(action.id)}" type="button">${escapeHtml(action.label)}</button>`,
    )
    .join('');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        overflow: hidden;
        background: transparent;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", sans-serif;
        color: #f5f5f7;
        user-select: none;
      }
      .card {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
        box-sizing: border-box;
        padding: 12px 14px;
        border-radius: 18px;
        background: rgba(36, 36, 38, 0.92);
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
      }
      .row {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .logo {
        width: 36px;
        height: 36px;
        border-radius: 8px;
        object-fit: cover;
        flex-shrink: 0;
      }
      .copy {
        min-width: 0;
        flex: 1;
      }
      .title {
        font-size: 13px;
        font-weight: 650;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .body {
        margin-top: 2px;
        font-size: 12px;
        line-height: 1.35;
        color: rgba(245, 245, 247, 0.78);
        white-space: pre-wrap;
        display: -webkit-box;
        -webkit-line-clamp: 5;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
      }
      button {
        appearance: none;
        border: 0;
        cursor: pointer;
        height: 26px;
        padding: 0 10px;
        max-width: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        border-radius: 8px;
        font: 600 11px/1 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
        transition: filter 120ms ease, background 120ms ease;
      }
      button:hover:not(:disabled) {
        filter: brightness(1.12);
      }
      .git {
        background: #f5f5f7;
        color: #111;
      }
      .ignore {
        background: rgba(255, 255, 255, 0.08);
        color: #f5f5f7;
      }
    </style>
  </head>
  <body>
    <div class="card" id="card">
      <div class="row">
        ${projectImg}
        <div class="copy">
          <div class="title">${title}</div>
          <div class="body">${body}</div>
        </div>
      </div>
      <div class="actions">
        ${buttons}
      </div>
    </div>
    <script>
      const send = (action) => window.nexus?.agentFinish?.sendBannerAction?.(action);
      document.querySelectorAll('[data-action]').forEach((button) => {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          send(button.getAttribute('data-action'));
        });
      });
      document.getElementById('card')?.addEventListener('click', () => send('open'));
    </script>
  </body>
</html>`;
}

export function closeAgentFinishBanner(): void {
  if (bannerTimer) {
    clearTimeout(bannerTimer);
    bannerTimer = null;
  }

  currentOnAction = null;
  currentOpen = null;

  if (!bannerWindow || bannerWindow.isDestroyed()) {
    bannerWindow = null;
    return;
  }

  bannerWindow.close();
  bannerWindow = null;
}

export function showAgentFinishBanner(options: {
  projectName: string;
  body: string;
  projectLogoDataUrl: string | null;
  actions: AgentBannerAction[];
  onAction: (id: string) => void;
  onOpen: () => void;
}): Promise<boolean> {
  bindBannerIpc();
  closeAgentFinishBanner();

  currentOnAction = options.onAction;
  currentOpen = options.onOpen;

  const display = resolveTargetDisplay();
  const initialBounds = bannerBounds(display);

  const window = new BrowserWindow({
    x: initialBounds.x,
    y: initialBounds.y,
    width: initialBounds.width,
    height: initialBounds.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: true,
    focusable: true,
    roundedCorners: true,
    alwaysOnTop: true,
    ...(process.platform === 'darwin'
      ? {
          type: 'panel' as const,
          hiddenInMissionControl: true,
          titleBarStyle: 'hidden' as const,
        }
      : {}),
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  window.setWindowButtonVisibility(false);
  if (process.platform === 'darwin') {
    window.setAlwaysOnTop(true, 'screen-saver');
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  }

  placeBanner(window, display);
  bannerWindow = window;

  window.on('closed', () => {
    if (bannerWindow === window) {
      bannerWindow = null;
    }
  });

  const html = buildBannerHtml(
    options.projectName,
    options.body,
    options.projectLogoDataUrl,
    options.actions,
  );
  const htmlPath = path.join(os.tmpdir(), 'nexus-agent-finish-banner.html');
  writeFileSync(htmlPath, html);

  return window.loadFile(htmlPath).then(
    async () => {
      if (window.isDestroyed()) {
        return false;
      }

      const contentHeight = await window.webContents.executeJavaScript(
        'Math.ceil(document.querySelector(".card").getBoundingClientRect().height)',
      );
      if (!window.isDestroyed() && typeof contentHeight === 'number' && contentHeight > 0) {
        placeBanner(window, display, contentHeight);
      }

      if (app.isHidden()) {
        app.show();
      }

      window.showInactive();
      if (process.platform === 'darwin') {
        window.setAlwaysOnTop(true, 'screen-saver');
        window.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: true,
          skipTransformProcessType: true,
        });
      }
      window.moveTop();
      placeBanner(
        window,
        display,
        typeof contentHeight === 'number' && contentHeight > 0 ? contentHeight : BANNER_HEIGHT,
      );
      bannerTimer = setTimeout(() => {
        closeAgentFinishBanner();
      }, BANNER_TIMEOUT_MS);
      return true;
    },
    () => false,
  );
}
