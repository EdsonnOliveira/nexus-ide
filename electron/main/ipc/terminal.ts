import { ipcMain } from 'electron';
import type { TerminalAgent } from '../../types';
import { removeAgentShellHome } from '../services/agentShellHome';
import { ptyManager, type TerminalCreateOptions } from '../services/ptyManager';

export function registerTerminalHandlers(): void {
  ipcMain.handle(
    'terminal:create',
    (_, cwd: string, agent: TerminalAgent, options?: TerminalCreateOptions) => {
      try {
        return ptyManager.create(cwd, agent, options);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown terminal error';
        throw new Error(`Failed to spawn terminal: ${message}`);
      }
    },
  );

  ipcMain.handle('terminal:has', (_, ptyId: string) => ptyManager.has(ptyId));

  ipcMain.handle('terminal:getScrollback', (_, ptyId: string) => ptyManager.getScrollback(ptyId));

  ipcMain.handle('terminal:getScrollbackTail', (_, ptyId: string, maxBytes: number) =>
    ptyManager.getScrollbackTail(ptyId, maxBytes),
  );

  ipcMain.handle('terminal:removeAgentShellHome', (_, isolationKey: string) => {
    removeAgentShellHome(isolationKey);
  });

  ipcMain.on('terminal:write', (_, ptyId: string, data: string) => {
    ptyManager.write(ptyId, data);
  });

  ipcMain.on('terminal:resize', (_, ptyId: string, cols: number, rows: number) => {
    ptyManager.resize(ptyId, cols, rows);
  });

  ipcMain.on('terminal:kill', (_, ptyId: string) => {
    ptyManager.kill(ptyId);
  });
}
