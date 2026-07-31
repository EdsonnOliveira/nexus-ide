import { ChevronRight, ListTree, Play } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  readTaskExecutionAnchor,
  type TaskExecutionAnchor,
} from '@/components/tasks/TaskAgentModeModal';
import type { ProjectTask } from '@/types/task';
import { TaskAttachmentImage } from '@/components/tasks/TaskAttachmentImage';
import { getTaskSubtaskProgress, resolveTaskSubtasks } from '@/utils/taskFilters';
import {
  formatTaskSource,
  getTaskInitials,
  getTaskTagBorderColor,
  resolveTaskCoverAttachment,
  resolveTaskDescriptionFirstLine,
  resolveTaskPriorityVisual,
  resolveTaskStatusBadge,
} from '@/utils/taskLabels';
import { isLocalTaskCompleted } from '@/utils/taskJson';

const DEEPCRM_PROGRESS_LABEL = /^\d+\s*\/\s*\d+\s*tarefas$/i;

interface TaskListItemProps {
  task: ProjectTask;
  relatedTasks?: ProjectTask[];
  contextMenuTaskKey?: string | null;
  onView: (task: ProjectTask) => void;
  onExecute: (task: ProjectTask, anchor?: TaskExecutionAnchor | null) => void;
  onContextMenu?: (task: ProjectTask, x: number, y: number) => void;
}

function TaskListItemComponent({
  task,
  relatedTasks = [],
  contextMenuTaskKey = null,
  onView,
  onExecute,
  onContextMenu,
}: TaskListItemProps) {
  const [subtasksOpen, setSubtasksOpen] = useState(false);
  const priority = useMemo(
    () =>
      resolveTaskPriorityVisual(
        task.jira?.priority ?? task.deepcrm?.priority ?? task.local?.priority,
      ),
    [task.deepcrm?.priority, task.jira?.priority, task.local?.priority],
  );
  const labels = useMemo(() => {
    const raw = task.jira?.labels ?? task.deepcrm?.labels ?? task.local?.labels ?? [];

    if (task.source !== 'deepcrm') {
      return raw;
    }

    return raw.filter((label) => !DEEPCRM_PROGRESS_LABEL.test(label.trim()));
  }, [task.deepcrm?.labels, task.jira?.labels, task.local?.labels, task.source]);
  const statusBadge = useMemo(() => resolveTaskStatusBadge(task.status), [task.status]);
  const subtasks = useMemo(
    () => resolveTaskSubtasks(task, relatedTasks),
    [relatedTasks, task],
  );
  const subtaskProgress = useMemo(
    () => getTaskSubtaskProgress(task, relatedTasks),
    [relatedTasks, task],
  );
  const coverAttachment = useMemo(() => resolveTaskCoverAttachment(task), [task]);
  const [coverVisible, setCoverVisible] = useState(false);

  const handleCoverReady = useCallback(() => {
    setCoverVisible(true);
  }, []);

  const handleCoverFailed = useCallback(() => {
    setCoverVisible(false);
  }, []);

  useEffect(() => {
    setCoverVisible(false);
  }, [coverAttachment?.path]);

  useEffect(() => {
    setSubtasksOpen(false);
  }, [task.id, task.externalId]);

  const handlePlayClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onExecute(task, readTaskExecutionAnchor(event.currentTarget));
    },
    [onExecute, task],
  );

  const resolveSubtaskTask = useCallback(
    (subtaskKey: string, title: string, status?: string, assignee?: string, assigneeAvatarUrl?: string) => {
      const fullTask = relatedTasks.find(
        (item) => item.externalId === subtaskKey || item.id === subtaskKey,
      );

      if (fullTask) {
        return fullTask;
      }

      return {
        id: subtaskKey,
        source: 'jira' as const,
        externalId: subtaskKey,
        title,
        description: '',
        attachments: [],
        status,
        jira: {
          parentKey: task.externalId ?? task.id,
          assignee,
          assigneeAvatarUrl,
          isSubtask: true,
        },
        updatedAt: Date.now(),
      };
    },
    [relatedTasks, task.externalId, task.id],
  );

  const handleSubtaskPlayClick = useCallback(
    (
      event: React.MouseEvent,
      subtaskKey: string,
      title: string,
      status?: string,
      assignee?: string,
      assigneeAvatarUrl?: string,
    ) => {
      event.stopPropagation();
      onExecute(
        resolveSubtaskTask(subtaskKey, title, status, assignee, assigneeAvatarUrl),
        readTaskExecutionAnchor(event.currentTarget),
      );
    },
    [onExecute, resolveSubtaskTask],
  );

  const handleRowClick = useCallback(() => {
    onView(task);
  }, [onView, task]);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if (!onContextMenu) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onContextMenu(task, event.clientX, event.clientY);
    },
    [onContextMenu, task],
  );

  const handleSubtaskContextMenu = useCallback(
    (
      event: React.MouseEvent,
      subtaskKey: string,
      title: string,
      status?: string,
      assignee?: string,
      assigneeAvatarUrl?: string,
    ) => {
      if (!onContextMenu) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onContextMenu(
        resolveSubtaskTask(subtaskKey, title, status, assignee, assigneeAvatarUrl),
        event.clientX,
        event.clientY,
      );
    },
    [onContextMenu, resolveSubtaskTask],
  );

  const handleToggleSubtasks = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    setSubtasksOpen((current) => !current);
  }, []);

  const handleSubtaskClick = useCallback(
    (event: React.MouseEvent, subtaskKey: string) => {
      event.stopPropagation();
      const fullTask = relatedTasks.find(
        (item) => item.externalId === subtaskKey || item.id === subtaskKey,
      );

      if (fullTask) {
        onView(fullTask);
      }
    },
    [onView, relatedTasks],
  );

  const isCompleted = isLocalTaskCompleted(task) || statusBadge?.kind === 'done';
  const isLocalTask = task.source === 'local';
  const descriptionPreview = useMemo(
    () => (isLocalTask ? resolveTaskDescriptionFirstLine(task.description) : ''),
    [isLocalTask, task.description],
  );
  const hasSubtasks = Boolean(subtaskProgress && subtaskProgress.total > 0 && subtasks.length > 0);
  const showPlay = !hasSubtasks && !isCompleted;
  const taskMenuKey = task.externalId ?? task.id;
  const parentMenuOpen = contextMenuTaskKey === taskMenuKey;

  const PriorityIcon = priority?.Icon;

  return (
    <div
      className={`tasks-drawer__row${coverVisible ? ' tasks-drawer__row--with-cover' : ''}${isCompleted ? ' tasks-drawer__row--completed' : ''}${isLocalTask ? ' tasks-drawer__row--manual' : ''}${hasSubtasks ? ' tasks-drawer__row--with-subtasks' : ''}${subtasksOpen ? ' tasks-drawer__row--subtasks-open' : ''}${statusBadge?.kind === 'progress' ? ' tasks-drawer__row--progress' : ''}${parentMenuOpen ? ' tasks-drawer__row--menu-open' : ''}`}
      onContextMenu={handleContextMenu}
    >
      {coverAttachment ? (
        <div
          className={`tasks-drawer__cover${coverVisible ? ' tasks-drawer__cover--visible' : ''}`}
          aria-hidden={!coverVisible}
        >
          <TaskAttachmentImage
            attachment={coverAttachment}
            className='tasks-drawer__cover-image'
            alt=''
            onReady={handleCoverReady}
            onFailed={handleCoverFailed}
          />
        </div>
      ) : null}
      <div
        className='tasks-drawer__row-body'
        role='button'
        tabIndex={0}
        onClick={handleRowClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleRowClick();
          }
        }}
      >
        <div className='tasks-drawer__row-main'>
          <span className='tasks-drawer__title'>{task.title}</span>
          {descriptionPreview ? (
            <span className='tasks-drawer__description-preview'>{descriptionPreview}</span>
          ) : null}
          {labels.length > 0 ? (
            <div className='tasks-drawer__tags'>
              {labels.map((label) => (
                <span
                  key={label}
                  className='tasks-drawer__tag'
                  style={{ borderColor: getTaskTagBorderColor(label) }}
                >
                  {label}
                </span>
              ))}
            </div>
          ) : null}
          {task.externalId || task.source !== 'local' || priority || statusBadge ? (
            <div className='tasks-drawer__card-footer'>
              <div className='tasks-drawer__card-meta'>
                {task.externalId ? (
                  <span className='tasks-drawer__issue-key'>{task.externalId}</span>
                ) : (
                  <span className={`tasks-drawer__source tasks-drawer__source--${task.source}`}>
                    {formatTaskSource(task.source)}
                  </span>
                )}
                {statusBadge ? (
                  <span
                    className={`tasks-drawer__status-badge ${statusBadge.className}`}
                    title={task.status?.trim() || statusBadge.label}
                  >
                    {statusBadge.label}
                  </span>
                ) : null}
                {priority && PriorityIcon ? (
                  <span
                    className={`tasks-drawer__priority ${priority.className}`}
                    title={priority.label}
                    aria-label={`Prioridade ${priority.label}`}
                  >
                    <PriorityIcon size={14} strokeWidth={2.25} />
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <div className='tasks-drawer__actions'>
          {showPlay ? (
            <button
              type='button'
              className='tasks-drawer__action tasks-drawer__action--play app-button app-button--enter'
              aria-label={`Executar ${task.title}`}
              onClick={handlePlayClick}
            >
              <Play size={13} strokeWidth={2.25} />
            </button>
          ) : null}
          {task.jira?.assigneeAvatarUrl || task.deepcrm?.assigneeAvatarUrl ? (
            <img
              className='tasks-drawer__assignee'
              src={task.jira?.assigneeAvatarUrl ?? task.deepcrm?.assigneeAvatarUrl ?? ''}
              alt={task.jira?.assignee ?? task.deepcrm?.assignee ?? 'Responsável'}
            />
          ) : null}
        </div>
      </div>
      {hasSubtasks && subtaskProgress ? (
        <>
          <button
            type='button'
            className={`tasks-drawer__subtasks-toggle app-button${subtasksOpen ? ' tasks-drawer__subtasks-toggle--open' : ''}`}
            aria-expanded={subtasksOpen}
            aria-label={
              subtasksOpen
                ? `Recolher subtarefas (${subtaskProgress.completed} de ${subtaskProgress.total} concluídas)`
                : `Expandir subtarefas (${subtaskProgress.completed} de ${subtaskProgress.total} concluídas)`
            }
            onClick={handleToggleSubtasks}
          >
            <ListTree size={14} strokeWidth={2} aria-hidden />
            <span className='tasks-drawer__subtasks-toggle-label'>Subtarefas</span>
            <span
              className='tasks-drawer__subtask-progress'
              title={`${subtaskProgress.completed} de ${subtaskProgress.total} concluídas`}
            >
              {subtaskProgress.completed}/{subtaskProgress.total}
            </span>
            <ChevronRight
              size={14}
              strokeWidth={2.25}
              className='tasks-drawer__subtasks-chevron'
              aria-hidden
            />
          </button>
          {subtasksOpen ? (
            <div className='tasks-drawer__subtasks-panel app-button--enter'>
              {subtasks.map((subtask) => {
                const fullTask = relatedTasks.find(
                  (item) => item.externalId === subtask.key || item.id === subtask.key,
                );
                const subtaskStatus = resolveTaskStatusBadge(fullTask?.status ?? subtask.status);
                const assigneeName =
                  fullTask?.jira?.assignee ??
                  fullTask?.deepcrm?.assignee ??
                  subtask.assignee;
                const assigneeAvatar =
                  fullTask?.jira?.assigneeAvatarUrl ??
                  fullTask?.deepcrm?.assigneeAvatarUrl ??
                  subtask.assigneeAvatarUrl;
                const isClickable = Boolean(fullTask);
                const showSubtaskPlay = subtaskStatus?.kind !== 'done';
                const subtaskMenuOpen = contextMenuTaskKey === subtask.key;

                return (
                  <div
                    key={subtask.key}
                    className={`tasks-drawer__subtask-card app-button${isClickable ? ' tasks-drawer__subtask-card--clickable' : ''}${subtaskMenuOpen ? ' tasks-drawer__subtask-card--menu-open' : ''}`}
                    role={isClickable ? 'button' : undefined}
                    tabIndex={isClickable ? 0 : undefined}
                    onClick={
                      isClickable ? (event) => handleSubtaskClick(event, subtask.key) : undefined
                    }
                    onContextMenu={(event) =>
                      handleSubtaskContextMenu(
                        event,
                        subtask.key,
                        subtask.title,
                        fullTask?.status ?? subtask.status,
                        assigneeName,
                        assigneeAvatar,
                      )
                    }
                    onKeyDown={
                      isClickable
                        ? (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              event.stopPropagation();
                              const matched = relatedTasks.find(
                                (item) =>
                                  item.externalId === subtask.key || item.id === subtask.key,
                              );
                              if (matched) {
                                onView(matched);
                              }
                            }
                          }
                        : undefined
                    }
                  >
                    <div className='tasks-drawer__subtask-card-header'>
                      <span className='tasks-drawer__subtask-card-title'>{subtask.title}</span>
                      {showSubtaskPlay ? (
                        <button
                          type='button'
                          className='tasks-drawer__action tasks-drawer__action--play app-button app-button--enter'
                          aria-label={`Executar ${subtask.title}`}
                          onClick={(event) =>
                            handleSubtaskPlayClick(
                              event,
                              subtask.key,
                              subtask.title,
                              fullTask?.status ?? subtask.status,
                              assigneeName,
                              assigneeAvatar,
                            )
                          }
                        >
                          <Play size={12} strokeWidth={2.25} />
                        </button>
                      ) : null}
                    </div>
                    <div className='tasks-drawer__subtask-card-footer'>
                      <div className='tasks-drawer__card-meta'>
                        <ListTree size={12} strokeWidth={2} aria-hidden />
                        <span className='tasks-drawer__issue-key'>{subtask.key}</span>
                        {subtaskStatus ? (
                          <span
                            className={`tasks-drawer__status-badge ${subtaskStatus.className}`}
                            title={fullTask?.status ?? subtask.status ?? subtaskStatus.label}
                          >
                            {subtaskStatus.label}
                          </span>
                        ) : null}
                      </div>
                      {assigneeAvatar ? (
                        <img
                          className='tasks-drawer__assignee tasks-drawer__assignee--sm'
                          src={assigneeAvatar}
                          alt={assigneeName ?? 'Responsável'}
                          title={assigneeName}
                        />
                      ) : assigneeName ? (
                        <span
                          className='tasks-drawer__assignee tasks-drawer__assignee--sm tasks-drawer__assignee--fallback'
                          title={assigneeName}
                          aria-label={assigneeName}
                        >
                          {getTaskInitials(assigneeName)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export const TaskListItem = memo(TaskListItemComponent);
