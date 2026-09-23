import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, nativeImage } from 'electron';
import { closeAgentFinishBanner, showAgentFinishBanner } from './agentFinishBanner';
import {
  focusAgentPipMainWindow,
  getAgentPipMainWindow,
  isNexusInForeground,
} from './agentPipWindow';

export type AgentFinishNotifyKind = 'git' | 'plan' | 'question';

export interface AgentFinishNotifyAction {
  id: string;
  label: string;
  primary?: boolean;
}

export interface AgentFinishNotifyPayload {
  projectId: string;
  paneId: string;
  projectName: string;
  projectLogo?: string | null;
  force?: boolean;
  kind?: AgentFinishNotifyKind;
  body?: string;
  activityId?: string;
  questionId?: string;
  actions?: AgentFinishNotifyAction[];
}

export interface AgentFinishActionPayload {
  action: string;
  projectId: string;
  paneId: string;
  kind?: AgentFinishNotifyKind;
  activityId?: string;
  questionId?: string;
}

const DEDUPE_MS = 15_000;
const SHOWN_TIMEOUT_MS = 20_000;
const ELECTRON_SHOWN_TIMEOUT_MS = 8_000;
const PROJECT_LOGO_SIZE = 48;
const recentShownAt = new Map<string, number>();
const activeHelpers = new Map<string, ChildProcess>();
const activeNotifications = new Set<Notification>();
let currentNotifyProjectId: string | null = null;
let notifyShowToken = 0;

app.on('before-quit', () => {
  for (const key of Array.from(activeHelpers.keys())) {
    stopHelper(key);
  }
});

function payloadKey(payload: AgentFinishNotifyPayload): string {
  return `${payload.projectId}:${payload.paneId}:${payload.kind ?? 'git'}`;
}

function wasShownRecently(key: string): boolean {
  const shownAt = recentShownAt.get(key);
  if (!shownAt) {
    return false;
  }

  if (Date.now() - shownAt < DEDUPE_MS) {
    return true;
  }

  recentShownAt.delete(key);
  return false;
}

function resolveNotifyPresentation(
  payload: AgentFinishNotifyPayload,
  projectName: string,
): {
  kind: AgentFinishNotifyKind;
  body: string;
  actions: AgentFinishNotifyAction[];
} {
  const kind = payload.kind ?? 'git';
  const fallbackBody =
    kind === 'plan'
      ? `O agent de ${projectName} pediu revisão do plano`
      : kind === 'question'
        ? `O agent de ${projectName} fez uma pergunta`
        : 'O agent finalizou, subir para o git?';
  const body = payload.body?.trim() || fallbackBody;
  const sourceActions =
    payload.actions && payload.actions.length > 0
      ? payload.actions
      : kind === 'git'
        ? [
            { id: 'dismiss', label: 'Ignorar' },
            { id: 'git', label: 'Subir para o git', primary: true },
          ]
        : [{ id: 'open', label: kind === 'plan' ? 'Abrir plano' : 'Responder', primary: true }];

  const lastIndex = sourceActions.length - 1;
  const actions = sourceActions.map((action, index) => ({
    ...action,
    primary:
      action.primary ??
      (action.id !== 'dismiss' && action.id !== 'ignore' && index === lastIndex),
  }));

  return { kind, body, actions };
}

function deliverAction(action: string, payload: AgentFinishNotifyPayload): void {
  if (action === 'dismiss' || action === 'ignore') {
    return;
  }

  focusAgentPipMainWindow();
  const win = getAgentPipMainWindow();
  if (!win || win.isDestroyed()) {
    return;
  }

  const message: AgentFinishActionPayload = {
    action,
    projectId: payload.projectId,
    paneId: payload.paneId,
    kind: payload.kind ?? 'git',
    activityId: payload.activityId,
    questionId: payload.questionId,
  };
  win.webContents.send('agentFinish:action', message);
}

function resolveNotificationHelperBinary(): string | null {
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
      process.resourcesPath,
      '../Helpers/NotificationHelper.app/Contents/MacOS/NotificationHelper',
    ),
    path.join(process.cwd(), 'resources/shell/macosNotificationReader'),
    path.join(process.resourcesPath, 'macosNotificationReader'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function stopHelper(key: string): void {
  const current = activeHelpers.get(key);
  if (!current) {
    return;
  }

  activeHelpers.delete(key);
  if (!current.killed) {
    current.kill();
  }
}

function parseHelperLine(line: string): { shown?: boolean; action?: string } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as { shown?: unknown; action?: unknown };
    const result: { shown?: boolean; action?: string } = {};
    if (typeof parsed.shown === 'boolean') {
      result.shown = parsed.shown;
    }
    if (typeof parsed.action === 'string') {
      result.action = parsed.action;
    }
    if (result.shown === undefined && result.action === undefined) {
      return null;
    }
    return result;
  } catch {
    return null;
  }
}

function stopAllHelpers(): void {
  for (const key of Array.from(activeHelpers.keys())) {
    stopHelper(key);
  }
}

function closeElectronNotifications(): void {
  for (const notification of Array.from(activeNotifications)) {
    activeNotifications.delete(notification);
    try {
      notification.close();
    } catch {
      continue;
    }
  }
}

function isCurrentNotifyShow(token: number, projectId: string): boolean {
  return token === notifyShowToken && currentNotifyProjectId === projectId;
}

export function dismissAgentFinishNotification(projectId?: string): void {
  const target = projectId?.trim() ?? '';
  if (target && currentNotifyProjectId && currentNotifyProjectId !== target) {
    return;
  }

  currentNotifyProjectId = null;
  closeAgentFinishBanner();
  stopAllHelpers();
  closeElectronNotifications();
}

function prepareProjectLogoThumbnail(logo: string | null | undefined): string | null {
  const raw = logo?.trim();
  if (!raw) {
    return null;
  }

  try {
    const image = raw.startsWith('data:')
      ? nativeImage.createFromDataURL(raw)
      : existsSync(raw)
        ? nativeImage.createFromPath(raw)
        : nativeImage.createEmpty();

    if (image.isEmpty()) {
      return null;
    }

    const resized = image.resize({
      width: PROJECT_LOGO_SIZE,
      height: PROJECT_LOGO_SIZE,
      quality: 'best',
    });
    const png = resized.toPNG();
    if (png.byteLength === 0) {
      return null;
    }

    const output = path.join(
      os.tmpdir(),
      `nexus-agent-finish-logo-${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
    );
    writeFileSync(output, png);
    return output;
  } catch {
    return null;
  }
}

function showElectronAgentFinishNotification(
  payload: AgentFinishNotifyPayload,
  presentation: { body: string; actions: AgentFinishNotifyAction[] },
  projectName: string,
  thumbnailPath: string | null,
): Promise<boolean> {
  if (!Notification.isSupported()) {
    return Promise.resolve(false);
  }

  const thumbnailImage =
    thumbnailPath && existsSync(thumbnailPath)
      ? nativeImage.createFromPath(thumbnailPath)
      : nativeImage.createEmpty();
  const hasThumbnail = !thumbnailImage.isEmpty();
  const buttonActions = presentation.actions
    .filter((action) => action.id !== 'dismiss' && action.id !== 'ignore')
    .slice(0, 4);
  const closeLabel =
    presentation.actions.find((action) => action.id === 'dismiss' || action.id === 'ignore')
      ?.label ?? 'Ignorar';

  const present = (useThumbnail: boolean): Promise<boolean> =>
    new Promise((resolve) => {
      let settled = false;
      const notification = new Notification({
        title: projectName,
        body: presentation.body,
        ...(useThumbnail ? { icon: thumbnailImage } : {}),
        silent: false,
        timeoutType: 'never',
        actions: buttonActions.map((action) => ({ type: 'button' as const, text: action.label })),
        closeButtonText: closeLabel,
      });

      activeNotifications.add(notification);

      const finishShown = (shown: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(shown);
      };

      const shownTimer = setTimeout(() => {
        finishShown(false);
      }, ELECTRON_SHOWN_TIMEOUT_MS);

      notification.on('show', () => {
        clearTimeout(shownTimer);
        finishShown(true);
      });

      notification.on('failed', () => {
        clearTimeout(shownTimer);
        activeNotifications.delete(notification);
        finishShown(false);
      });

      notification.on('click', () => {
        deliverAction('open', payload);
        activeNotifications.delete(notification);
      });

      notification.on('action', (_event, index) => {
        const selected = buttonActions[index];
        if (selected) {
          deliverAction(selected.id, payload);
        }
        activeNotifications.delete(notification);
      });

      notification.on('close', () => {
        activeNotifications.delete(notification);
      });

      try {
        notification.show();
      } catch {
        clearTimeout(shownTimer);
        activeNotifications.delete(notification);
        finishShown(false);
      }
    });

  return present(hasThumbnail).then((shown) => {
    if (shown || !hasThumbnail) {
      return shown;
    }
    return present(false);
  });
}

function thumbnailToDataUrl(thumbnailPath: string | null): string | null {
  if (!thumbnailPath || !existsSync(thumbnailPath)) {
    return null;
  }

  const image = nativeImage.createFromPath(thumbnailPath);
  if (image.isEmpty()) {
    return null;
  }

  return image.toDataURL();
}

export function showAgentFinishNotification(payload: AgentFinishNotifyPayload): Promise<boolean> {
  if (!payload.force && isNexusInForeground()) {
    return Promise.resolve(false);
  }

  if (process.platform !== 'darwin') {
    return Promise.resolve(false);
  }

  const projectName = payload.projectName.trim() || 'Projeto';
  const projectId = payload.projectId.trim();
  const key = payloadKey(payload);
  if (!payload.force && wasShownRecently(key)) {
    return Promise.resolve(true);
  }

  const thumbnailPath = prepareProjectLogoThumbnail(payload.projectLogo);
  const presentation = resolveNotifyPresentation(payload, projectName);
  currentNotifyProjectId = projectId;
  const showToken = ++notifyShowToken;

  return showAgentFinishBanner({
    projectName,
    body: presentation.body,
    projectLogoDataUrl: thumbnailToDataUrl(thumbnailPath),
    actions: presentation.actions,
    onAction: (actionId) => deliverAction(actionId, payload),
    onOpen: () => deliverAction('open', payload),
  }).then((shown) => {
    if (!isCurrentNotifyShow(showToken, projectId)) {
      if (showToken === notifyShowToken) {
        closeAgentFinishBanner();
      }
      return false;
    }

    if (shown) {
      recentShownAt.set(key, Date.now());
      return true;
    }

    return showHelperAgentFinishNotification(
      payload,
      presentation,
      projectName,
      projectId,
      key,
      thumbnailPath,
    );
  });
}

function showHelperAgentFinishNotification(
  payload: AgentFinishNotifyPayload,
  presentation: { body: string; actions: AgentFinishNotifyAction[] },
  projectName: string,
  projectId: string,
  key: string,
  thumbnailPath: string | null,
): Promise<boolean> {
  const binaryPath = resolveNotificationHelperBinary();
  if (!binaryPath) {
    return Promise.resolve(false);
  }

  stopAllHelpers();

  return new Promise((resolve) => {
    let settled = false;
    let buffer = '';
    const outputPath = path.join(
      os.tmpdir(),
      `nexus-agent-finish-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    const requestPayload = JSON.stringify({
      projectName,
      projectId,
      paneId: payload.paneId,
      projectLogo: thumbnailPath ?? '',
      body: presentation.body,
      actions: presentation.actions.map((action) => ({ id: action.id, label: action.label })),
    });
    const child = spawn(binaryPath, [outputPath, 'post-agent-finish', requestPayload, projectId], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NEXUS_AGENT_FINISH_PROJECT: projectName,
        NEXUS_AGENT_FINISH_PROJECT_ID: projectId,
        NEXUS_AGENT_FINISH_PROJECT_LOGO: thumbnailPath ?? '',
      },
    });

    activeHelpers.set(key, child);

    const shownTimer = setTimeout(() => {
      stopHelper(key);
      finishShown(false);
    }, SHOWN_TIMEOUT_MS);

    const finishShown = (shown: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(shownTimer);
      if (shown) {
        recentShownAt.set(key, Date.now());
      }
      resolve(shown);
    };

    const onLine = (line: string) => {
      const parsed = parseHelperLine(line);
      if (!parsed) {
        return;
      }

      if (parsed.shown !== undefined) {
        finishShown(parsed.shown);
      }

      if (parsed.action === 'dismiss' || parsed.action === 'ignore') {
        stopHelper(key);
        return;
      }

      if (parsed.action) {
        deliverAction(parsed.action, payload);
        stopHelper(key);
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        onLine(line);
      }
    });

    child.on('error', () => {
      stopHelper(key);
      finishShown(false);
    });

    child.on('exit', () => {
      if (buffer.trim()) {
        onLine(buffer);
      }
      activeHelpers.delete(key);
      finishShown(false);
    });
  });
}
