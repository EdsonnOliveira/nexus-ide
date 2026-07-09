import { create } from 'zustand';
import type { ProjectTestEntry, TestRunSnapshot, TestRunStep } from '@/types/test';
import {
  applyTestOutputToSteps,
  finalizeTestSteps,
} from '@/utils/testOutputTracker';

interface ActiveTestRun extends TestRunSnapshot {
  kind: ProjectTestEntry['kind'];
  logTail: string;
}

interface TestExecutionState {
  runsByEntryId: Record<string, ActiveTestRun>;
  expandedEntryId: string | null;
  setExpandedEntryId: (entryId: string | null) => void;
  beginPreparingRun: (
    entry: ProjectTestEntry,
    projectId: string,
    steps: TestRunStep[],
  ) => void;
  activateRun: (entryId: string, runId: string) => void;
  failPreparingRun: (entryId: string, error: string) => void;
  cancelPreparingRun: (entryId: string) => void;
  startRun: (
    entry: ProjectTestEntry,
    projectId: string,
    runId: string,
    steps: TestRunStep[],
  ) => void;
  applyOutput: (runId: string, chunk: string) => void;
  finishRun: (runId: string, exitCode: number, error?: string | null) => void;
  stopRun: (entryId: string) => void;
  getRunForEntry: (entryId: string) => ActiveTestRun | null;
  countRunning: () => number;
}

function buildRunningSteps(steps: TestRunStep[]): TestRunStep[] {
  const resetSteps = steps.map((step) => ({ ...step, status: 'pending' as const }));

  if (resetSteps.length === 0) {
    return resetSteps;
  }

  return resetSteps.map((step, index) =>
    index === 0 ? { ...step, status: 'running' as const } : step,
  );
}

export const useTestExecutionStore = create<TestExecutionState>((set, get) => ({
  runsByEntryId: {},
  expandedEntryId: null,
  setExpandedEntryId: (entryId) => set({ expandedEntryId: entryId }),
  beginPreparingRun: (entry, projectId, steps) => {
    set((state) => ({
      expandedEntryId: entry.id,
      runsByEntryId: {
        ...state.runsByEntryId,
        [entry.id]: {
          entryId: entry.id,
          projectId,
          runId: '',
          kind: entry.kind,
          status: 'preparing',
          steps: steps.map((step) => ({ ...step, status: 'pending' as const })),
          startedAt: Date.now(),
          finishedAt: null,
          error: null,
          logTail: '',
        },
      },
    }));
  },
  activateRun: (entryId, runId) => {
    set((state) => {
      const entry = state.runsByEntryId[entryId];

      if (!entry || entry.status !== 'preparing') {
        return state;
      }

      return {
        runsByEntryId: {
          ...state.runsByEntryId,
          [entryId]: {
            ...entry,
            runId,
            status: 'running',
            steps: buildRunningSteps(entry.steps),
          },
        },
      };
    });
  },
  failPreparingRun: (entryId, error) => {
    set((state) => {
      const entry = state.runsByEntryId[entryId];

      if (!entry || entry.status !== 'preparing') {
        return state;
      }

      return {
        runsByEntryId: {
          ...state.runsByEntryId,
          [entryId]: {
            ...entry,
            status: 'failed',
            finishedAt: Date.now(),
            error,
          },
        },
      };
    });
  },
  cancelPreparingRun: (entryId) => {
    set((state) => {
      const entry = state.runsByEntryId[entryId];

      if (!entry || entry.status !== 'preparing') {
        return state;
      }

      const nextRuns = { ...state.runsByEntryId };
      delete nextRuns[entryId];

      return {
        expandedEntryId: state.expandedEntryId === entryId ? null : state.expandedEntryId,
        runsByEntryId: nextRuns,
      };
    });
  },
  startRun: (entry, projectId, runId, steps) => {
    set((state) => ({
      expandedEntryId: entry.id,
      runsByEntryId: {
        ...state.runsByEntryId,
        [entry.id]: {
          entryId: entry.id,
          projectId,
          runId,
          kind: entry.kind,
          status: 'running',
          steps: buildRunningSteps(steps),
          startedAt: Date.now(),
          finishedAt: null,
          error: null,
          logTail: '',
        },
      },
    }));
  },
  applyOutput: (runId, chunk) => {
    set((state) => {
      const entry = Object.values(state.runsByEntryId).find((run) => run.runId === runId);

      if (!entry) {
        return state;
      }

      const { steps, logTail } = applyTestOutputToSteps(
        entry.kind,
        entry.steps,
        chunk,
        entry.logTail,
      );

      return {
        runsByEntryId: {
          ...state.runsByEntryId,
          [entry.entryId]: {
            ...entry,
            steps,
            logTail,
          },
        },
      };
    });
  },
  finishRun: (runId, exitCode, error = null) => {
    set((state) => {
      const entry = Object.values(state.runsByEntryId).find((run) => run.runId === runId);

      if (!entry || entry.status !== 'running') {
        return state;
      }

      return {
        runsByEntryId: {
          ...state.runsByEntryId,
          [entry.entryId]: {
            ...entry,
            status: exitCode === 0 ? 'passed' : 'failed',
            steps: finalizeTestSteps(entry.steps, exitCode),
            finishedAt: Date.now(),
            error,
          },
        },
      };
    });
  },
  stopRun: (entryId) => {
    set((state) => {
      const entry = state.runsByEntryId[entryId];

      if (!entry || entry.status !== 'running') {
        return state;
      }

      const steps = entry.steps.map((step) => {
        if (step.status === 'running') {
          return { ...step, status: 'failed' as const };
        }

        if (step.status === 'pending') {
          return { ...step, status: 'skipped' as const };
        }

        return step;
      });

      return {
        runsByEntryId: {
          ...state.runsByEntryId,
          [entryId]: {
            ...entry,
            status: 'failed',
            steps,
            finishedAt: Date.now(),
            error: 'Teste interrompido',
          },
        },
      };
    });
  },
  getRunForEntry: (entryId) => get().runsByEntryId[entryId] ?? null,
  countRunning: () =>
    Object.values(get().runsByEntryId).filter(
      (run) => run.status === 'running' || run.status === 'preparing',
    ).length,
}));

export function useTestRunForEntry(entryId: string): ActiveTestRun | null {
  return useTestExecutionStore((state) => state.runsByEntryId[entryId] ?? null);
}

export function useRunningTestCount(): number {
  return useTestExecutionStore((state) =>
    Object.values(state.runsByEntryId).filter(
      (run) => run.status === 'running' || run.status === 'preparing',
    ).length,
  );
}
