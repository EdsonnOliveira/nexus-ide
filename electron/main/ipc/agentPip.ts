import { ipcMain, type IpcMainEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import {
  focusAgentPipMainWindow,
  getAgentPipMainWindow,
  getAgentPipSnapshot,
  pinAgentPip,
  unpinAgentPip,
  updateAgentPip,
} from '../services/agentPipWindow';
import type { AgentPipCommand, AgentPipHostRequest, AgentPipSnapshot } from '../../types/agentPip';

const COMMAND_TIMEOUT_MS = 30_000;

function isAgentPipSnapshot(value: unknown): value is AgentPipSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const snapshot = value as AgentPipSnapshot;
  return typeof snapshot.paneId === 'string' && typeof snapshot.projectName === 'string';
}

function isAgentPipCommand(value: unknown): value is AgentPipCommand {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const command = value as AgentPipCommand;
  return typeof command.type === 'string' && typeof command.paneId === 'string';
}

function forwardCommandToMain(command: AgentPipCommand): Promise<boolean> {
  const main = getAgentPipMainWindow();
  if (!main || main.isDestroyed()) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const requestId = randomUUID();
    const request: AgentPipHostRequest = { ...command, requestId };

    const timer = setTimeout(() => {
      ipcMain.removeListener('agentPip:hostResult', onResult);
      resolve(false);
    }, COMMAND_TIMEOUT_MS);

    const onResult = (_event: IpcMainEvent, payload: unknown) => {
      if (!payload || typeof payload !== 'object') {
        return;
      }

      const result = payload as { requestId?: string; ok?: boolean };
      if (result.requestId !== requestId) {
        return;
      }

      clearTimeout(timer);
      ipcMain.removeListener('agentPip:hostResult', onResult);
      resolve(Boolean(result.ok));
    };

    ipcMain.on('agentPip:hostResult', onResult);
    main.webContents.send('agentPip:hostCommand', request);
  });
}

export function registerAgentPipHandlers(): void {
  ipcMain.handle('agentPip:pin', async (_, payload: unknown) => {
    if (!isAgentPipSnapshot(payload)) {
      return;
    }

    await pinAgentPip(payload);
  });

  ipcMain.handle('agentPip:update', (_, payload: unknown) => {
    if (!isAgentPipSnapshot(payload)) {
      return false;
    }

    return updateAgentPip(payload);
  });

  ipcMain.handle('agentPip:unpin', () => {
    unpinAgentPip(true);
  });

  ipcMain.handle('agentPip:getSnapshot', () => getAgentPipSnapshot());

  ipcMain.handle('agentPip:focusMain', () => {
    focusAgentPipMainWindow();
  });

  ipcMain.handle('agentPip:command', async (_, payload: unknown) => {
    if (!isAgentPipCommand(payload)) {
      return false;
    }

    return forwardCommandToMain(payload);
  });
}
