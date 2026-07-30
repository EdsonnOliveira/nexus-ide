import { useProjectStore } from '@/stores/useProjectStore';
import type { ProjectTask } from '@/types/task';
import { classifyTaskStatus } from '@/utils/taskLabels';
import { LOCAL_TASK_STATUS_IN_PROGRESS } from '@/utils/taskJson';

async function persistTaskUpdate(projectId: string, taskId: string, patch: Partial<ProjectTask>) {
  const project = useProjectStore.getState().projects.find((item) => item.id === projectId);

  if (!project) {
    return;
  }

  const nextTasks = (project.tasks ?? []).map((item) =>
    item.id === taskId
      ? {
          ...item,
          ...patch,
          updatedAt: Date.now(),
        }
      : item,
  );

  await useProjectStore.getState().updateProject(projectId, { tasks: nextTasks });
}

export async function moveTaskToInProgress(
  projectId: string,
  task: ProjectTask,
): Promise<ProjectTask> {
  if (classifyTaskStatus(task.status ?? '') === 'progress') {
    return task;
  }

  if (task.source === 'local') {
    const nextTask: ProjectTask = {
      ...task,
      status: LOCAL_TASK_STATUS_IN_PROGRESS,
      updatedAt: Date.now(),
    };

    await persistTaskUpdate(projectId, task.id, { status: LOCAL_TASK_STATUS_IN_PROGRESS });
    return nextTask;
  }

  if (!task.externalId?.trim()) {
    return task;
  }

  try {
    const result = await window.nexus.tasks.startExternal(projectId, task.externalId);
    const nextTask: ProjectTask = {
      ...task,
      status: result.status,
      updatedAt: Date.now(),
      deepcrm:
        task.deepcrm || result.stageId || result.stageName
          ? {
              ...task.deepcrm,
              ...(result.stageId ? { stageId: result.stageId } : {}),
              ...(result.stageName ? { stageName: result.stageName } : {}),
            }
          : task.deepcrm,
    };

    await persistTaskUpdate(projectId, task.id, {
      status: nextTask.status,
      deepcrm: nextTask.deepcrm,
    });

    return nextTask;
  } catch {
    return task;
  }
}
