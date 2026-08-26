import { ipcMain } from 'electron';
import {
  agentPrintRunner,
  type AgentPrintRunOptions,
  type AgentPrintStopOptions,
} from '../services/agentPrintRunner';

export function registerAgentPrintHandlers(): void {
  ipcMain.handle('agent:printStart', (_, options: AgentPrintRunOptions) => {
    agentPrintRunner.start(options);
  });

  ipcMain.on('agent:printStop', (_, paneId: string, options?: AgentPrintStopOptions) => {
    agentPrintRunner.stop(paneId, options);
  });

  ipcMain.handle('agent:printIsRunning', (_, paneId: string) => agentPrintRunner.isRunning(paneId));

  ipcMain.handle('agent:printWarm', async () => {
    await agentPrintRunner.warm();
  });
}
