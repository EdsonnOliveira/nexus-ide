import {
  File,
  Image,
  Loader2,
  Mic,
  Paperclip,
  Sparkles,
  Split,
  Square,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { ProjectIconMark } from '@/components/sidebar/ProjectIconMark';
import { TaskAttachmentPreview } from '@/components/tasks/TaskAttachmentImage';
import { useProjectStore } from '@/stores/useProjectStore';
import type { Project } from '@/types';
import type { ProjectTask, ProjectTaskLocalMeta, TaskAttachment } from '@/types/task';
import { generateTaskAiDraft, type TaskAiDraft } from '@/utils/taskAiDraft';
import {
  fromDatetimeLocalInputValue,
  getTaskTagBorderColor,
  isAudioAttachmentName,
  isImageAttachmentName,
  isVideoAttachmentName,
  LOCAL_TASK_PRIORITY_OPTIONS,
  resolveTaskAttachmentPreviewKind,
  toDatetimeLocalInputValue,
} from '@/utils/taskLabels';
import {
  blobToWavBase64,
  captureVideoFrame,
  startTaskAudioRecording,
  textToDataUrl,
  wavBase64ToDataUrl,
  type TaskAudioRecording,
} from '@/utils/taskMedia';
import { LOCAL_TASK_STATUS_PENDING } from '@/utils/taskJson';
import { readClipboardImageDataUrl } from '@/utils/terminalClipboardImage';

interface TaskFormModalProps {
  projectId: string;
  task: ProjectTask | null;
  projects?: Project[];
  autoFocusTitle?: boolean;
  onClose: () => void;
  onSave: (task: ProjectTask) => void;
  onSaveMany?: (tasks: ProjectTask[]) => void;
  onProjectChange?: (projectId: string) => void;
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

function isAudioAttachment(attachment: TaskAttachment): boolean {
  return Boolean(
    attachment.mimeType?.startsWith('audio/') || isAudioAttachmentName(attachment.name),
  );
}

function isVideoAttachment(attachment: TaskAttachment): boolean {
  return Boolean(
    attachment.mimeType?.startsWith('video/') || isVideoAttachmentName(attachment.name),
  );
}

interface TaskFormProjectThumbProps {
  logo?: string | null;
  icon: string;
  color: string;
}

function TaskFormProjectThumbComponent({ logo, icon, color }: TaskFormProjectThumbProps) {
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setLogoSrc(null);
    setLogoFailed(false);

    if (!logo || !window.nexus) {
      return;
    }

    void window.nexus.files.readImageAsDataUrl(logo).then((dataUrl) => {
      if (cancelled) {
        return;
      }

      if (dataUrl) {
        setLogoSrc(dataUrl);
        return;
      }

      setLogoFailed(true);
    });

    return () => {
      cancelled = true;
    };
  }, [logo]);

  const handleLogoError = useCallback(() => {
    setLogoFailed(true);
    setLogoSrc(null);
  }, []);

  if (logoSrc && !logoFailed) {
    return (
      <img
        key={logo}
        src={logoSrc}
        alt=''
        className='task-form-modal__project-logo'
        onError={handleLogoError}
      />
    );
  }

  return (
    <span className='task-form-modal__project-icon' style={{ background: color }}>
      <ProjectIconMark icon={icon} size={12} />
    </span>
  );
}

const TaskFormProjectThumb = memo(TaskFormProjectThumbComponent);

function TaskFormModalComponent({
  projectId,
  task,
  projects,
  autoFocusTitle = false,
  onClose,
  onSave,
  onSaveMany,
  onProjectChange,
}: TaskFormModalProps) {
  const projectPath = useProjectStore(
    (state) => state.projects.find((item) => item.id === projectId)?.path ?? '',
  );
  const isCreate = !task;
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [dueDateInput, setDueDateInput] = useState(() => resolveDueDateInput(task));
  const [priority, setPriority] = useState(task?.local?.priority ?? '');
  const [labels, setLabels] = useState<string[]>(task?.local?.labels ?? []);
  const [tagDraft, setTagDraft] = useState('');
  const [attachments, setAttachments] = useState<TaskAttachment[]>(task?.attachments ?? []);
  const [aiText, setAiText] = useState('');
  const [recording, setRecording] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [splitDrafts, setSplitDrafts] = useState<TaskAiDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const recordingRef = useRef<TaskAudioRecording | null>(null);
  const attachmentsRef = useRef(attachments);
  const projectIdRef = useRef(projectId);
  const taskId = useMemo(() => task?.id ?? crypto.randomUUID(), [task?.id]);
  const selectedProject = useMemo(
    () => (projects ?? []).find((item) => item.id === projectId) ?? null,
    [projectId, projects],
  );
  const projectOptions = useMemo(
    () =>
      (projects ?? []).map((item) => ({
        value: item.id,
        label: item.name,
        icon: <TaskFormProjectThumb logo={item.logo} icon={item.icon} color={item.color} />,
      })),
    [projects],
  );
  const projectLeadingIcon = useMemo(() => {
    if (!selectedProject) {
      return null;
    }

    return (
      <TaskFormProjectThumb
        logo={selectedProject.logo}
        icon={selectedProject.icon}
        color={selectedProject.color}
      />
    );
  }, [selectedProject]);
  const canPickProject = Boolean(isCreate && onProjectChange && projectOptions.length > 0);

  attachmentsRef.current = attachments;

  useEffect(() => {
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
    setDueDateInput(resolveDueDateInput(task));
    setPriority(task?.local?.priority ?? '');
    setLabels(task?.local?.labels ?? []);
    setTagDraft('');
    setAttachments(task?.attachments ?? []);
    setAiText('');
    setSplitDrafts(null);
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
        const saved = await window.nexus.tasks.saveAttachmentFromDataUrl(
          projectId,
          taskId,
          dataUrl,
        );
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

  useEffect(() => {
    const previousProjectId = projectIdRef.current;
    projectIdRef.current = projectId;

    if (task || previousProjectId === projectId) {
      return;
    }

    const current = attachmentsRef.current;

    if (current.length === 0) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const remounted = await Promise.all(
          current.map((attachment) =>
            window.nexus.tasks.saveAttachment(projectId, taskId, attachment.path),
          ),
        );

        if (cancelled) {
          return;
        }

        attachmentsRef.current = remounted;
        setAttachments(remounted);
      } catch {
        if (!cancelled) {
          setError('Não foi possível mover os anexos para o projeto.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, task, taskId]);

  useEffect(() => {
    return () => {
      void recordingRef.current?.stop();
      recordingRef.current = null;
    };
  }, []);

  const pushAttachment = useCallback((saved: TaskAttachment) => {
    setAttachments((current) => {
      const next = [...current, saved];
      attachmentsRef.current = next;
      return next;
    });
    return saved;
  }, []);

  const saveDataUrlAttachment = useCallback(
    async (dataUrl: string, fileName?: string) => {
      const saved = await window.nexus.tasks.saveAttachmentFromDataUrl(
        projectId,
        taskId,
        dataUrl,
        fileName,
      );
      return pushAttachment(saved);
    },
    [projectId, pushAttachment, taskId],
  );

  const handleAddAttachment = useCallback(async () => {
    const sourcePath = await window.nexus.dialog.openFile();

    if (!sourcePath) {
      return;
    }

    const saved = await window.nexus.tasks.saveAttachment(projectId, taskId, sourcePath);
    pushAttachment(saved);
  }, [projectId, pushAttachment, taskId]);

  const handleRemoveAttachment = useCallback((attachmentId: string) => {
    setAttachments((current) => {
      const next = current.filter((attachment) => attachment.id !== attachmentId);
      attachmentsRef.current = next;
      return next;
    });
  }, []);

  const applyDraft = useCallback((draft: TaskAiDraft) => {
    setTitle(draft.title);
    setDescription(draft.description);

    if (draft.priority) {
      setPriority(draft.priority);
    }

    if (draft.labels.length > 0) {
      setLabels((current) => {
        const next = [...current];

        for (const label of draft.labels) {
          if (!next.includes(label)) {
            next.push(label);
          }
        }

        return next;
      });
    }
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

  const handleAttachImage = useCallback(async () => {
    const sourcePaths = await window.nexus.dialog.openImages();

    if (!sourcePaths || sourcePaths.length === 0) {
      return;
    }

    for (const sourcePath of sourcePaths) {
      const saved = await window.nexus.tasks.saveAttachment(projectId, taskId, sourcePath);
      pushAttachment(saved);
    }

    setError(null);
  }, [projectId, pushAttachment, taskId]);

  const handleAttachVideo = useCallback(async () => {
    const sourcePaths = await window.nexus.dialog.openVideos();

    if (!sourcePaths || sourcePaths.length === 0) {
      return;
    }

    for (const sourcePath of sourcePaths) {
      const saved = await window.nexus.tasks.saveAttachment(projectId, taskId, sourcePath);
      pushAttachment(saved);

      try {
        const frame = await captureVideoFrame(window.nexus.files.toLocalUrl(saved.path));
        await saveDataUrlAttachment(frame, `frame-${Date.now()}.jpg`);
      } catch {}
    }

    setError(null);
  }, [projectId, pushAttachment, saveDataUrlAttachment, taskId]);

  const handleAttachFile = useCallback(async () => {
    const sourcePaths = await window.nexus.dialog.openFiles();

    if (!sourcePaths || sourcePaths.length === 0) {
      return;
    }

    try {
      for (const sourcePath of sourcePaths) {
        const saved = await window.nexus.tasks.saveAttachment(projectId, taskId, sourcePath);
        pushAttachment(saved);

        if (isVideoAttachment(saved)) {
          try {
            const frame = await captureVideoFrame(window.nexus.files.toLocalUrl(saved.path));
            await saveDataUrlAttachment(frame, `frame-${Date.now()}.jpg`);
          } catch {}
        }
      }

      setError(null);
    } catch {
      setError('Não foi possível anexar o arquivo.');
    }
  }, [projectId, pushAttachment, saveDataUrlAttachment, taskId]);

  const handleToggleRecording = useCallback(async () => {
    if (recordingRef.current) {
      const blob = await recordingRef.current.stop();
      recordingRef.current = null;
      setRecording(false);

      try {
        const wavBase64 = await blobToWavBase64(blob);
        await saveDataUrlAttachment(wavBase64ToDataUrl(wavBase64), `audio-${Date.now()}.wav`);
        setError(null);
      } catch {
        setError('Não foi possível salvar o áudio.');
      }

      return;
    }

    try {
      recordingRef.current = await startTaskAudioRecording();
      setRecording(true);
      setError(null);
    } catch {
      setError('Permissão de microfone negada.');
    }
  }, [saveDataUrlAttachment]);

  const handleGenerateWithAi = useCallback(async () => {
    if (generating) {
      return;
    }

    setGenerating(true);
    setError(null);
    setSplitDrafts(null);

    try {
      if (recordingRef.current) {
        const blob = await recordingRef.current.stop();
        recordingRef.current = null;
        setRecording(false);
        const wavBase64 = await blobToWavBase64(blob);
        await saveDataUrlAttachment(wavBase64ToDataUrl(wavBase64), `audio-${Date.now()}.wav`);
      }

      const promptText = aiText.trim();

      if (promptText) {
        await saveDataUrlAttachment(textToDataUrl(promptText), `texto-${Date.now()}.txt`);
      }

      const nextAttachments = attachmentsRef.current;

      const audioAttachments = nextAttachments.filter(isAudioAttachment);
      const transcripts: string[] = [];

      for (const audio of audioAttachments) {
        try {
          const base64 = await window.nexus.tasks.readAttachment(audio.path);
          const wavBase64 =
            audio.mimeType === 'audio/wav' || audio.name.toLowerCase().endsWith('.wav')
              ? base64
              : await blobToWavBase64(
                  await (
                    await fetch(`data:${audio.mimeType ?? 'audio/mpeg'};base64,${base64}`)
                  ).blob(),
                );
          const result = await window.nexus.jarvis.transcribe(wavBase64);

          if (result.transcript.trim()) {
            transcripts.push(result.transcript.trim());
          }
        } catch {}
      }

      const imagePaths = nextAttachments
        .filter(
          (attachment) =>
            attachment.kind === 'image' ||
            attachment.mimeType?.startsWith('image/') ||
            isImageAttachmentName(attachment.name),
        )
        .map((attachment) => attachment.path);
      const filePaths = nextAttachments
        .filter((attachment) => resolveTaskAttachmentPreviewKind(attachment) === 'file')
        .map((attachment) => attachment.path);
      const hasVideos = nextAttachments.some(isVideoAttachment);
      const hasAudio = audioAttachments.length > 0;
      const hasFiles = filePaths.length > 0;

      if (
        !promptText &&
        transcripts.length === 0 &&
        imagePaths.length === 0 &&
        !hasVideos &&
        !hasAudio &&
        !hasFiles
      ) {
        setError('Envie texto, áudio, imagem, vídeo ou arquivo para gerar a tarefa.');
        return;
      }

      if (!projectPath) {
        setError('Projeto não encontrado.');
        return;
      }

      const bundle = await generateTaskAiDraft({
        projectPath,
        text: promptText,
        transcript: transcripts.join('\n\n'),
        imagePaths,
        filePaths,
        hasVideos,
        hasAudio,
        attachments: nextAttachments.map((attachment, index) => ({
          index,
          name: attachment.name,
          kind: resolveTaskAttachmentPreviewKind(attachment),
        })),
      });

      const [firstDraft] = bundle.drafts;

      if (!firstDraft) {
        setError('A IA não gerou uma tarefa.');
        return;
      }

      applyDraft(firstDraft);
      setAiText('');

      if (bundle.drafts.length > 1) {
        setSplitDrafts(bundle.drafts);
        return;
      }
    } catch (generateError) {
      setError(
        generateError instanceof Error ? generateError.message : 'Não foi possível gerar a tarefa.',
      );
    } finally {
      setGenerating(false);
    }
  }, [aiText, applyDraft, generating, projectPath, saveDataUrlAttachment]);

  const handleSplit = useCallback(
    async (requestClose: () => void) => {
      if (!splitDrafts || splitDrafts.length < 2 || !onSaveMany || splitting) {
        return;
      }

      setSplitting(true);
      setError(null);

      try {
        const sourceAttachments = attachmentsRef.current;
        const created: ProjectTask[] = [];

        for (const [index, draft] of splitDrafts.entries()) {
          const nextId = index === 0 ? taskId : crypto.randomUUID();
          const selected =
            draft.attachmentIndexes.length > 0
              ? draft.attachmentIndexes
                  .map((attachmentIndex) => sourceAttachments[attachmentIndex])
                  .filter((item): item is TaskAttachment => Boolean(item))
              : sourceAttachments;
          const cloned: TaskAttachment[] = [];

          for (const attachment of selected) {
            cloned.push(
              await window.nexus.tasks.saveAttachment(projectId, nextId, attachment.path),
            );
          }

          const dueDate = fromDatetimeLocalInputValue(dueDateInput);
          const localMeta: ProjectTaskLocalMeta = {};

          if (dueDate) {
            localMeta.dueDate = dueDate;
          }

          if (draft.priority.trim()) {
            localMeta.priority = draft.priority.trim();
          }

          if (draft.labels.length > 0) {
            localMeta.labels = draft.labels;
          }

          created.push({
            id: nextId,
            source: 'local',
            title: draft.title.trim(),
            description: draft.description.trim(),
            status: LOCAL_TASK_STATUS_PENDING,
            attachments: cloned,
            local: Object.keys(localMeta).length > 0 ? localMeta : undefined,
            updatedAt: Date.now(),
          });
        }

        onSaveMany(created);
        requestClose();
      } catch {
        setError('Não foi possível separar as tarefas.');
      } finally {
        setSplitting(false);
      }
    },
    [dueDateInput, onSaveMany, projectId, splitDrafts, splitting, taskId],
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
        status: task?.status?.trim() || LOCAL_TASK_STATUS_PENDING,
        attachments,
        local: Object.keys(localMeta).length > 0 ? localMeta : undefined,
        updatedAt: Date.now(),
      });
      requestClose();
    },
    [attachments, description, dueDateInput, labels, onSave, priority, task, taskId, title],
  );

  const busy = generating || recording || splitting;

  return (
    <AnimatedModal
      onClose={onClose}
      closeDisabled={busy}
      panelClassName='project-dialog task-form-modal'
    >
      {(requestClose) => (
        <>
          <span className='project-dialog__title'>{task ? 'Editar tarefa' : 'Nova tarefa'}</span>
          <div className='task-form-modal__body'>
            {canPickProject ? (
              <label className='task-form-modal__field'>
                <span>Projeto</span>
                <AnchoredSelect
                  value={projectId}
                  options={projectOptions}
                  allowEmpty={false}
                  emptyLabel='Projeto'
                  disabled={busy}
                  leadingIcon={projectLeadingIcon}
                  onChange={(value) => {
                    if (value) {
                      onProjectChange?.(value);
                    }
                  }}
                  triggerClassName='task-form-modal__select'
                />
              </label>
            ) : null}
            {isCreate ? (
              <div className='task-form-modal__ai'>
                <span>Criar com IA</span>
                <textarea
                  value={aiText}
                  rows={3}
                  placeholder='Mande texto, áudio, imagem, vídeo ou arquivo. A IA descreve o que precisa ser feito.'
                  disabled={generating || splitting}
                  onChange={(event) => setAiText(event.target.value)}
                />
                <div className='task-form-modal__ai-actions'>
                  <button
                    type='button'
                    className={`task-form-modal__ai-btn app-button app-button--enter${recording ? ' task-form-modal__ai-btn--recording' : ''}`}
                    aria-label={recording ? 'Parar gravação' : 'Gravar áudio'}
                    disabled={generating || splitting}
                    onClick={() => void handleToggleRecording()}
                  >
                    {recording ? (
                      <Square size={14} strokeWidth={2} />
                    ) : (
                      <Mic size={14} strokeWidth={2} />
                    )}
                  </button>
                  <button
                    type='button'
                    className='task-form-modal__ai-btn app-button app-button--enter'
                    aria-label='Anexar imagem'
                    disabled={busy}
                    onClick={() => void handleAttachImage()}
                  >
                    <Image size={14} strokeWidth={2} />
                  </button>
                  <button
                    type='button'
                    className='task-form-modal__ai-btn app-button app-button--enter'
                    aria-label='Anexar vídeo'
                    disabled={busy}
                    onClick={() => void handleAttachVideo()}
                  >
                    <Video size={14} strokeWidth={2} />
                  </button>
                  <button
                    type='button'
                    className='task-form-modal__ai-btn app-button app-button--enter'
                    aria-label='Anexar arquivo'
                    disabled={busy}
                    onClick={() => void handleAttachFile()}
                  >
                    <File size={14} strokeWidth={2} />
                  </button>
                  <button
                    type='button'
                    className='task-form-modal__ai-generate app-button app-button--enter'
                    disabled={generating || splitting}
                    onClick={() => void handleGenerateWithAi()}
                  >
                    {generating ? (
                      <Loader2 size={14} className='task-form-modal__ai-spinner' strokeWidth={2} />
                    ) : (
                      <Sparkles size={14} strokeWidth={2} />
                    )}
                    <span className='app-button__label'>
                      {generating ? 'Gerando...' : recording ? 'Parar e gerar' : 'Gerar com IA'}
                    </span>
                  </button>
                </div>
                {recording ? (
                  <span className='task-form-modal__ai-status'>Gravando áudio...</span>
                ) : null}
                {generating ? (
                  <span className='task-form-modal__ai-status'>
                    A IA está descrevendo a tarefa...
                  </span>
                ) : null}
                {splitDrafts && splitDrafts.length > 1 ? (
                  <div className='task-form-modal__ai-split'>
                    <p className='task-form-modal__ai-split-warning'>
                      A IA encontrou {splitDrafts.length} tarefas diferentes neste material.
                    </p>
                    <ol className='task-form-modal__ai-split-list'>
                      {splitDrafts.map((draft, index) => (
                        <li
                          key={`${draft.title}-${index}`}
                          className='task-form-modal__ai-split-item'
                        >
                          <span className='task-form-modal__ai-split-item-index'>{index + 1}</span>
                          <div className='task-form-modal__ai-split-item-body'>
                            <strong>{draft.title}</strong>
                            {draft.description ? <span>{draft.description}</span> : null}
                          </div>
                        </li>
                      ))}
                    </ol>
                    <button
                      type='button'
                      className='task-form-modal__ai-split-btn app-button app-button--enter'
                      disabled={busy || !onSaveMany}
                      onClick={() => void handleSplit(requestClose)}
                    >
                      {splitting ? (
                        <Loader2
                          size={14}
                          className='task-form-modal__ai-spinner'
                          strokeWidth={2}
                        />
                      ) : (
                        <Split size={14} strokeWidth={2} />
                      )}
                      <span className='app-button__label'>
                        {splitting ? 'Separando...' : `Separar em ${splitDrafts.length} tarefas`}
                      </span>
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <label className='task-form-modal__field'>
              <span>Título</span>
              <input
                ref={titleInputRef}
                value={title}
                disabled={generating || splitting}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <div className='task-form-modal__row'>
              <label className='task-form-modal__field task-form-modal__field--inline'>
                <span>Data e hora</span>
                <input
                  type='datetime-local'
                  value={dueDateInput}
                  disabled={generating || splitting}
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
                  disabled={generating || splitting}
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
                      disabled={generating || splitting}
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
                  disabled={generating || splitting}
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
                disabled={generating || splitting}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <div className='task-form-modal__attachments'>
              <div className='task-form-modal__attachments-header'>
                <span>Imagem/arquivo</span>
                <button
                  type='button'
                  className='task-form-modal__add-attachment app-button app-button--enter'
                  disabled={busy}
                  onClick={() => void handleAddAttachment()}
                >
                  <Paperclip size={14} strokeWidth={2} />
                  <span className='app-button__label'>Adicionar</span>
                </button>
              </div>
              {attachments.length > 0 ? (
                <div className='task-form-modal__attachment-list'>
                  {attachments.map((attachment) => {
                    const previewKind = resolveTaskAttachmentPreviewKind(attachment);

                    return (
                      <div
                        key={attachment.id}
                        className={`task-form-modal__attachment-item${previewKind === 'video' || previewKind === 'audio' ? ' task-form-modal__attachment-item--media' : ''}`}
                      >
                        <TaskAttachmentPreview
                          attachment={attachment}
                          className={
                            previewKind === 'video'
                              ? 'task-form-modal__attachment-video'
                              : previewKind === 'audio'
                                ? 'task-form-modal__attachment-audio'
                                : previewKind === 'image'
                                  ? 'task-form-modal__attachment-thumb'
                                  : 'task-form-modal__attachment-name'
                          }
                          alt={attachment.name}
                        />
                        <button
                          type='button'
                          className='task-form-modal__attachment-remove app-button'
                          aria-label={`Remover ${attachment.name}`}
                          disabled={generating || splitting}
                          onClick={() => handleRemoveAttachment(attachment.id)}
                        >
                          <Trash2 size={12} strokeWidth={2} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
          {error ? (
            <p className='project-dialog__message project-dialog__message--error'>{error}</p>
          ) : null}
          <div className='project-dialog__actions'>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--ghost app-button'
              disabled={busy}
              onClick={requestClose}
            >
              Cancelar
            </button>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--success app-button app-button--enter'
              disabled={generating || splitting}
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
