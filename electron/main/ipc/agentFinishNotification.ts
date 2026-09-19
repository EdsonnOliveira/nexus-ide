import { ipcMain } from 'electron';
import {
  showAgentFinishNotification,
  type AgentFinishNotifyPayload,
} from '../services/agentFinishNotification';

function isAgentFinishNotifyPayload(value: unknown): value is AgentFinishNotifyPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const payload = value as AgentFinishNotifyPayload;
  return (
    typeof payload.projectId === 'string' &&
    typeof payload.paneId === 'string' &&
    typeof payload.projectName === 'string'
  );
}

export function registerAgentFinishNotificationHandlers(): void {
  ipcMain.handle('agentFinish:notify', (_, payload: unknown) => {
    if (!isAgentFinishNotifyPayload(payload)) {
      return false;
    }

    return showAgentFinishNotification(payload);
  });
}
