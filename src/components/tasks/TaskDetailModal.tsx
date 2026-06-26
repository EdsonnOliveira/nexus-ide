import { ExternalLink, History, ListTodo, Loader2, Pencil, Play, Send, User } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { EmptyState } from '@/components/overlay/EmptyState';
import { TaskAttachmentImage } from '@/components/tasks/TaskAttachmentImage';
import type { ProjectTask, TaskComment, TaskDetailData, TaskHistoryEntry } from '@/types/task';
import {
  buildDeepcrmTaskUrl,
  formatDeepcrmHealthLabel,
  formatDeepcrmIntegrationError,
  formatDeepcrmMrr,
  formatDeepcrmProjectStatus,
  formatDeepcrmSubtaskStatus,
  resolveDeepcrmHealthBadgeClass,
  resolveDeepcrmSubtaskBadgeClass,
} from '@/utils/deepcrmIntegration';
import { renderMarkdownPreview } from '@/utils/markdownPreview';
import { buildJiraIssueUrl, formatTaskIntegrationError } from '@/utils/jiraIntegration';
import {
  formatHistoryEmptyValue,
  formatTaskDate,
  formatTaskHistoryDate,
  formatTaskSource,
  getTaskInitials,
  getTaskTagBorderColor,
  resolveHistoryStatusBadge,
  resolveTaskCoverAttachment,
  resolveTaskPriorityVisual,
} from '@/utils/taskLabels';

type ActivityTab = 'all' | 'comments' | 'history';
type AttachmentTab = 'all' | 'images' | 'documents';
type DeepcrmDetailTab = 'tasks' | 'timeline';

interface TaskDetailModalProps {
  projectId: string;
  task: ProjectTask;
  jiraSiteUrl?: string;
  onClose: () => void;
  onEdit?: () => void;
  onExecute: () => void;
}

interface TaskAvatarProps {
  name?: string;
  avatarUrl?: string;
  className?: string;
}

function TaskAvatar({ name, avatarUrl, className }: TaskAvatarProps) {
  if (avatarUrl) {
    return <img className={className} src={avatarUrl} alt={name ?? ''} />;
  }

  return (
    <span className={`${className} task-detail-modal__avatar-fallback`} aria-hidden='true'>
      {getTaskInitials(name)}
    </span>
  );
}

function TaskHistoryValue({ value }: { value: string }) {
  const badge = resolveHistoryStatusBadge(value);

  if (badge) {
    return (
      <span className={`task-detail-modal__history-badge ${badge.className}`}>{badge.label}</span>
    );
  }

  return <span className='task-detail-modal__history-value'>{value}</span>;
}

interface TaskDescriptionContentProps {
  description: string;
  className?: string;
  emptyLabel?: string;
}

function TaskDescriptionContent({
  description,
  className,
  emptyLabel = 'Sem descrição',
}: TaskDescriptionContentProps) {
  const html = useMemo(
    () => (description ? renderMarkdownPreview(description) : ''),
    [description],
  );

  if (!description) {
    return <div className={className}>{emptyLabel}</div>;
  }

  return (
    <div
      className={`markdown-preview ${className ?? ''}`.trim()}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function TaskDetailModalComponent({
  projectId,
  task,
  jiraSiteUrl,
  onClose,
  onEdit,
  onExecute,
}: TaskDetailModalProps) {
  const isJiraTask = task.source === 'jira' && Boolean(task.externalId);
  const isDeepcrmTask =
    task.source === 'deepcrm' && Boolean(task.externalId?.startsWith('DC-P-'));
  const isRichDetailTask = isJiraTask || isDeepcrmTask;
  const [detail, setDetail] = useState<TaskDetailData | null>(null);
  const [isLoading, setIsLoading] = useState(isRichDetailTask);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activityTab, setActivityTab] = useState<ActivityTab>('all');
  const [attachmentTab, setAttachmentTab] = useState<AttachmentTab>('all');
  const [deepcrmTab, setDeepcrmTab] = useState<DeepcrmDetailTab>('tasks');
  const [commentDraft, setCommentDraft] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  const activeTask = detail?.task ?? task;
  const comments = detail?.comments ?? [];
  const history = detail?.history ?? [];

  const jiraIssueUrl = useMemo(() => {
    if (!isJiraTask || !task.externalId || !jiraSiteUrl) {
      return null;
    }

    return buildJiraIssueUrl(jiraSiteUrl, task.externalId);
  }, [isJiraTask, jiraSiteUrl, task.externalId]);

  const deepcrmProjectUrl = useMemo(() => {
    if (!isDeepcrmTask || !task.externalId) {
      return null;
    }

    return buildDeepcrmTaskUrl(task.externalId);
  }, [isDeepcrmTask, task.externalId]);

  const deepcrmData = detail?.deepcrm;
  const deepcrmSubtasks = deepcrmData?.subtasks ?? [];
  const completedSubtaskCount = useMemo(
    () => deepcrmSubtasks.filter((subtask) => subtask.status === 'Concluído').length,
    [deepcrmSubtasks],
  );
  const subtaskProgressPercent = useMemo(() => {
    if (deepcrmSubtasks.length === 0) {
      return 0;
    }

    return Math.round((completedSubtaskCount / deepcrmSubtasks.length) * 100);
  }, [completedSubtaskCount, deepcrmSubtasks.length]);

  const healthLabel = useMemo(
    () =>
      formatDeepcrmHealthLabel(
        activeTask.deepcrm?.healthScore,
        activeTask.deepcrm?.healthScoreNumeric,
      ),
    [activeTask.deepcrm?.healthScore, activeTask.deepcrm?.healthScoreNumeric],
  );

  const healthBadgeClass = useMemo(() => resolveDeepcrmHealthBadgeClass(healthLabel), [healthLabel]);

  const mrrLabel = useMemo(
    () => formatDeepcrmMrr(activeTask.deepcrm?.mrr),
    [activeTask.deepcrm?.mrr],
  );

  const projectStatusLabel = useMemo(
    () => formatDeepcrmProjectStatus(activeTask.deepcrm?.projectStatus),
    [activeTask.deepcrm?.projectStatus],
  );

  const priority = useMemo(
    () =>
      resolveTaskPriorityVisual(
        activeTask.jira?.priority ?? activeTask.deepcrm?.priority ?? activeTask.local?.priority,
      ),
    [activeTask.deepcrm?.priority, activeTask.jira?.priority, activeTask.local?.priority],
  );

  const coverAttachment = useMemo(() => resolveTaskCoverAttachment(activeTask), [activeTask]);

  const filteredAttachments = useMemo(() => {
    if (attachmentTab === 'images') {
      return activeTask.attachments.filter((attachment) => attachment.kind === 'image');
    }

    if (attachmentTab === 'documents') {
      return activeTask.attachments.filter((attachment) => attachment.kind !== 'image');
    }

    return activeTask.attachments;
  }, [activeTask.attachments, attachmentTab]);

  const activityItems = useMemo(() => {
    const commentItems = comments.map((comment) => ({
      kind: 'comment' as const,
      id: comment.id,
      createdAt: comment.createdAt,
      data: comment,
    }));

    const historyItems = history.map((entry) => ({
      kind: 'history' as const,
      id: entry.id,
      createdAt: entry.createdAt,
      data: entry,
    }));

    if (activityTab === 'comments') {
      return commentItems.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    }

    if (activityTab === 'history') {
      return historyItems.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    }

    return [...commentItems, ...historyItems].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  }, [activityTab, comments, history]);

  const loadDetail = useCallback(async () => {
    if (!isRichDetailTask || !task.externalId) {
      return;
    }

    setIsLoading(true);
    setLoadError(null);

    try {
      const nextDetail = await window.nexus.tasks.getDetail(projectId, task.externalId);
      setDetail(nextDetail);
    } catch (error) {
      setLoadError(
        isDeepcrmTask
          ? formatDeepcrmIntegrationError(error)
          : formatTaskIntegrationError(error),
      );
    } finally {
      setIsLoading(false);
    }
  }, [isDeepcrmTask, isRichDetailTask, projectId, task.externalId]);

  useEffect(() => {
    if (!isRichDetailTask) {
      return;
    }

    void loadDetail();
  }, [isRichDetailTask, loadDetail]);

  const handleEdit = useCallback(
    (requestClose: () => void) => {
      onEdit?.();
      requestClose();
    },
    [onEdit],
  );

  const handleExecute = useCallback(
    (requestClose: () => void) => {
      onExecute();
      requestClose();
    },
    [onExecute],
  );

  const handleOpenJira = useCallback(() => {
    if (!jiraIssueUrl) {
      return;
    }

    void window.nexus.tasks.openExternalUrl(jiraIssueUrl);
  }, [jiraIssueUrl]);

  const handleOpenDeepcrm = useCallback(() => {
    if (!deepcrmProjectUrl) {
      return;
    }

    void window.nexus.tasks.openExternalUrl(deepcrmProjectUrl);
  }, [deepcrmProjectUrl]);

  const handleSubmitComment = useCallback(async () => {
    if (!isJiraTask || !task.externalId) {
      return;
    }

    const trimmed = commentDraft.trim();

    if (!trimmed) {
      return;
    }

    setIsSubmittingComment(true);
    setCommentError(null);

    try {
      const created = await window.nexus.tasks.addComment(projectId, task.externalId, trimmed);
      setCommentDraft('');
      setDetail((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          comments: [created, ...current.comments],
        };
      });
    } catch (error) {
      setCommentError(formatTaskIntegrationError(error));
    } finally {
      setIsSubmittingComment(false);
    }
  }, [commentDraft, isJiraTask, projectId, task.externalId]);

  const description = activeTask.description.trim();
  const labels =
    activeTask.jira?.labels ?? activeTask.deepcrm?.labels ?? activeTask.local?.labels ?? [];
  const localDueDate = activeTask.local?.dueDate;
  const PriorityIcon = priority?.Icon;
  const panelClassName = isJiraTask
    ? 'project-dialog task-detail-modal task-detail-modal--jira'
    : isDeepcrmTask
      ? 'project-dialog task-detail-modal task-detail-modal--deepcrm'
      : 'project-dialog task-detail-modal task-detail-modal--local';

  const renderComment = (comment: TaskComment) => (
    <article key={comment.id} className='task-detail-modal__comment'>
      <TaskAvatar
        name={comment.authorName}
        avatarUrl={comment.authorAvatarUrl}
        className='task-detail-modal__comment-avatar'
      />
      <div className='task-detail-modal__comment-body'>
        <div className='task-detail-modal__comment-header'>
          <span className='task-detail-modal__comment-author'>{comment.authorName}</span>
          <time className='task-detail-modal__comment-date'>{formatTaskDate(comment.createdAt)}</time>
        </div>
        <p className='task-detail-modal__comment-text'>{comment.body || 'Sem conteúdo'}</p>
      </div>
    </article>
  );

  const renderHistory = (entry: TaskHistoryEntry) => (
    <article key={entry.id} className='task-detail-modal__history'>
      <TaskAvatar
        name={entry.authorName}
        avatarUrl={entry.authorAvatarUrl}
        className='task-detail-modal__history-avatar'
      />
      <div className='task-detail-modal__history-body'>
        <p className='task-detail-modal__history-summary'>
          <span className='task-detail-modal__history-author'>{entry.authorName}</span>
          <span className='task-detail-modal__history-action'>
            {entry.action ?? `atualizou o ${entry.field}`}
          </span>
        </p>
        <time className='task-detail-modal__history-date'>{formatTaskHistoryDate(entry.createdAt)}</time>
        {entry.from || entry.to ? (
          <div className='task-detail-modal__history-change'>
            <TaskHistoryValue value={entry.from ?? formatHistoryEmptyValue(entry.field)} />
            <span className='task-detail-modal__history-arrow' aria-hidden='true'>
              →
            </span>
            <TaskHistoryValue value={entry.to ?? formatHistoryEmptyValue(entry.field)} />
          </div>
        ) : (
          <p className='task-detail-modal__history-empty'>alterado</p>
        )}
      </div>
    </article>
  );

  const renderLocalContent = (requestClose: () => void) => (
    <>
      <div className='task-detail-modal__header'>
        <span className='project-dialog__title task-detail-modal__title'>{activeTask.title}</span>
        <span className={`tasks-drawer__source tasks-drawer__source--${activeTask.source}`}>
          {formatTaskSource(activeTask.source)}
        </span>
      </div>
      {activeTask.externalId ? (
        <span className='task-detail-modal__meta'>{activeTask.externalId}</span>
      ) : null}
      {activeTask.status ? <span className='task-detail-modal__status'>{activeTask.status}</span> : null}
      <div className='task-detail-modal__local-meta'>
        <div className='task-detail-modal__local-meta-item'>
          <span className='task-detail-modal__local-meta-label'>Data e hora</span>
          <span className='task-detail-modal__local-meta-value'>
            {localDueDate ? formatTaskDate(localDueDate) : '—'}
          </span>
        </div>
        <div className='task-detail-modal__local-meta-item'>
          <span className='task-detail-modal__local-meta-label'>Prioridade</span>
          <div className='task-detail-modal__local-meta-priority'>
            {priority && PriorityIcon ? (
              <span className={`tasks-drawer__priority ${priority.className}`}>
                <PriorityIcon size={14} strokeWidth={2.25} />
              </span>
            ) : null}
            <span className='task-detail-modal__local-meta-value'>
              {priority?.label ?? activeTask.local?.priority ?? '—'}
            </span>
          </div>
        </div>
      </div>
      {labels.length > 0 ? (
        <div className='task-detail-modal__local-tags'>
          <span className='task-detail-modal__section-label'>Tags</span>
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
        </div>
      ) : null}
      <TaskDescriptionContent
        description={description}
        className='task-detail-modal__description'
      />
      {activeTask.attachments.length > 0 ? (
        <div className='task-detail-modal__attachments'>
          <span className='task-detail-modal__section-label'>Anexos</span>
          <div className='task-detail-modal__attachment-list'>
            {activeTask.attachments.map((attachment) => (
              <div key={attachment.id} className='task-detail-modal__attachment-item'>
                {attachment.kind === 'image' ? (
                  <TaskAttachmentImage
                    attachment={attachment}
                    className='task-detail-modal__attachment-thumb'
                    alt={attachment.name}
                  />
                ) : (
                  <span className='task-detail-modal__attachment-name'>{attachment.name}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className='project-dialog__actions'>
        <button
          type='button'
          className='project-dialog__btn project-dialog__btn--ghost app-button'
          onClick={requestClose}
        >
          Fechar
        </button>
        {onEdit ? (
          <button
            type='button'
            className='project-dialog__btn project-dialog__btn--ghost app-button'
            onClick={() => handleEdit(requestClose)}
          >
            <Pencil size={14} strokeWidth={2} />
            <span className='app-button__label'>Editar</span>
          </button>
        ) : null}
        <button
          type='button'
          className='project-dialog__btn project-dialog__btn--play app-button'
          onClick={() => handleExecute(requestClose)}
        >
          <Play size={14} strokeWidth={2} />
          <span className='app-button__label'>Executar</span>
        </button>
      </div>
    </>
  );

  const renderJiraContent = (requestClose: () => void) => (
    <>
      <div className='task-detail-modal__layout'>
        <div className='task-detail-modal__main'>
          <div className='task-detail-modal__issue-header'>
            <div className='task-detail-modal__issue-key-row'>
              {activeTask.externalId ? (
                <button
                  type='button'
                  className='task-detail-modal__issue-key app-button'
                  onClick={handleOpenJira}
                  disabled={!jiraIssueUrl}
                >
                  {activeTask.externalId}
                  {jiraIssueUrl ? <ExternalLink size={12} strokeWidth={2} /> : null}
                </button>
              ) : null}
              <span className={`tasks-drawer__source tasks-drawer__source--${activeTask.source}`}>
                {formatTaskSource(activeTask.source)}
              </span>
            </div>
            <h2 className='task-detail-modal__issue-title'>{activeTask.title}</h2>
          </div>

          {coverAttachment ? (
            <div className='task-detail-modal__cover'>
              <TaskAttachmentImage
                attachment={coverAttachment}
                className='task-detail-modal__cover-image'
                alt=''
              />
            </div>
          ) : null}

          {isLoading ? (
            <div className='task-detail-modal__loading'>
              <Loader2 size={18} className='task-detail-modal__loading-icon' strokeWidth={2} />
              <span>Carregando detalhes...</span>
            </div>
          ) : null}

          {loadError ? <div className='task-detail-modal__error'>{loadError}</div> : null}

          <section className='task-detail-modal__section'>
            <h3 className='task-detail-modal__section-label'>Descrição</h3>
            <TaskDescriptionContent
              description={description}
              className='task-detail-modal__description'
            />
          </section>

          {activeTask.attachments.length > 0 ? (
            <section className='task-detail-modal__section'>
              <div className='task-detail-modal__section-header'>
                <h3 className='task-detail-modal__section-label'>Anexos</h3>
                <div className='task-detail-modal__attachment-tabs' role='tablist'>
                  {(['all', 'images', 'documents'] as AttachmentTab[]).map((tab) => (
                    <button
                      key={tab}
                      type='button'
                      role='tab'
                      aria-selected={attachmentTab === tab}
                      className={`task-detail-modal__tab app-button${attachmentTab === tab ? ' task-detail-modal__tab--active' : ''}`}
                      onClick={() => setAttachmentTab(tab)}
                    >
                      {tab === 'all' ? 'Tudo' : tab === 'images' ? 'Imagens' : 'Documentos'}
                    </button>
                  ))}
                </div>
              </div>
              <div className='task-detail-modal__attachment-list'>
                {filteredAttachments.map((attachment) => (
                  <div key={attachment.id} className='task-detail-modal__attachment-item'>
                    {attachment.kind === 'image' ? (
                      <TaskAttachmentImage
                        attachment={attachment}
                        className='task-detail-modal__attachment-thumb'
                        alt={attachment.name}
                      />
                    ) : (
                      <span className='task-detail-modal__attachment-name'>{attachment.name}</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className='task-detail-modal__section task-detail-modal__section--activity'>
            <div className='task-detail-modal__section-header'>
              <h3 className='task-detail-modal__section-label'>Atividade</h3>
              <div className='task-detail-modal__activity-tabs' role='tablist'>
                {(['all', 'comments', 'history'] as ActivityTab[]).map((tab) => (
                  <button
                    key={tab}
                    type='button'
                    role='tab'
                    aria-selected={activityTab === tab}
                    className={`task-detail-modal__tab app-button${activityTab === tab ? ' task-detail-modal__tab--active' : ''}`}
                    onClick={() => setActivityTab(tab)}
                  >
                    {tab === 'all' ? 'Tudo' : tab === 'comments' ? 'Comentários' : 'Histórico'}
                  </button>
                ))}
              </div>
            </div>

            <div className='task-detail-modal__comment-form'>
              <TaskAvatar name='Você' className='task-detail-modal__comment-avatar' />
              <div className='task-detail-modal__comment-input-wrap'>
                <textarea
                  className='task-detail-modal__comment-input'
                  value={commentDraft}
                  placeholder='Adicionar comentário...'
                  rows={2}
                  onChange={(event) => setCommentDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void handleSubmitComment();
                    }
                  }}
                />
                <div className='task-detail-modal__comment-actions'>
                  {commentError ? (
                    <span className='task-detail-modal__comment-error'>{commentError}</span>
                  ) : null}
                  <button
                    type='button'
                    className='task-detail-modal__comment-submit app-button app-button--enter'
                    disabled={isSubmittingComment || !commentDraft.trim()}
                    onClick={() => void handleSubmitComment()}
                  >
                    {isSubmittingComment ? (
                      <Loader2 size={14} className='task-detail-modal__loading-icon' strokeWidth={2} />
                    ) : (
                      <Send size={14} strokeWidth={2} />
                    )}
                    <span className='app-button__label'>Comentar</span>
                  </button>
                </div>
              </div>
            </div>

            <div className='task-detail-modal__activity-list'>
              {activityItems.length === 0 ? (
                <EmptyState
                  icon={User}
                  message={
                    activityTab === 'history'
                      ? 'Nenhuma alteração registrada'
                      : 'Nenhum comentário ainda'
                  }
                  compact
                />
              ) : (
                activityItems.map((item) =>
                  item.kind === 'comment' ? renderComment(item.data) : renderHistory(item.data),
                )
              )}
            </div>
          </section>
        </div>

        <aside className='task-detail-modal__sidebar'>
          <h3 className='task-detail-modal__sidebar-title'>Informações</h3>

          <div className='task-detail-modal__info-row'>
            <span className='task-detail-modal__info-label'>Status</span>
            <span className='task-detail-modal__info-value'>
              {activeTask.status ?? '—'}
            </span>
          </div>

          <div className='task-detail-modal__info-row'>
            <span className='task-detail-modal__info-label'>Responsável</span>
            <div className='task-detail-modal__info-person'>
              <TaskAvatar
                name={activeTask.jira?.assignee}
                avatarUrl={activeTask.jira?.assigneeAvatarUrl}
                className='task-detail-modal__info-avatar'
              />
              <span className='task-detail-modal__info-value'>
                {activeTask.jira?.assignee ?? 'Não atribuído'}
              </span>
            </div>
          </div>

          <div className='task-detail-modal__info-row'>
            <span className='task-detail-modal__info-label'>Prioridade</span>
            <div className='task-detail-modal__info-priority'>
              {priority && PriorityIcon ? (
                <span className={`tasks-drawer__priority ${priority.className}`}>
                  <PriorityIcon size={14} strokeWidth={2.25} />
                </span>
              ) : null}
              <span className='task-detail-modal__info-value'>
                {priority?.label ?? activeTask.jira?.priority ?? '—'}
              </span>
            </div>
          </div>

          {activeTask.jira?.parentKey ? (
            <div className='task-detail-modal__info-row'>
              <span className='task-detail-modal__info-label'>Pai</span>
              <span className='task-detail-modal__info-value'>
                {activeTask.jira.parentKey}
                {activeTask.jira.parentSummary ? ` — ${activeTask.jira.parentSummary}` : ''}
              </span>
            </div>
          ) : null}

          {labels.length > 0 ? (
            <div className='task-detail-modal__info-row task-detail-modal__info-row--stack'>
              <span className='task-detail-modal__info-label'>Categorias</span>
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
            </div>
          ) : null}

          <div className='task-detail-modal__info-row'>
            <span className='task-detail-modal__info-label'>Relator</span>
            <div className='task-detail-modal__info-person'>
              <TaskAvatar
                name={detail?.reporter ?? activeTask.jira?.reporter}
                avatarUrl={detail?.reporterAvatarUrl ?? activeTask.jira?.reporterAvatarUrl}
                className='task-detail-modal__info-avatar'
              />
              <span className='task-detail-modal__info-value'>
                {detail?.reporter ?? activeTask.jira?.reporter ?? '—'}
              </span>
            </div>
          </div>

          <div className='task-detail-modal__info-dates'>
            <div className='task-detail-modal__info-date'>
              <span className='task-detail-modal__info-label'>Criado</span>
              <span className='task-detail-modal__info-value'>
                {formatTaskDate(detail?.createdAt ?? activeTask.jira?.createdAt)}
              </span>
            </div>
            <div className='task-detail-modal__info-date'>
              <span className='task-detail-modal__info-label'>Atualizado</span>
              <span className='task-detail-modal__info-value'>
                {formatTaskDate(detail?.updatedAt)}
              </span>
            </div>
            <div className='task-detail-modal__info-date'>
              <span className='task-detail-modal__info-label'>Resolvido</span>
              <span className='task-detail-modal__info-value'>
                {formatTaskDate(detail?.resolvedAt ?? activeTask.jira?.resolvedAt)}
              </span>
            </div>
            {detail?.dueDate || activeTask.jira?.dueDate ? (
              <div className='task-detail-modal__info-date'>
                <span className='task-detail-modal__info-label'>Entrega</span>
                <span className='task-detail-modal__info-value'>
                  {formatTaskDate(detail?.dueDate ?? activeTask.jira?.dueDate)}
                </span>
              </div>
            ) : null}
          </div>
        </aside>
      </div>

      <div className='project-dialog__actions task-detail-modal__footer'>
        <button
          type='button'
          className='project-dialog__btn project-dialog__btn--ghost app-button'
          onClick={requestClose}
        >
          Fechar
        </button>
        <button
          type='button'
          className='project-dialog__btn project-dialog__btn--play app-button'
          onClick={() => handleExecute(requestClose)}
        >
          <Play size={14} strokeWidth={2} />
          <span className='app-button__label'>Executar</span>
        </button>
      </div>
    </>
  );

  const renderDeepcrmContent = (requestClose: () => void) => (
    <>
      <div className='task-detail-modal__layout'>
        <div className='task-detail-modal__main'>
          <div className='task-detail-modal__issue-header'>
            <div className='task-detail-modal__issue-key-row'>
              {activeTask.externalId ? (
                <button
                  type='button'
                  className='task-detail-modal__issue-key app-button'
                  onClick={handleOpenDeepcrm}
                  disabled={!deepcrmProjectUrl}
                >
                  {activeTask.externalId}
                  {deepcrmProjectUrl ? <ExternalLink size={12} strokeWidth={2} /> : null}
                </button>
              ) : null}
              <span className={`tasks-drawer__source tasks-drawer__source--${activeTask.source}`}>
                {formatTaskSource(activeTask.source)}
              </span>
            </div>
            <h2 className='task-detail-modal__issue-title'>{activeTask.title}</h2>
          </div>

          {isLoading ? (
            <div className='task-detail-modal__loading'>
              <Loader2 size={18} className='task-detail-modal__loading-icon' strokeWidth={2} />
              <span>Carregando detalhes...</span>
            </div>
          ) : null}

          {loadError ? <div className='task-detail-modal__error'>{loadError}</div> : null}

          {description ? (
            <section className='task-detail-modal__section'>
              <h3 className='task-detail-modal__section-label'>Descrição</h3>
              <TaskDescriptionContent
                description={description}
                className='task-detail-modal__description'
              />
            </section>
          ) : null}

          <section className='task-detail-modal__section task-detail-modal__section--deepcrm'>
            <div className='task-detail-modal__section-header'>
              <h3 className='task-detail-modal__section-label'>Projeto</h3>
              <div className='task-detail-modal__deepcrm-tabs' role='tablist'>
                {(['tasks', 'timeline'] as DeepcrmDetailTab[]).map((tab) => (
                  <button
                    key={tab}
                    type='button'
                    role='tab'
                    aria-selected={deepcrmTab === tab}
                    className={`task-detail-modal__tab app-button${deepcrmTab === tab ? ' task-detail-modal__tab--active' : ''}`}
                    onClick={() => setDeepcrmTab(tab)}
                  >
                    {tab === 'tasks' ? 'Tarefas' : 'Timeline'}
                  </button>
                ))}
              </div>
            </div>

            {deepcrmTab === 'tasks' ? (
              <>
                {deepcrmSubtasks.length > 0 ? (
                  <div className='task-detail-modal__deepcrm-progress'>
                    <div className='task-detail-modal__deepcrm-progress-header'>
                      <span className='task-detail-modal__deepcrm-progress-label'>
                        {completedSubtaskCount}/{deepcrmSubtasks.length} concluídas
                      </span>
                      <span className='task-detail-modal__deepcrm-progress-percent'>
                        {subtaskProgressPercent}%
                      </span>
                    </div>
                    <div className='task-detail-modal__deepcrm-progress-track'>
                      <div
                        className='task-detail-modal__deepcrm-progress-fill'
                        style={{ width: `${subtaskProgressPercent}%` }}
                      />
                    </div>
                  </div>
                ) : null}

                <div className='task-detail-modal__deepcrm-subtask-list'>
                  {deepcrmSubtasks.length === 0 ? (
                    <EmptyState icon={ListTodo} message='Nenhuma tarefa vinculada' compact />
                  ) : (
                    deepcrmSubtasks.map((subtask) => {
                      const statusLabel = formatDeepcrmSubtaskStatus(subtask.status);
                      const badgeClass = resolveDeepcrmSubtaskBadgeClass(subtask.status);

                      return (
                        <article key={subtask.id} className='task-detail-modal__deepcrm-subtask'>
                          <div className='task-detail-modal__deepcrm-subtask-main'>
                            <span className='task-detail-modal__deepcrm-subtask-title'>
                              {subtask.title}
                            </span>
                            {subtask.description ? (
                              <TaskDescriptionContent
                                description={subtask.description}
                                className='task-detail-modal__deepcrm-subtask-description'
                                emptyLabel=''
                              />
                            ) : null}
                          </div>
                          <div className='task-detail-modal__deepcrm-subtask-meta'>
                            <span
                              className={`task-detail-modal__deepcrm-subtask-badge ${badgeClass}`}
                            >
                              {statusLabel}
                            </span>
                            {subtask.dueDate ? (
                              <time className='task-detail-modal__deepcrm-subtask-date'>
                                {formatTaskDate(subtask.dueDate)}
                              </time>
                            ) : null}
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </>
            ) : (
              <div className='task-detail-modal__activity-list'>
                {history.length === 0 ? (
                  <EmptyState icon={History} message='Nenhum evento registrado' compact />
                ) : (
                  history.map((entry) => renderHistory(entry))
                )}
              </div>
            )}
          </section>
        </div>

        <aside className='task-detail-modal__sidebar'>
          <h3 className='task-detail-modal__sidebar-title'>Informações</h3>

          {healthLabel ? (
            <div className='task-detail-modal__info-row'>
              <span className='task-detail-modal__info-label'>Saúde</span>
              <span
                className={`task-detail-modal__health-badge ${healthBadgeClass}`.trim()}
              >
                {healthLabel}
                {typeof activeTask.deepcrm?.healthScoreNumeric === 'number' ? (
                  <span className='task-detail-modal__health-score'>
                    {activeTask.deepcrm.healthScoreNumeric}
                  </span>
                ) : null}
              </span>
            </div>
          ) : null}

          {mrrLabel ? (
            <div className='task-detail-modal__info-row'>
              <span className='task-detail-modal__info-label'>MRR</span>
              <span className='task-detail-modal__info-value task-detail-modal__info-value--mrr'>
                {mrrLabel}
              </span>
            </div>
          ) : null}

          {activeTask.deepcrm?.stageName ? (
            <div className='task-detail-modal__info-row'>
              <span className='task-detail-modal__info-label'>Estágio</span>
              <span className='task-detail-modal__info-value'>{activeTask.deepcrm.stageName}</span>
            </div>
          ) : null}

          {projectStatusLabel ? (
            <div className='task-detail-modal__info-row'>
              <span className='task-detail-modal__info-label'>Status projeto</span>
              <span className='task-detail-modal__info-value'>{projectStatusLabel}</span>
            </div>
          ) : null}

          <div className='task-detail-modal__info-row'>
            <span className='task-detail-modal__info-label'>Responsável</span>
            <div className='task-detail-modal__info-person'>
              <TaskAvatar
                name={activeTask.deepcrm?.assignee}
                avatarUrl={activeTask.deepcrm?.assigneeAvatarUrl}
                className='task-detail-modal__info-avatar'
              />
              <span className='task-detail-modal__info-value'>
                {activeTask.deepcrm?.assignee ?? 'Não atribuído'}
              </span>
            </div>
          </div>

          {deepcrmData?.companyName ? (
            <div className='task-detail-modal__info-row'>
              <span className='task-detail-modal__info-label'>Empresa</span>
              <span className='task-detail-modal__info-value'>{deepcrmData.companyName}</span>
            </div>
          ) : null}

          {deepcrmData?.contactName || deepcrmData?.contactEmail ? (
            <div className='task-detail-modal__info-row task-detail-modal__info-row--stack'>
              <span className='task-detail-modal__info-label'>Contato</span>
              {deepcrmData.contactName ? (
                <span className='task-detail-modal__info-value'>{deepcrmData.contactName}</span>
              ) : null}
              {deepcrmData.contactEmail ? (
                <span className='task-detail-modal__info-value task-detail-modal__info-value--muted'>
                  {deepcrmData.contactEmail}
                </span>
              ) : null}
            </div>
          ) : null}

          <div className='task-detail-modal__info-dates'>
            {deepcrmData?.startDate ? (
              <div className='task-detail-modal__info-date'>
                <span className='task-detail-modal__info-label'>Início</span>
                <span className='task-detail-modal__info-value'>
                  {formatTaskDate(deepcrmData.startDate)}
                </span>
              </div>
            ) : null}
            {deepcrmData?.renewalDate ? (
              <div className='task-detail-modal__info-date'>
                <span className='task-detail-modal__info-label'>Renovação</span>
                <span className='task-detail-modal__info-value'>
                  {formatTaskDate(deepcrmData.renewalDate)}
                </span>
              </div>
            ) : null}
            {deepcrmData?.paymentModel ? (
              <div className='task-detail-modal__info-date'>
                <span className='task-detail-modal__info-label'>Pagamento</span>
                <span className='task-detail-modal__info-value'>{deepcrmData.paymentModel}</span>
              </div>
            ) : null}
            {deepcrmData?.installmentsSummary ? (
              <div className='task-detail-modal__info-date'>
                <span className='task-detail-modal__info-label'>Parcelas</span>
                <span className='task-detail-modal__info-value'>
                  {deepcrmData.installmentsSummary.paidCount} pagas ·{' '}
                  {deepcrmData.installmentsSummary.pendingCount} pendentes
                </span>
              </div>
            ) : null}
          </div>

          {deepcrmData?.milestones && deepcrmData.milestones.length > 0 ? (
            <div className='task-detail-modal__info-row task-detail-modal__info-row--stack'>
              <span className='task-detail-modal__info-label'>Marcos</span>
              <div className='task-detail-modal__deepcrm-milestones'>
                {deepcrmData.milestones.map((milestone) => (
                  <div key={milestone.id} className='task-detail-modal__deepcrm-milestone'>
                    <span className='task-detail-modal__deepcrm-milestone-title'>
                      {milestone.title}
                    </span>
                    {milestone.dueDate ? (
                      <time className='task-detail-modal__deepcrm-milestone-date'>
                        {formatTaskDate(milestone.dueDate)}
                      </time>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
      </div>

      <div className='project-dialog__actions task-detail-modal__footer'>
        <button
          type='button'
          className='project-dialog__btn project-dialog__btn--ghost app-button'
          onClick={requestClose}
        >
          Fechar
        </button>
        <button
          type='button'
          className='project-dialog__btn project-dialog__btn--play app-button'
          onClick={() => handleExecute(requestClose)}
        >
          <Play size={14} strokeWidth={2} />
          <span className='app-button__label'>Executar</span>
        </button>
      </div>
    </>
  );

  return (
    <AnimatedModal onClose={onClose} panelClassName={panelClassName}>
      {(requestClose) =>
        isJiraTask
          ? renderJiraContent(requestClose)
          : isDeepcrmTask
            ? renderDeepcrmContent(requestClose)
            : renderLocalContent(requestClose)
      }
    </AnimatedModal>
  );
}

export const TaskDetailModal = memo(TaskDetailModalComponent);
