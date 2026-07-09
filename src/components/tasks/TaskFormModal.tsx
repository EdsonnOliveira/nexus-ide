import { Paperclip, Trash2, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { TaskAttachmentImage } from '@/components/tasks/TaskAttachmentImage';
import type { ProjectTask, ProjectTaskLocalMeta, TaskAttachment } from '@/types/task';
import {
  fromDatetimeLocalInputValue,
  getTaskTagBorderColor,
  LOCAL_TASK_PRIORITY_OPTIONS,
  toDatetimeLocalInputValue,
} from '@/utils/taskLabels';
import { readClipboardImageDataUrl } from '@/utils/terminalClipboardImage';

interface TaskFormModalProps {
  projectId: string;
  task: ProjectTask | null;
  autoFocusTitle?: boolean;
  onClose: () => void;
  onSave: (task: ProjectTask) => void;
}

function normalizeTagValue(value: string): string {
  return value.trim().replace(/,+$/, '').trim();
}

function resolveDueDateInput(task: ProjectTask | null): string {
  if (task?.local?.dueDate) {
    return toDatetimeLocalInputValue(task.local.dueDate);
  }

  if (!task) {
    return toDatetimeLocalInputValue(new Date().toISOString());
  }

  return '';
}

function TaskFormModalComponent({
  projectId,
  task,
  autoFocusTitle = false,
  onClose,
  onSave,
}: TaskFormModalProps) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [dueDateInput, setDueDateInput] = useState(() => resolveDueDateInput(task));
  const [priority, setPriority] = useState(task?.local?.priority ?? '');
  const [labels, setLabels] = useState<string[]>(task?.local?.labels ?? []);
  const [tagDraft, setTagDraft] = useState('');
  const [attachments, setAttachments] = useState<TaskAttachment[]>(task?.attachments ?? []);
  const [error, setError] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const taskId = useMemo(() => task?.id ?? crypto.randomUUID(), [task?.id]);

  useEffect(() => {
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
    setDueDateInput(resolveDueDateInput(task));
    setPriority(task?.local?.priority ?? '');
    setLabels(task?.local?.labels ?? []);
    setTagDraft('');
    setAttachments(task?.attachments ?? []);
    setError(null);
  }, [task]);

  useEffect(() => {
    if (!autoFocusTitle) {
      return;
    }

    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [autoFocusTitle, task]);

  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
      const dataUrl = await readClipboardImageDataUrl(event);

      if (!dataUrl) {
        return;
      }

      event.preventDefault();

      try {
        const saved = await window.nexus.tasks.saveAttachmentFromDataUrl(projectId, taskId, dataUrl);
        setAttachments((current) => [...current, saved]);
        setError(null);
      } catch {
        setError('Não foi possível colar a imagem.');
      }
    };

    window.addEventListener('paste', handlePaste);

    return () => {
      window.removeEventListener('paste', handlePaste);
    };
  }, [projectId, taskId]);

  const handleAddAttachment = useCallback(async () => {
    const sourcePath = await window.nexus.dialog.openFile();

    if (!sourcePath) {
      return;
    }

    const saved = await window.nexus.tasks.saveAttachment(projectId, taskId, sourcePath);
    setAttachments((current) => [...current, saved]);
  }, [projectId, taskId]);

  const handleRemoveAttachment = useCallback((attachmentId: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  }, []);

  const handleAddTag = useCallback((rawValue: string) => {
    const nextTag = normalizeTagValue(rawValue);

    if (!nextTag) {
      return;
    }

    setLabels((current) => (current.includes(nextTag) ? current : [...current, nextTag]));
    setTagDraft('');
  }, []);

  const handleRemoveTag = useCallback((tag: string) => {
    setLabels((current) => current.filter((item) => item !== tag));
  }, []);

  const handleTagKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        handleAddTag(tagDraft);
      }

      if (event.key === 'Backspace' && !tagDraft && labels.length > 0) {
        setLabels((current) => current.slice(0, -1));
      }
    },
    [handleAddTag, labels.length, tagDraft],
  );

  const handleSubmit = useCallback(
    (requestClose: () => void) => {
      const trimmedTitle = title.trim();

      if (!trimmedTitle) {
        setError('Informe o título da tarefa');
        return;
      }

      const dueDate = fromDatetimeLocalInputValue(dueDateInput);
      const localMeta: ProjectTaskLocalMeta = {};

      if (dueDate) {
        localMeta.dueDate = dueDate;
      }

      if (priority.trim()) {
        localMeta.priority = priority.trim();
      }

      if (labels.length > 0) {
        localMeta.labels = labels;
      }

      onSave({
        id: taskId,
        source: 'local',
        title: trimmedTitle,
        description: description.trim(),
        attachments,
        local: Object.keys(localMeta).length > 0 ? localMeta : undefined,
        updatedAt: Date.now(),
      });
      requestClose();
    },
    [attachments, description, dueDateInput, labels, onSave, priority, taskId, title],
  );

  return (
    <AnimatedModal onClose={onClose} panelClassName='project-dialog task-form-modal'>
      {(requestClose) => (
        <>
          <span className='project-dialog__title'>{task ? 'Editar tarefa' : 'Nova tarefa'}</span>
          <label className='task-form-modal__field'>
            <span>Título</span>
            <input
              ref={titleInputRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <div className='task-form-modal__row'>
            <label className='task-form-modal__field task-form-modal__field--inline'>
              <span>Data e hora</span>
              <input
                type='datetime-local'
                value={dueDateInput}
                onChange={(event) => setDueDateInput(event.target.value)}
              />
            </label>
            <label className='task-form-modal__field task-form-modal__field--inline'>
              <span>Prioridade</span>
              <AnchoredSelect
                value={priority}
                options={LOCAL_TASK_PRIORITY_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
                allowEmpty
                emptyLabel='Sem prioridade'
                onChange={(value) => setPriority(value)}
                triggerClassName='task-form-modal__select'
              />
            </label>
          </div>
          <label className='task-form-modal__field'>
            <span>Tags</span>
            <div className='task-form-modal__tags'>
              {labels.map((label) => (
                <span
                  key={label}
                  className='task-form-modal__tag'
                  style={{ borderColor: getTaskTagBorderColor(label) }}
                >
                  <span className='task-form-modal__tag-label'>{label}</span>
                  <button
                    type='button'
                    className='task-form-modal__tag-remove app-button'
                    aria-label={`Remover tag ${label}`}
                    onClick={() => handleRemoveTag(label)}
                  >
                    <X size={12} strokeWidth={2} />
                  </button>
                </span>
              ))}
              <input
                className='task-form-modal__tag-input'
                value={tagDraft}
                placeholder={labels.length > 0 ? 'Adicionar tag' : 'Digite e pressione Enter'}
                onChange={(event) => setTagDraft(event.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={() => handleAddTag(tagDraft)}
              />
            </div>
          </label>
          <label className='task-form-modal__field'>
            <span>Descrição</span>
            <textarea
              value={description}
              rows={6}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <div className='task-form-modal__attachments'>
            <div className='task-form-modal__attachments-header'>
              <span>Imagem/arquivo</span>
              <button
                type='button'
                className='task-form-modal__add-attachment app-button app-button--enter'
                onClick={() => void handleAddAttachment()}
              >
                <Paperclip size={14} strokeWidth={2} />
                <span className='app-button__label'>Adicionar</span>
              </button>
            </div>
            {attachments.length > 0 ? (
              <div className='task-form-modal__attachment-list'>
                {attachments.map((attachment) => (
                  <div key={attachment.id} className='task-form-modal__attachment-item'>
                    {attachment.kind === 'image' ? (
                      <TaskAttachmentImage
                        attachment={attachment}
                        className='task-form-modal__attachment-thumb'
                        alt={attachment.name}
                      />
                    ) : (
                      <span className='task-form-modal__attachment-name'>{attachment.name}</span>
                    )}
                    <button
                      type='button'
                      className='task-form-modal__attachment-remove app-button'
                      aria-label={`Remover ${attachment.name}`}
                      onClick={() => handleRemoveAttachment(attachment.id)}
                    >
                      <Trash2 size={12} strokeWidth={2} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          {error ? <p className='project-dialog__message project-dialog__message--error'>{error}</p> : null}
          <div className='project-dialog__actions'>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--ghost app-button'
              onClick={requestClose}
            >
              Cancelar
            </button>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--success app-button app-button--enter'
              onClick={() => handleSubmit(requestClose)}
            >
              Salvar
            </button>
          </div>
        </>
      )}
    </AnimatedModal>
  );
}

export const TaskFormModal = memo(TaskFormModalComponent);
