import { useTestExecutionStore } from '@/stores/useTestExecutionStore';
import type { ProjectTestEntry } from '@/types/test';

const preparingAbortByEntryId = new Set<string>();

function markPrepareCancelled(entryId: string): void {
  preparingAbortByEntryId.add(entryId);
}

function clearPrepareCancelled(entryId: string): void {
  preparingAbortByEntryId.delete(entryId);
}

function isPrepareCancelled(entryId: string): boolean {
  return preparingAbortByEntryId.has(entryId);
}

export async function stopProjectTest(entryId: string): Promise<void> {
  const store = useTestExecutionStore.getState();
  const existingRun = store.getRunForEntry(entryId);

  if (!existingRun) {
    return;
  }

  if (existingRun.status === 'preparing') {
    markPrepareCancelled(entryId);
    store.cancelPreparingRun(entryId);
    return;
  }

  if (existingRun.status !== 'running' || !existingRun.runId) {
    return;
  }

  await window.nexus.tests.stop(existingRun.runId);
  store.stopRun(entryId);
}

export async function executeProjectTest(
  entry: ProjectTestEntry,
  projectId: string,
  projectPath: string,
): Promise<void> {
  const store = useTestExecutionStore.getState();
  const existingRun = store.getRunForEntry(entry.id);
  const isExpanded = store.expandedEntryId === entry.id;

  if (existingRun?.status === 'running' || existingRun?.status === 'preparing') {
    return;
  }

  if (isExpanded) {
    store.setExpandedEntryId(null);
    return;
  }

  clearPrepareCancelled(entry.id);

  let steps;

  try {
    steps = await window.nexus.tests.resolveSteps(projectPath, entry);
  } catch {
    return;
  }

  store.beginPreparingRun(entry, projectId, steps);

  try {
    if (entry.kind === 'maestro') {
      await window.nexus.tests.prepareMaestroRun(steps);
    }

    if (isPrepareCancelled(entry.id)) {
      return;
    }

    const currentRun = store.getRunForEntry(entry.id);

    if (!currentRun || currentRun.status !== 'preparing') {
      return;
    }

    const session = await window.nexus.tests.run(projectPath, projectId, entry, steps);

    if (isPrepareCancelled(entry.id)) {
      await window.nexus.tests.stop(session.runId);
      return;
    }

    store.activateRun(entry.id, session.runId);
  } catch (error) {
    if (isPrepareCancelled(entry.id)) {
      return;
    }

    const message = error instanceof Error ? error.message : 'Falha ao iniciar o teste';
    store.failPreparingRun(entry.id, message);
  } finally {
    clearPrepareCancelled(entry.id);
  }
}
