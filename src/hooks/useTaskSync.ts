import { useCallback, useEffect, useRef, useState } from 'react';
import { useProjectStore } from '@/stores/useProjectStore';
import { areProjectTasksEqual, mergeProjectTasks } from '@/utils/taskLabels';

const TASK_SYNC_INTERVAL_MS = 60_000;

export function useTaskSync(projectId: string | null): {
  isSyncing: boolean;
  syncError: string | null;
} {
  const sidePanel = useProjectStore((state) => state.sidePanel);
  const updateProject = useProjectStore((state) => state.updateProject);
  const syncEnabled = useProjectStore((state) => {
    if (!projectId) {
      return false;
    }

    const currentProject = state.projects.find((item) => item.id === projectId);

    return Boolean(currentProject?.taskIntegration?.syncEnabled);
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const isRunningRef = useRef(false);

  const runSync = useCallback(
    async (showLoading = true) => {
      if (!projectId || isRunningRef.current) {
        return;
      }

      const project = useProjectStore.getState().projects.find((item) => item.id === projectId);

      if (!project?.taskIntegration?.syncEnabled) {
        return;
      }

      isRunningRef.current = true;

      if (showLoading) {
        setIsSyncing(true);
      }

      try {
        const result = await window.nexus.tasks.sync(projectId);
        const currentTasks = project.tasks ?? [];
        const merged = mergeProjectTasks(currentTasks, result.tasks);
        const currentIntegration = project.taskIntegration;
        const nextIntegration =
          currentIntegration && (result.jiraAccountName || result.deepcrmAccountName)
            ? {
                ...currentIntegration,
                ...(result.jiraAccountName ? { jiraAccountName: result.jiraAccountName } : {}),
                ...(result.deepcrmAccountName
                  ? { deepcrmAccountName: result.deepcrmAccountName }
                  : {}),
              }
            : currentIntegration;

        if (!areProjectTasksEqual(currentTasks, merged)) {
          await updateProject(projectId, {
            tasks: merged,
            taskIntegration: nextIntegration,
          });
        } else if (
          nextIntegration &&
          currentIntegration &&
          (nextIntegration.jiraAccountName !== currentIntegration.jiraAccountName ||
            nextIntegration.deepcrmAccountName !== currentIntegration.deepcrmAccountName)
        ) {
          await updateProject(projectId, {
            taskIntegration: nextIntegration,
          });
        }

        setSyncError(null);
      } catch (error) {
        setSyncError(error instanceof Error ? error.message : 'Falha ao sincronizar tarefas');
      } finally {
        isRunningRef.current = false;

        if (showLoading) {
          setIsSyncing(false);
        }
      }
    },
    [projectId, updateProject],
  );

  useEffect(() => {
    if (!syncEnabled) {
      setSyncError(null);
      setIsSyncing(false);
      return;
    }
  }, [syncEnabled]);

  useEffect(() => {
    if (!projectId || sidePanel !== 'tasks' || !syncEnabled) {
      return;
    }

    void runSync(true);

    const intervalId = window.setInterval(() => {
      void runSync(false);
    }, TASK_SYNC_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [projectId, runSync, sidePanel, syncEnabled]);

  return { isSyncing, syncError };
}
