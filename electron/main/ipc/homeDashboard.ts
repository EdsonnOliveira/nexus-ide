import { ipcMain } from 'electron';
import { recordHomeActivityMetric } from '../services/homeActivityStore';
import {
  getHomeDashboardActivityComparison,
  resolveDashboardAiProvider,
} from '../services/homeDashboardStats';

export function registerHomeDashboardHandlers(): void {
  ipcMain.handle(
    'homeDashboard:getStats',
    async (_, projectPaths: string[], provider?: unknown) =>
      getHomeDashboardActivityComparison(
        Array.isArray(projectPaths) ? projectPaths : [],
        resolveDashboardAiProvider(provider),
      ),
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
