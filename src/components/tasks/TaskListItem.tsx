import { Play } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { ProjectTask } from '@/types/task';
import { TaskAttachmentImage } from '@/components/tasks/TaskAttachmentImage';
import {
  formatTaskSource,
  getTaskTagBorderColor,
  resolveTaskCoverAttachment,
  resolveTaskDescriptionFirstLine,
  resolveTaskPriorityVisual,
} from '@/utils/taskLabels';
import { isLocalTaskCompleted } from '@/utils/taskJson';

interface TaskListItemProps {
  task: ProjectTask;
  onView: (task: ProjectTask) => void;
  onExecute: (task: ProjectTask) => void;
  onContextMenu?: (task: ProjectTask, x: number, y: number) => void;
}

function TaskListItemComponent({ task, onView, onExecute, onContextMenu }: TaskListItemProps) {
  const priority = useMemo(
    () =>
      resolveTaskPriorityVisual(
        task.jira?.priority ?? task.deepcrm?.priority ?? task.local?.priority,
      ),
    [task.deepcrm?.priority, task.jira?.priority, task.local?.priority],
  );
  const labels = useMemo(
    () => task.jira?.labels ?? task.deepcrm?.labels ?? task.local?.labels ?? [],
    [task.deepcrm?.labels, task.jira?.labels, task.local?.labels],
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

  const handlePlayClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onExecute(task);
    },
    [onExecute, task],
  );

  const handleRowClick = useCallback(() => {
    onView(task);
  }, [onView, task]);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if (task.source !== 'local' || !onContextMenu) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onContextMenu(task, event.clientX, event.clientY);
    },
    [onContextMenu, task],
  );

  const isCompleted = isLocalTaskCompleted(task);
  const isManualTask = task.source === 'local';
  const descriptionPreview = useMemo(
    () => (isManualTask ? resolveTaskDescriptionFirstLine(task.description) : ''),
    [isManualTask, task.description],
  );

  const PriorityIcon = priority?.Icon;

  return (
    <div
      className={`tasks-drawer__row${coverVisible ? ' tasks-drawer__row--with-cover' : ''}${isCompleted ? ' tasks-drawer__row--completed' : ''}${isManualTask ? ' tasks-drawer__row--manual' : ''}`}
      role='button'
      tabIndex={0}
      onClick={handleRowClick}
      onContextMenu={handleContextMenu}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleRowClick();
        }
      }}
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
      <div className='tasks-drawer__row-body'>
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
          {task.externalId || task.source !== 'local' || priority ? (
            <div className='tasks-drawer__card-footer'>
              <div className='tasks-drawer__card-meta'>
                {task.externalId ? (
                  <span className='tasks-drawer__issue-key'>{task.externalId}</span>
                ) : (
                  <span className={`tasks-drawer__source tasks-drawer__source--${task.source}`}>
                    {formatTaskSource(task.source)}
                  </span>
                )}
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
          <button
            type='button'
            className='tasks-drawer__action tasks-drawer__action--play app-button app-button--enter'
            aria-label={`Executar ${task.title}`}
            onClick={handlePlayClick}
          >
            <Play size={13} strokeWidth={2.25} />
          </button>
          {task.jira?.assigneeAvatarUrl || task.deepcrm?.assigneeAvatarUrl ? (
            <img
              className='tasks-drawer__assignee'
              src={task.jira?.assigneeAvatarUrl ?? task.deepcrm?.assigneeAvatarUrl ?? ''}
              alt={task.jira?.assignee ?? task.deepcrm?.assignee ?? 'Responsável'}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export const TaskListItem = memo(TaskListItemComponent);
