import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { TaskDetailModal } from '@/components/tasks/TaskDetailModal';
import { TaskFormModal } from '@/components/tasks/TaskFormModal';
import { TaskIntegrationModal } from '@/components/tasks/TaskIntegrationModal';
import { TaskJsonModal } from '@/components/tasks/TaskJsonModal';
import { TaskListView } from '@/components/tasks/TaskListView';
import { useProjectTaskExecution } from '@/hooks/useProjectTaskExecution';
import { useTaskSync } from '@/hooks/useTaskSync';
import { usePendingTaskViewStore } from '@/stores/usePendingTaskViewStore';
import { useProjectStore } from '@/stores/useProjectStore';
import type { ProjectTask, TaskCredentialsPayload, TaskIntegrationConfig } from '@/types/task';
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
  const { executeTask, executionModals } = useProjectTaskExecution(projectId);
  const { isSyncing, syncError } = useTaskSync(projectId);
  const [formTask, setFormTask] = useState<ProjectTask | null | undefined>(undefined);
  const [detailTask, setDetailTask] = useState<ProjectTask | null>(null);
  const [integrationOpen, setIntegrationOpen] = useState(false);
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
      if (!project) {
        return;
      }

      const nextTasks = tasks.filter((item) => item.id !== task.id);

      if (task.source === 'local' || !task.externalId?.trim()) {
        await persistTasks(nextTasks);
        return;
      }

      const currentIntegration = project.taskIntegration;

      if (!currentIntegration) {
        await persistTasks(nextTasks);
        return;
      }

      const externalId = task.externalId.trim();
      const hiddenExternalTaskIds = [
        ...(currentIntegration.hiddenExternalTaskIds ?? []),
        externalId,
      ].filter((id, index, array) => array.indexOf(id) === index);

      await updateProject(project.id, {
        tasks: nextTasks,
        taskIntegration: {
          ...currentIntegration,
          hiddenExternalTaskIds,
        },
      });
    },
    [persistTasks, project, tasks, updateProject],
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
        onExecute={executeTask}
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
          onExecute={() => executeTask(detailTask)}
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
      {executionModals}
    </aside>
  );
}

export const ProjectTasksDrawer = memo(ProjectTasksDrawerComponent);
