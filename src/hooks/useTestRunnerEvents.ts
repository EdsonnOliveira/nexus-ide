import { useEffect, useRef } from 'react';
import { useMaestroHighlightStore } from '@/stores/useMaestroHighlightStore';
import { useTestExecutionStore } from '@/stores/useTestExecutionStore';

export function useTestRunnerEvents(): void {
  const applyOutput = useTestExecutionStore((state) => state.applyOutput);
  const finishRun = useTestExecutionStore((state) => state.finishRun);
  const applyHighlightEvent = useMaestroHighlightStore((state) => state.applyHighlightEvent);
  const lastRunningStepRef = useRef<{ runId: string; stepId: string } | null>(null);

  useEffect(() => {
    const unsubscribeOutput = window.nexus.tests.onOutput(({ runId, chunk }) => {
      const store = useTestExecutionStore.getState();
      const entry = Object.values(store.runsByEntryId).find((run) => run.runId === runId);
      const previousRunningStep = entry?.steps.find((step) => step.status === 'running');

      applyOutput(runId, chunk);

      const nextEntry = useTestExecutionStore.getState().runsByEntryId[entry?.entryId ?? ''];

      if (!nextEntry || nextEntry.kind !== 'maestro' || nextEntry.status !== 'running') {
        return;
      }

      const runningStep = nextEntry.steps.find((step) => step.status === 'running');

      if (!runningStep) {
        lastRunningStepRef.current = null;
        return;
      }

      const lastTracked = lastRunningStepRef.current;

      if (lastTracked?.runId === runId && lastTracked.stepId === runningStep.id) {
        return;
      }

      lastRunningStepRef.current = { runId, stepId: runningStep.id };

      if (previousRunningStep?.id !== runningStep.id) {
        void window.nexus.tests.resolveHighlight(runId, runningStep.label);
      }
    });

    const unsubscribeExit = window.nexus.tests.onExit(({ runId, code }) => {
      lastRunningStepRef.current = null;
      useMaestroHighlightStore.getState().clearAll();
      finishRun(runId, code);
    });

    const unsubscribeHighlight = window.nexus.tests.onHighlight((event) => {
      applyHighlightEvent(event);
    });

    return () => {
      unsubscribeOutput();
      unsubscribeExit();
      unsubscribeHighlight();
    };
  }, [applyHighlightEvent, applyOutput, finishRun]);
}
