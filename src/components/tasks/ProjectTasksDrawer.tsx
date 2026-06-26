import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { TaskAgentModeModal } from '@/components/tasks/TaskAgentModeModal';
import { TaskAgentPickerModal } from '@/components/tasks/TaskAgentPickerModal';
import { TaskDetailModal } from '@/components/tasks/TaskDetailModal';
import { TaskFormModal } from '@/components/tasks/TaskFormModal';
import { TaskIntegrationModal } from '@/components/tasks/TaskIntegrationModal';
import { TaskJsonModal } from '@/components/tasks/TaskJsonModal';
import { TaskListView } from '@/components/tasks/TaskListView';
import { useTaskSync } from '@/hooks/useTaskSync';
import type { AutomationAgentMode } from '@/constants/agentModes';
import { usePendingTaskViewStore } from '@/stores/usePendingTaskViewStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTabActions } from '@/stores/useTabStore';
import type { ProjectTask, TaskCredentialsPayload, TaskIntegrationConfig } from '@/types/task';
import { collectOpenAgentPanes } from '@/utils/collectOpenAgentPanes';
import { executeTaskInAgent } from '@/utils/executeTaskInAgent';
import { resolveAgentLaunchCommand } from '@/utils/resolveAgentLaunchCommand';
import {
  LOCAL_TASK_STATUS_DONE,
  LOCAL_TASK_STATUS_PENDING,
  serializeLocalTaskJson,
} from '@/utils/taskJson';

interface ProjectTasksDrawerProps {
  projectId: string;
}

function ProjectTasksDrawerComponent({ projectId }: ProjectTasksDrawerProps) {
  const project = useProjectStore((state) => state.projects.find((item) => item.id === projectId) ?? null);
  const updateProject = useProjectStore((state) => state.updateProject);
  const { selectPane, addAgentTab } = useTabActions();
  const { isSyncing, syncError } = useTaskSync(projectId);
  const [formTask, setFormTask] = useState<ProjectTask | null | undefined>(undefined);
  const [detailTask, setDetailTask] = useState<ProjectTask | null>(null);
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const [executeTarget, setExecuteTarget] = useState<ProjectTask | null>(null);
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);
  const [importJsonOpen, setImportJsonOpen] = useState(false);
  const pendingTaskView = usePendingTaskViewStore((state) => state.pending);
  const clearPendingTaskView = usePendingTaskViewStore((state) => state.clearPending);

  const tasks = useMemo(() => project?.tasks ?? [], [project?.tasks]);

  useEffect(() => {
    if (!pendingTaskView || pendingTaskView.projectId !== projectId) {
      return;
    }

    if (pendingTaskView.createNew) {
      setFormTask(null);
      clearPendingTaskView();
      return;
    }

    if (!pendingTaskView.taskId) {
      clearPendingTaskView();
      return;
    }

    const task = tasks.find((item) => item.id === pendingTaskView.taskId);

    if (!task) {
      clearPendingTaskView();
      return;
    }

    setDetailTask(task);
    clearPendingTaskView();
  }, [clearPendingTaskView, pendingTaskView, projectId, tasks]);
  const openAgents = useMemo(() => (project ? collectOpenAgentPanes(project) : []), [project]);

  const persistTasks = useCallback(
    async (nextTasks: ProjectTask[]) => {
      if (!project) {
        return;
      }

      await updateProject(project.id, { tasks: nextTasks });
    },
    [project, updateProject],
  );

  const handleCreate = useCallback(() => {
    setFormTask(null);
  }, []);

  const handleImportJson = useCallback(() => {
    setImportJsonOpen(true);
  }, []);

  const handleCopyJson = useCallback(
    (task: ProjectTask) => {
      if (!project || task.source !== 'local') {
        return;
      }

      void navigator.clipboard.writeText(serializeLocalTaskJson(task, project.path));
    },
    [project],
  );

  const updateLocalTask = useCallback(
    async (taskId: string, patch: Partial<ProjectTask>) => {
      const nextTasks = tasks.map((item) =>
        item.id === taskId
          ? {
              ...item,
              ...patch,
              updatedAt: Date.now(),
            }
          : item,
      );

      await persistTasks(nextTasks);
    },
    [persistTasks, tasks],
  );

  const handleCompleteTask = useCallback(
    (task: ProjectTask) => {
      void updateLocalTask(task.id, { status: LOCAL_TASK_STATUS_DONE });
    },
    [updateLocalTask],
  );

  const handleReopenTask = useCallback(
    (task: ProjectTask) => {
      void updateLocalTask(task.id, { status: LOCAL_TASK_STATUS_PENDING });
    },
    [updateLocalTask],
  );

  const handleDeleteTask = useCallback(
    async (task: ProjectTask) => {
      await persistTasks(tasks.filter((item) => item.id !== task.id));
    },
    [persistTasks, tasks],
  );

  const handleViewTask = useCallback((task: ProjectTask) => {
    setDetailTask(task);
  }, []);

  const handleEdit = useCallback((task: ProjectTask) => {
    setFormTask(task);
  }, []);

  const handleSaveTask = useCallback(
    async (task: ProjectTask) => {
      const existingIndex = tasks.findIndex((item) => item.id === task.id);
      const nextTasks =
        existingIndex >= 0
          ? tasks.map((item, index) => (index === existingIndex ? task : item))
          : [...tasks, task];

      await persistTasks(nextTasks);
      setFormTask(undefined);
    },
    [persistTasks, tasks],
  );

  const handleImportJsonApply = useCallback(
    (task: ProjectTask) => {
      void persistTasks([...tasks, task]);
      setImportJsonOpen(false);
    },
    [persistTasks, tasks],
  );

  const handleSaveIntegration = useCallback(
    async (integration: TaskIntegrationConfig | null, credentials?: TaskCredentialsPayload) => {
      if (!project) {
        return;
      }

      const previousPlatform = project.taskIntegration?.platform;

      if (!integration) {
        const nextTasks = previousPlatform
          ? tasks.filter((task) => task.source !== previousPlatform)
          : tasks;

        await window.nexus.tasks.clearCredentials(project.id);
        await updateProject(project.id, { taskIntegration: null, tasks: nextTasks });
        setIntegrationOpen(false);
        return;
      }

      if (credentials) {
        await window.nexus.tasks.saveCredentials(project.id, credentials);
      }

      await updateProject(project.id, { taskIntegration: integration });
      setIntegrationOpen(false);
    },
    [project, tasks, updateProject],
  );

  const handleExecute = useCallback(
    (task: ProjectTask) => {
      void (async () => {
        if (!project) {
          return;
        }

        if (openAgents.length === 0) {
          const command = await resolveAgentLaunchCommand(project.path);
          await addAgentTab(command);
          const freshProject = useProjectStore.getState().projects.find((item) => item.id === project.id);
          const paneId = freshProject?.activeTabId ?? null;

          setExecuteTarget(task);
          setSelectedPaneId(paneId);
          return;
        }

        setExecuteTarget(task);
        setSelectedPaneId(openAgents.length === 1 ? openAgents[0].pane.id : null);
      })();
    },
    [addAgentTab, openAgents, project],
  );

  const handleSelectAgent = useCallback((paneId: string) => {
    setSelectedPaneId(paneId);
  }, []);

  const handleSelectMode = useCallback(
    (mode: AutomationAgentMode) => {
      if (!project || !executeTarget || !selectedPaneId) {
        return;
      }

      const targetTask = executeTarget;
      const paneId = selectedPaneId;

      setExecuteTarget(null);
      setSelectedPaneId(null);

      void executeTaskInAgent({
        project,
        task: targetTask,
        paneId,
        agentMode: mode,
        selectPane,
      });
    },
    [executeTarget, project, selectPane, selectedPaneId],
  );

  if (!project) {
    return null;
  }

  return (
    <aside className='project-explorer-drawer tasks-drawer' aria-label='Tarefas'>
      <TaskListView
        projectId={project.id}
        tasks={tasks}
        isSyncing={isSyncing}
        syncError={syncError}
        hasIntegration={Boolean(project.taskIntegration?.syncEnabled)}
        useDefaultFilters={project.taskIntegration?.platform === 'jira'}
        jiraAccountName={project.taskIntegration?.jiraAccountName}
        onCreate={handleCreate}
        onImportJson={handleImportJson}
        onView={handleViewTask}
        onExecute={handleExecute}
        onCopyJson={handleCopyJson}
        onCompleteTask={handleCompleteTask}
        onReopenTask={handleReopenTask}
        onDeleteTask={handleDeleteTask}
        onOpenIntegration={() => setIntegrationOpen(true)}
      />
      {detailTask ? (
        <TaskDetailModal
          projectId={project.id}
          task={detailTask}
          jiraSiteUrl={project.taskIntegration?.jiraSiteUrl}
          onClose={() => setDetailTask(null)}
          onEdit={
            detailTask.source === 'local'
              ? () => {
                  const task = detailTask;
                  setDetailTask(null);
                  handleEdit(task);
                }
              : undefined
          }
          onExecute={() => handleExecute(detailTask)}
        />
      ) : null}
      {formTask !== undefined ? (
        <TaskFormModal
          projectId={project.id}
          task={formTask}
          onClose={() => setFormTask(undefined)}
          onSave={(task) => void handleSaveTask(task)}
        />
      ) : null}
      {importJsonOpen ? (
        <TaskJsonModal
          mode='paste'
          projectPath={project.path}
          jsonText=''
          onClose={() => setImportJsonOpen(false)}
          onApply={handleImportJsonApply}
        />
      ) : null}
      {integrationOpen ? (
        <TaskIntegrationModal
          projectId={project.id}
          integration={project.taskIntegration ?? null}
          onClose={() => setIntegrationOpen(false)}
          onSave={(integration, credentials) => void handleSaveIntegration(integration, credentials)}
        />
      ) : null}
      {executeTarget && !selectedPaneId ? (
        <TaskAgentPickerModal
          agents={openAgents}
          onClose={() => setExecuteTarget(null)}
          onSelect={handleSelectAgent}
        />
      ) : null}
      {executeTarget && selectedPaneId ? (
        <TaskAgentModeModal
          onClose={() => {
            setExecuteTarget(null);
            setSelectedPaneId(null);
          }}
          onSelect={handleSelectMode}
        />
      ) : null}
    </aside>
  );
}

export const ProjectTasksDrawer = memo(ProjectTasksDrawerComponent);
