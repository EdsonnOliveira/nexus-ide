import { ipcMain } from 'electron';
import { recordHomeActivityMetric } from '../services/homeActivityStore';
import { getHomeDashboardActivityComparison } from '../services/homeDashboardStats';

export function registerHomeDashboardHandlers(): void {
  ipcMain.handle('homeDashboard:getStats', async (_, projectPaths: string[]) =>
    getHomeDashboardActivityComparison(Array.isArray(projectPaths) ? projectPaths : []),
  );

  ipcMain.handle(
    'homeDashboard:recordActivity',
    async (_, kind: 'prompts' | 'agentExecutions') => {
      if (kind === 'prompts' || kind === 'agentExecutions') {
        recordHomeActivityMetric(kind);
      }
    },
  );
}
