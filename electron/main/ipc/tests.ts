import { ipcMain } from 'electron';
import { discoverTests } from '../services/testDiscovery';
import { resolveTestSteps } from '../services/testStepResolver';
import { testRunnerSession } from '../services/testRunnerSession';
import type { ProjectTestEntry, TestRunnerKind, TestRunStep } from '../../types/test';

export function registerTestHandlers(): void {
  ipcMain.handle('tests:discover', (_, projectPath: string, kind: TestRunnerKind) =>
    discoverTests(projectPath, kind),
  );

  ipcMain.handle('tests:resolveSteps', (_, projectPath: string, entry: ProjectTestEntry) =>
    resolveTestSteps(projectPath, entry),
  );

  ipcMain.handle(
    'tests:run',
    (_, projectPath: string, projectId: string, entry: ProjectTestEntry, steps: TestRunStep[] = []) =>
      testRunnerSession.start(projectPath, projectId, entry, steps),
  );

  ipcMain.handle('tests:stop', (_, runId: string) => {
    testRunnerSession.stop(runId);
  });

  ipcMain.handle('tests:isRunning', (_, runId: string) => testRunnerSession.isRunning(runId));

  ipcMain.handle('tests:prepareMaestroRun', (_, steps: TestRunStep[]) =>
    testRunnerSession.prepareMaestroRun(steps),
  );

  ipcMain.handle('tests:resolveHighlight', (_, runId: string, source: string) => {
    testRunnerSession.resolveMaestroHighlight(runId, source);
  });
}
