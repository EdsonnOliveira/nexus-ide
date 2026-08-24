import { useProjectStore } from '@/stores/useProjectStore';
import type { ProjectTask, TaskBoardColumnOption } from '@/types/task';
import { formatDeepcrmIntegrationError } from '@/utils/deepcrmIntegration';
import { formatTaskIntegrationError } from '@/utils/jiraIntegration';
import { classifyTaskStatus, type TaskStatusKind } from '@/utils/taskLabels';
import {
  LOCAL_TASK_STATUS_DONE,
  LOCAL_TASK_STATUS_IN_PROGRESS,
  LOCAL_TASK_STATUS_PENDING,
} from '@/utils/taskJson';

export type BoardStatusKind = TaskStatusKind;

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

function localStatusForKind(kind: BoardStatusKind): string {
  if (kind === 'done') {
    return LOCAL_TASK_STATUS_DONE;
  }

  if (kind === 'progress') {
    return LOCAL_TASK_STATUS_IN_PROGRESS;
  }

  return LOCAL_TASK_STATUS_PENDING;
}

function pickColumnForKind(
  columns: TaskBoardColumnOption[],
  kind: BoardStatusKind,
): TaskBoardColumnOption | undefined {
  if (kind === 'done') {
    return columns.find((column) => column.isDone) ?? columns.find((column) => {
      const classified = classifyTaskStatus(column.name);
      return classified === 'done';
    });
  }

  if (kind === 'progress') {
    return columns.find((column) => column.isProgress) ?? columns.find((column) => {
      const classified = classifyTaskStatus(column.name);
      return classified === 'progress';
    });
  }

  return (
    columns.find((column) => !column.isDone && !column.isProgress) ??
    columns.find((column) => {
      const classified = classifyTaskStatus(column.name);
      return classified === 'pending' || classified === null;
    })
  );
}

function buildUpdatedTask(
  task: ProjectTask,
  status: string,
  stage?: { stageId?: string; stageName?: string },
): ProjectTask {
  return {
    ...task,
    status,
    updatedAt: Date.now(),
    deepcrm:
      task.deepcrm || stage
        ? {
            ...task.deepcrm,
            ...(stage?.stageId ? { stageId: stage.stageId } : {}),
            ...(stage?.stageName ? { stageName: stage.stageName } : {}),
          }
        : task.deepcrm,
  };
}

export function formatTaskMoveError(error: unknown, source: ProjectTask['source']): string {
  if (source === 'deepcrm') {
    return formatDeepcrmIntegrationError(error);
  }

  return formatTaskIntegrationError(error);
}

export async function moveTaskToStatusKind(
  projectId: string,
  task: ProjectTask,
  kind: BoardStatusKind,
): Promise<ProjectTask> {
  const currentKind = classifyTaskStatus(task.status ?? '') ?? 'pending';

  if (currentKind === kind) {
    return task;
  }

  if (task.source === 'local') {
    const status = localStatusForKind(kind);
    const nextTask = buildUpdatedTask(task, status);
    await persistTaskUpdate(projectId, task.id, { status });
    return nextTask;
  }

  const externalId = task.externalId?.trim();

  if (!externalId) {
    throw new Error('Tarefa sem identificador externo');
  }

  if (kind === 'progress') {
    const result = await window.nexus.tasks.startExternal(projectId, externalId);
    const nextTask = buildUpdatedTask(task, result.status, {
      stageId: result.stageId,
      stageName: result.stageName,
    });
    await persistTaskUpdate(projectId, task.id, {
      status: nextTask.status,
      deepcrm: nextTask.deepcrm,
    });
    return nextTask;
  }

  if (kind === 'done') {
    const result = await window.nexus.tasks.completeExternal(projectId, externalId);
    const nextTask = buildUpdatedTask(task, result.status, {
      stageId: result.stageId,
      stageName: result.stageName,
    });
    await persistTaskUpdate(projectId, task.id, {
      status: nextTask.status,
      deepcrm: nextTask.deepcrm,
    });
    return nextTask;
  }

  const columns = await window.nexus.tasks.listBoardColumns(projectId, externalId);
  const target = pickColumnForKind(columns, 'pending');

  if (!target) {
    throw new Error('Nenhuma coluna pendente encontrada no board');
  }

  const result = await window.nexus.tasks.moveBoardColumn(projectId, externalId, target.id);
  const nextTask = buildUpdatedTask(task, result.status, {
    stageId: result.stageId,
    stageName: result.stageName,
  });
  await persistTaskUpdate(projectId, task.id, {
    status: nextTask.status,
    deepcrm: nextTask.deepcrm,
  });
  return nextTask;
}
