import { useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Play, User, X } from 'lucide-react';
import { renderWebMarkdown } from './webMarkdown';
import {
  buildWebJiraIssueUrl,
  formatWebTaskDate,
  formatWebTaskSource,
  getWebTaskTagBorderColor,
  type WebProjectTask,
  type WebTaskIntegration,
} from './webProjectTasks';

interface WebTaskDetailModalProps {
  task: WebProjectTask;
  integration: WebTaskIntegration | null;
  onClose: () => void;
  onExecute?: (task: WebProjectTask) => void | Promise<void>;
}

function TaskAvatar({
  name,
  avatarUrl,
}: {
  name?: string;
  avatarUrl?: string;
}) {
  if (avatarUrl) {
    return (
      <img
        className='web-task-detail__avatar'
        src={avatarUrl}
        alt={name ?? 'Responsável'}
        draggable={false}
      />
    );
  }

  const initials = (name?.trim()?.slice(0, 1) || '?').toUpperCase();

  return (
    <span className='web-task-detail__avatar web-task-detail__avatar--fallback' aria-hidden='true'>
      {initials}
    </span>
  );
}

export function WebTaskDetailModal({
  task,
  integration,
  onClose,
  onExecute,
}: WebTaskDetailModalProps) {
  const sourceLabel = formatWebTaskSource(task.source);
  const jiraUrl = useMemo(
    () =>
      task.source === 'jira'
        ? buildWebJiraIssueUrl(integration?.jiraSiteUrl, task.externalId)
        : null,
    [integration?.jiraSiteUrl, task.externalId, task.source],
  );
  const descriptionHtml = useMemo(
    () => (task.description.trim() ? renderWebMarkdown(task.description) : ''),
    [task.description],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleExecute = useCallback(() => {
    void onExecute?.(task);
    onClose();
  }, [onClose, onExecute, task]);

  const handleOpenJira = useCallback(() => {
    if (!jiraUrl) {
      return;
    }
    window.open(jiraUrl, '_blank', 'noopener,noreferrer');
  }, [jiraUrl]);

  return createPortal(
    <div className='web-modal web-modal--viewport' role='presentation' onClick={onClose}>
      <div
        className='web-modal__card web-task-detail app-button--enter'
        role='dialog'
        aria-modal='true'
        aria-labelledby='web-task-detail-title'
        onClick={(event) => event.stopPropagation()}
      >
        <div className='web-task-detail__top'>
          <div className='web-task-detail__heading'>
            {task.externalId ? (
              <button
                type='button'
                className='web-task-detail__key app-button'
                disabled={!jiraUrl}
                onClick={handleOpenJira}
              >
                {task.externalId}
                {jiraUrl ? <ExternalLink size={12} aria-hidden='true' /> : null}
              </button>
            ) : (
              <span className='web-task-detail__source'>{sourceLabel}</span>
            )}
            <h2 id='web-task-detail-title' className='web-task-detail__title'>
              {task.title}
            </h2>
          </div>
          <button
            type='button'
            className='web-task-detail__close app-button app-button--enter'
            aria-label='Fechar detalhes da task'
            onClick={onClose}
          >
            <X size={16} strokeWidth={2.25} aria-hidden='true' />
          </button>
        </div>

        <div className='web-task-detail__body'>
          <section className='web-task-detail__main'>
            <h3 className='web-task-detail__section-label'>Descrição</h3>
            {descriptionHtml ? (
              <div
                className='web-task-detail__description markdown-preview'
                dangerouslySetInnerHTML={{ __html: descriptionHtml }}
              />
            ) : (
              <p className='web-task-detail__empty'>Sem descrição</p>
            )}
          </section>

          <aside className='web-task-detail__sidebar'>
            <h3 className='web-task-detail__section-label'>Informações</h3>

            <div className='web-task-detail__info-row'>
              <span className='web-task-detail__info-label'>Status</span>
              <span className='web-task-detail__info-value'>{task.status ?? '—'}</span>
            </div>

            <div className='web-task-detail__info-row'>
              <span className='web-task-detail__info-label'>Responsável</span>
              <div className='web-task-detail__info-person'>
                {task.assignee || task.assigneeAvatarUrl ? (
                  <TaskAvatar name={task.assignee} avatarUrl={task.assigneeAvatarUrl} />
                ) : (
                  <span className='web-task-detail__avatar web-task-detail__avatar--fallback'>
                    <User size={12} aria-hidden='true' />
                  </span>
                )}
                <span className='web-task-detail__info-value'>
                  {task.assignee ?? 'Não atribuído'}
                </span>
              </div>
            </div>

            <div className='web-task-detail__info-row'>
              <span className='web-task-detail__info-label'>Prioridade</span>
              <span className='web-task-detail__info-value'>{task.priority ?? '—'}</span>
            </div>

            {task.issueType ? (
              <div className='web-task-detail__info-row'>
                <span className='web-task-detail__info-label'>Tipo</span>
                <span className='web-task-detail__info-value'>{task.issueType}</span>
              </div>
            ) : null}

            {task.parentKey ? (
              <div className='web-task-detail__info-row'>
                <span className='web-task-detail__info-label'>Pai</span>
                <span className='web-task-detail__info-value'>
                  {task.parentKey}
                  {task.parentSummary ? ` — ${task.parentSummary}` : ''}
                </span>
              </div>
            ) : null}

            <div className='web-task-detail__info-row'>
              <span className='web-task-detail__info-label'>Prazo</span>
              <span className='web-task-detail__info-value'>{formatWebTaskDate(task.dueDate)}</span>
            </div>

            <div className='web-task-detail__info-row'>
              <span className='web-task-detail__info-label'>Origem</span>
              <span className='web-task-detail__info-value'>{sourceLabel}</span>
            </div>

            {task.labels.length > 0 ? (
              <div className='web-task-detail__info-row web-task-detail__info-row--stack'>
                <span className='web-task-detail__info-label'>Tags</span>
                <div className='web-task-detail__tags'>
                  {task.labels.map((label) => (
                    <span
                      key={label}
                      className='web-task-detail__tag'
                      style={{ borderColor: getWebTaskTagBorderColor(label) }}
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </aside>
        </div>

        <div className='web-task-detail__actions'>
          <button
            type='button'
            className='project-dialog__btn project-dialog__btn--ghost app-button'
            onClick={onClose}
          >
            Fechar
          </button>
          {onExecute ? (
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--play app-button app-button--enter'
              onClick={handleExecute}
            >
              <Play size={14} strokeWidth={2} aria-hidden='true' />
              Executar
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
