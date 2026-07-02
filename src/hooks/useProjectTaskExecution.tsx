import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { TaskAgentModeModal } from '@/components/tasks/TaskAgentModeModal';
import { TaskAgentPickerModal } from '@/components/tasks/TaskAgentPickerModal';
import type { AutomationAgentMode } from '@/constants/agentModes';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTabActions } from '@/stores/useTabStore';
import type { Project } from '@/types';
import type { ProjectTask } from '@/types/task';
import { collectOpenAgentPanes } from '@/utils/collectOpenAgentPanes';
import { executeTaskInAgent } from '@/utils/executeTaskInAgent';
import { resolveAgentLaunchCommand } from '@/utils/resolveAgentLaunchCommand';

export function useProjectTaskExecution(_projectId: string | null): {
  executeTask: (task: ProjectTask, overrideProjectId?: string) => void;
  executionModals: ReactNode;
} {
  const { selectPane, addAgentTab } = useTabActions();
  const [executeTarget, setExecuteTarget] = useState<ProjectTask | null>(null);
  const [executeProject, setExecuteProject] = useState<Project | null>(null);
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);

  const openAgents = useMemo(
    () => (executeProject ? collectOpenAgentPanes(executeProject) : []),
    [executeProject],
  );

  const executeTask = useCallback(
    (task: ProjectTask, overrideProjectId?: string) => {
      void (async () => {
        const targetProjectId = overrideProjectId ?? _projectId;
        const targetProject = targetProjectId
          ? useProjectStore.getState().projects.find((item) => item.id === targetProjectId) ?? null
          : null;

        if (!targetProject) {
          return;
        }

        const agents = collectOpenAgentPanes(targetProject);

        if (agents.length === 0) {
          const command = await resolveAgentLaunchCommand(targetProject.path);
          await addAgentTab(command);
          const freshProject =
            useProjectStore.getState().projects.find((item) => item.id === targetProject.id) ?? targetProject;
          const paneId = freshProject.activeTabId ?? null;

          setExecuteProject(freshProject);
          setExecuteTarget(task);
          setSelectedPaneId(paneId);
          return;
        }

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
      const freshProject =
        useProjectStore.getState().projects.find((item) => item.id === executeProject.id) ?? executeProject;

      setExecuteTarget(null);
      setExecuteProject(null);
      setSelectedPaneId(null);

      void executeTaskInAgent({
        project: freshProject,
        task: targetTask,
        paneId,
        agentMode: mode,
        selectPane,
      });
    },
    [executeProject, executeTarget, selectPane, selectedPaneId],
  );

  const executionModals = (
    <>
      {executeTarget && !selectedPaneId ? (
        <TaskAgentPickerModal
          agents={openAgents}
          onClose={() => {
            setExecuteTarget(null);
            setExecuteProject(null);
          }}
          onSelect={handleSelectAgent}
        />
      ) : null}
      {executeTarget && selectedPaneId ? (
        <TaskAgentModeModal
          onClose={() => {
            setExecuteTarget(null);
            setExecuteProject(null);
            setSelectedPaneId(null);
          }}
          onSelect={handleSelectMode}
        />
      ) : null}
    </>
  );

  return { executeTask, executionModals };
}
