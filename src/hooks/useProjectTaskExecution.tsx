import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  TaskAgentModeModal,
  type TaskExecutionAnchor,
} from '@/components/tasks/TaskAgentModeModal';
import { TaskAgentPickerModal } from '@/components/tasks/TaskAgentPickerModal';
import type { AutomationAgentMode } from '@/constants/agentModes';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTabActions } from '@/stores/useTabStore';
import type { Project } from '@/types';
import type { ProjectTask } from '@/types/task';
import { collectOpenAgentPanes } from '@/utils/collectOpenAgentPanes';
import { executeTaskInAgent } from '@/utils/executeTaskInAgent';
import { moveTaskToInProgress } from '@/utils/moveTaskToInProgress';
import { resolveAgentLaunchCommand } from '@/utils/resolveAgentLaunchCommand';

function fallbackExecutionAnchor(): TaskExecutionAnchor {
  const x = Math.round(window.innerWidth / 2);
  const y = Math.round(window.innerHeight / 2);

  return {
    top: y,
    left: x,
    right: x,
    bottom: y,
    width: 0,
    height: 0,
  };
}

export function useProjectTaskExecution(_projectId: string | null): {
  executeTask: (
    task: ProjectTask,
    overrideProjectId?: string,
    anchor?: TaskExecutionAnchor | null,
  ) => void;
  executionModals: ReactNode;
} {
  const { selectPane, addAgentTab } = useTabActions();
  const [executeTarget, setExecuteTarget] = useState<ProjectTask | null>(null);
  const [executeProject, setExecuteProject] = useState<Project | null>(null);
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);
  const [modeAnchor, setModeAnchor] = useState<TaskExecutionAnchor | null>(null);

  const openAgents = useMemo(
    () => (executeProject ? collectOpenAgentPanes(executeProject) : []),
    [executeProject],
  );

  const clearExecution = useCallback(() => {
    setExecuteTarget(null);
    setExecuteProject(null);
    setSelectedPaneId(null);
    setModeAnchor(null);
  }, []);

  const executeTask = useCallback(
    (task: ProjectTask, overrideProjectId?: string, anchor?: TaskExecutionAnchor | null) => {
      void (async () => {
        const targetProjectId = overrideProjectId ?? _projectId;
        const targetProject = targetProjectId
          ? useProjectStore.getState().projects.find((item) => item.id === targetProjectId) ?? null
          : null;

        if (!targetProject) {
          return;
        }

        const resolvedAnchor = anchor ?? fallbackExecutionAnchor();
        const agents = collectOpenAgentPanes(targetProject);

        if (agents.length === 0) {
          const command = await resolveAgentLaunchCommand(targetProject.path);
          await addAgentTab(command);
          const freshProject =
            useProjectStore.getState().projects.find((item) => item.id === targetProject.id) ??
            targetProject;
          const paneId = freshProject.activeTabId ?? null;

          setModeAnchor(resolvedAnchor);
          setExecuteProject(freshProject);
          setExecuteTarget(task);
          setSelectedPaneId(paneId);
          return;
        }

        setModeAnchor(resolvedAnchor);
        setExecuteProject(targetProject);
        setExecuteTarget(task);
        setSelectedPaneId(agents.length === 1 ? agents[0].pane.id : null);
      })();
    },
    [_projectId, addAgentTab],
  );

  const handleSelectAgent = useCallback((paneId: string) => {
    setSelectedPaneId(paneId);
  }, []);

  const handleSelectMode = useCallback(
    (mode: AutomationAgentMode) => {
      if (!executeProject || !executeTarget || !selectedPaneId) {
        return;
      }

      const targetTask = executeTarget;
      const paneId = selectedPaneId;
      const projectId = executeProject.id;
      const freshProject =
        useProjectStore.getState().projects.find((item) => item.id === executeProject.id) ??
        executeProject;

      clearExecution();

      void (async () => {
        await moveTaskToInProgress(projectId, targetTask);
        await executeTaskInAgent({
          project: freshProject,
          task: targetTask,
          paneId,
          agentMode: mode,
          selectPane,
        });
      })();
    },
    [clearExecution, executeProject, executeTarget, selectPane, selectedPaneId],
  );

  const executionModals = (
    <>
      {executeTarget && !selectedPaneId ? (
        <TaskAgentPickerModal
          agents={openAgents}
          onClose={clearExecution}
          onSelect={handleSelectAgent}
        />
      ) : null}
      {executeTarget && selectedPaneId && modeAnchor ? (
        <TaskAgentModeModal
          anchor={modeAnchor}
          onClose={clearExecution}
          onSelect={handleSelectMode}
        />
      ) : null}
    </>
  );

  return { executeTask, executionModals };
}
