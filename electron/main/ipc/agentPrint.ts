import { ipcMain } from 'electron';
import { agentPrintRunner, type AgentPrintRunOptions } from '../services/agentPrintRunner';

export function registerAgentPrintHandlers(): void {
  ipcMain.handle('agent:printStart', (_, options: AgentPrintRunOptions) => {
    agentPrintRunner.start(options);
  });

  ipcMain.on('agent:printStop', (_, paneId: string) => {
    agentPrintRunner.stop(paneId);
  });

  ipcMain.handle('agent:printIsRunning', (_, paneId: string) =>
    agentPrintRunner.isRunning(paneId),
  );
}
