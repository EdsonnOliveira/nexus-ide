import { ipcMain } from 'electron';
import {
  dismissAgentFinishNotification,
  showAgentFinishNotification,
  type AgentFinishNotifyAction,
  type AgentFinishNotifyKind,
  type AgentFinishNotifyPayload,
} from '../services/agentFinishNotification';

const NOTIFY_KINDS: AgentFinishNotifyKind[] = ['git', 'plan', 'question'];

function isNotifyAction(value: unknown): value is AgentFinishNotifyAction {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const action = value as AgentFinishNotifyAction;
  return (
    typeof action.id === 'string' &&
    action.id.trim().length > 0 &&
    typeof action.label === 'string' &&
    action.label.trim().length > 0 &&
    (action.primary === undefined || typeof action.primary === 'boolean')
  );
}

function isAgentFinishNotifyPayload(value: unknown): value is AgentFinishNotifyPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const payload = value as AgentFinishNotifyPayload;
  if (
    typeof payload.projectId !== 'string' ||
    typeof payload.paneId !== 'string' ||
    typeof payload.projectName !== 'string' ||
    (payload.projectLogo !== undefined &&
      payload.projectLogo !== null &&
      typeof payload.projectLogo !== 'string') ||
    (payload.force !== undefined && typeof payload.force !== 'boolean') ||
    (payload.kind !== undefined && !NOTIFY_KINDS.includes(payload.kind)) ||
    (payload.body !== undefined && typeof payload.body !== 'string') ||
    (payload.activityId !== undefined && typeof payload.activityId !== 'string') ||
    (payload.questionId !== undefined && typeof payload.questionId !== 'string')
  ) {
    return false;
  }

  if (payload.actions !== undefined) {
    if (!Array.isArray(payload.actions) || !payload.actions.every(isNotifyAction)) {
      return false;
    }
  }

  return true;
}

export function registerAgentFinishNotificationHandlers(): void {
  ipcMain.handle('agentFinish:notify', (_, payload: unknown) => {
    if (!isAgentFinishNotifyPayload(payload)) {
      return false;
    }

    return showAgentFinishNotification(payload);
  });

  ipcMain.on('agentFinish:dismiss', (_event, projectId: unknown) => {
    dismissAgentFinishNotification(typeof projectId === 'string' ? projectId : undefined);
  });
}
