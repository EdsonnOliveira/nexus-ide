import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { FileIcon, ListTodo, Paperclip, Search, Trash2 } from 'lucide-react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import { AppCheckbox } from '@/components/overlay/AppCheckbox';
import { EmptyState } from '@/components/overlay/EmptyState';
import { ProjectIconMark } from '@/components/sidebar/ProjectIconMark';
import { useMissionStore } from '@/stores/useMissionStore';
import { useProjectStore } from '@/stores/useProjectStore';
import type { ContextCapsule, MissionSourceTaskRef } from '@/types/mission';
import type { ProjectTask } from '@/types/task';
import { classifyTaskStatus } from '@/utils/taskLabels';
import { blobToDataUrl } from '@/utils/terminalClipboardImage';

interface CreateMissionDialogProps {
  sourcePaneId?: string | null;
  initialTitle?: string;
  onClose: () => void;
  onCreated: (missionId: string) => void;
}

interface PendingMissionAttachment {
  id: string;
  name: string;
  sourcePath: string;
}

interface MissionTaskOption {
  key: string;
  projectId: string;
  projectName: string;
  projectLogo?: string | null;
  projectIcon: string;
  projectColor: string;
  task: ProjectTask;
}

interface MissionCreateProjectThumbProps {
  logo?: string | null;
  icon: string;
  color: string;
}

function MissionCreateProjectThumbComponent({ logo, icon, color }: MissionCreateProjectThumbProps) {
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
        className='mission-create-dialog__project-logo'
        onError={handleLogoError}
      />
    );
  }

  return (
    <span className='mission-create-dialog__project-icon' style={{ background: color }}>
      <ProjectIconMark icon={icon} size={12} />
    </span>
  );
}

const MissionCreateProjectThumb = memo(MissionCreateProjectThumbComponent);

function isOpenMissionTask(task: ProjectTask): boolean {
  return classifyTaskStatus(task.status ?? '') !== 'done';
}

function buildTaskCapsuleContent(projectName: string, task: ProjectTask): string {
  const lines = [`Projeto: ${projectName}`, `Task: ${task.title.trim()}`];

  if (task.status?.trim()) {
    lines.push(`Status: ${task.status.trim()}`);
  }

  if (task.local?.priority?.trim()) {
    lines.push(`Prioridade: ${task.local.priority.trim()}`);
  }

  if (task.local?.dueDate?.trim()) {
    lines.push(`Prazo: ${task.local.dueDate.trim()}`);
  }

  if (task.local?.labels && task.local.labels.length > 0) {
    lines.push(`Tags: ${task.local.labels.join(', ')}`);
  }

  if (task.description.trim()) {
    lines.push('', task.description.trim());
  }

  if (task.attachments.length > 0) {
    lines.push('', 'Anexos da task:');
    for (const attachment of task.attachments) {
      lines.push(`- ${attachment.name}${attachment.path ? ` (${attachment.path})` : ''}`);
    }
  }

  return lines.join('\n').trim();
}

function CreateMissionDialogComponent({
  sourcePaneId = null,
  initialTitle = '',
  onClose,
  onCreated,
}: CreateMissionDialogProps) {
  const createMission = useMissionStore((state) => state.createMission);
  const updateMission = useMissionStore((state) => state.updateMission);
  const projects = useProjectStore((state) => state.projects);

  const [title, setTitle] = useState(initialTitle || 'Nova missão');
  const [description, setDescription] = useState('');
  const [objective, setObjective] = useState('');
  const [attachments, setAttachments] = useState<PendingMissionAttachment[]>([]);
  const [selectedTaskKeys, setSelectedTaskKeys] = useState<string[]>([]);
  const [taskProjectFilter, setTaskProjectFilter] = useState('');
  const [taskQuery, setTaskQuery] = useState('');
  const [saving, setSaving] = useState(false);

  const projectFilterOptions = useMemo(
    () =>
      projects
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))
        .map((project) => ({
          value: project.id,
          label: project.name,
          icon: (
            <MissionCreateProjectThumb
              logo={project.logo}
              icon={project.icon}
              color={project.color}
            />
          ),
        })),
    [projects],
  );

  const selectedFilterProject = useMemo(
    () => projects.find((project) => project.id === taskProjectFilter) ?? null,
    [projects, taskProjectFilter],
  );

  const projectFilterLeadingIcon = useMemo(() => {
    if (!selectedFilterProject) {
      return null;
    }

    return (
      <MissionCreateProjectThumb
        logo={selectedFilterProject.logo}
        icon={selectedFilterProject.icon}
        color={selectedFilterProject.color}
      />
    );
  }, [selectedFilterProject]);

  const taskOptions = useMemo<MissionTaskOption[]>(() => {
    const options: MissionTaskOption[] = [];

    for (const project of projects) {
      if (taskProjectFilter && project.id !== taskProjectFilter) {
        continue;
      }

      const tasks = project.tasks ?? [];
      for (const task of tasks) {
        if (!isOpenMissionTask(task)) {
          continue;
        }

        options.push({
          key: `${project.id}:${task.id}`,
          projectId: project.id,
          projectName: project.name,
          projectLogo: project.logo,
          projectIcon: project.icon,
          projectColor: project.color,
          task,
        });
      }
    }

    return options.sort((left, right) => {
      const byProject = left.projectName.localeCompare(right.projectName, 'pt-BR');
      if (byProject !== 0) {
        return byProject;
      }
      return left.task.title.localeCompare(right.task.title, 'pt-BR');
    });
  }, [projects, taskProjectFilter]);

  const allTaskOptions = useMemo<MissionTaskOption[]>(() => {
    const options: MissionTaskOption[] = [];

    for (const project of projects) {
      const tasks = project.tasks ?? [];
      for (const task of tasks) {
        if (!isOpenMissionTask(task)) {
          continue;
        }

        options.push({
          key: `${project.id}:${task.id}`,
          projectId: project.id,
          projectName: project.name,
          projectLogo: project.logo,
          projectIcon: project.icon,
          projectColor: project.color,
          task,
        });
      }
    }

    return options;
  }, [projects]);

  const filteredTaskOptions = useMemo(() => {
    const query = taskQuery.trim().toLowerCase();
    if (!query) {
      return taskOptions;
    }

    return taskOptions.filter((option) => {
      const haystack = [
        option.projectName,
        option.task.title,
        option.task.description,
        option.task.status ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [taskOptions, taskQuery]);

  const selectedTaskKeySet = useMemo(() => new Set(selectedTaskKeys), [selectedTaskKeys]);

  const handleToggleTask = useCallback((key: string, checked: boolean) => {
    setSelectedTaskKeys((current) => {
      if (checked) {
        if (current.includes(key)) {
          return current;
        }
        return [...current, key];
      }
      return current.filter((entry) => entry !== key);
    });
  }, []);

  const handleAddAttachments = useCallback(async () => {
    if (!window.nexus?.dialog?.openFiles) {
      return;
    }

    const paths = await window.nexus.dialog.openFiles();
    if (!paths || paths.length === 0) {
      return;
    }

    setAttachments((current) => {
      const existing = new Set(current.map((item) => item.sourcePath));
      const next = [...current];

      for (const sourcePath of paths) {
        if (existing.has(sourcePath)) {
          continue;
        }

        const name = sourcePath.split(/[/\\]/).pop() || sourcePath;
        next.push({
          id: crypto.randomUUID(),
          name,
          sourcePath,
        });
      }

      return next;
    });
  }, []);

  const handleRemoveAttachment = useCallback((attachmentId: string) => {
    setAttachments((current) => current.filter((item) => item.id !== attachmentId));
  }, []);

  const handlePasteImages = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = event.clipboardData?.items;
      if (!items || !window.nexus?.missions?.savePendingAttachmentFromDataUrl) {
        return;
      }

      const imageFiles: File[] = [];
      for (const item of items) {
        if (!item.type.startsWith('image/')) {
          continue;
        }

        const file = item.getAsFile();
        if (file) {
          imageFiles.push(file);
        }
      }

      if (imageFiles.length === 0) {
        return;
      }

      event.preventDefault();

      void (async () => {
        const next: PendingMissionAttachment[] = [];

        for (const file of imageFiles) {
          try {
            const dataUrl = await blobToDataUrl(file);
            const saved = await window.nexus.missions.savePendingAttachmentFromDataUrl(
              dataUrl,
              file.name || undefined,
            );
            if (saved) {
              next.push(saved);
            }
          } catch {
            continue;
          }
        }

        if (next.length === 0) {
          return;
        }

        setAttachments((current) => {
          const existing = new Set(current.map((item) => item.sourcePath));
          return [...current, ...next.filter((item) => !existing.has(item.sourcePath))];
        });
      })();
    },
    [],
  );

  const handleSubmit = useCallback(async () => {
    if (!objective.trim() || saving) {
      return;
    }

    setSaving(true);

    try {
      const selectedOptions = allTaskOptions.filter((option) =>
        selectedTaskKeySet.has(option.key),
      );
      const sourceTasks: MissionSourceTaskRef[] = selectedOptions.map((option) => ({
        projectId: option.projectId,
        projectName: option.projectName,
        taskId: option.task.id,
        title: option.task.title,
      }));

      const mission = await createMission({
        title: title.trim() || 'Nova missão',
        description: description.trim() || undefined,
        objective: objective.trim() || undefined,
        sourcePaneId,
        nodes: [],
        edges: [],
        sourceTasks,
        defaultProjectId: taskProjectFilter || null,
      });

      if (!mission) {
        return;
      }

      if (selectedOptions.length > 0) {
        const capsules: ContextCapsule[] = selectedOptions.map((option) => ({
          id: crypto.randomUUID(),
          missionId: mission.id,
          title: `Task · ${option.task.title}`,
          content: buildTaskCapsuleContent(option.projectName, option.task),
          createdAt: new Date().toISOString(),
          tags: ['task', option.projectName],
        }));

        await updateMission(mission.id, {
          sourceTasks,
          capsules,
        });
      }

      if (attachments.length > 0 && window.nexus?.missions?.saveAttachment) {
        const saved = [];

        for (const pending of attachments) {
          const attachment = await window.nexus.missions.saveAttachment(
            mission.id,
            pending.sourcePath,
          );
          if (attachment) {
            saved.push(attachment);
          }
        }

        if (saved.length > 0) {
          await updateMission(mission.id, { attachments: saved });
        }
      }

      onCreated(mission.id);
    } finally {
      setSaving(false);
    }
  }, [
    attachments,
    createMission,
    description,
    objective,
    onCreated,
    saving,
    selectedTaskKeySet,
    sourcePaneId,
    allTaskOptions,
    taskProjectFilter,
    title,
    updateMission,
  ]);

  return (
    <AnimatedModal panelClassName='project-dialog mission-create-dialog' onClose={onClose}>
      {(requestClose) => (
        <>
          <h2 className='project-dialog__title'>Criar missão</h2>
          <p className='project-dialog__message'>
            Defina o objetivo. Os agents e papéis você monta no Agent Graph.
          </p>

          <label className='project-dialog__label' htmlFor='mission-title'>
            Título
          </label>
          <input
            id='mission-title'
            className='project-dialog__input mission-create-dialog__field'
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />

          <label className='project-dialog__label' htmlFor='mission-description'>
            Descrição
          </label>
          <textarea
            id='mission-description'
            className='project-dialog__input mission-create-dialog__field mission-create-dialog__textarea'
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            onPaste={handlePasteImages}
            rows={3}
          />

          <label className='project-dialog__label' htmlFor='mission-objective'>
            Objetivo
          </label>
          <textarea
            id='mission-objective'
            className='project-dialog__input mission-create-dialog__field mission-create-dialog__textarea'
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            onPaste={handlePasteImages}
            rows={3}
            placeholder='O que a missão precisa entregar...'
          />

          <div className='mission-create-dialog__tasks'>
            <div className='mission-create-dialog__tasks-header'>
              <span className='project-dialog__label'>Tasks de contexto</span>
              {selectedTaskKeys.length > 0 ? (
                <span className='mission-create-dialog__tasks-count'>
                  {selectedTaskKeys.length} selecionada
                  {selectedTaskKeys.length === 1 ? '' : 's'}
                </span>
              ) : null}
            </div>
            <div className='mission-create-dialog__tasks-filters'>
              <AnchoredSelect
                value={taskProjectFilter}
                options={projectFilterOptions}
                onChange={setTaskProjectFilter}
                allowEmpty
                emptyLabel='Todas'
                placeholder='Todas'
                leadingIcon={projectFilterLeadingIcon}
                triggerClassName='mission-create-dialog__project-filter'
              />
              <div className='mission-create-dialog__tasks-search'>
                <Search size={14} strokeWidth={2} aria-hidden='true' />
                <input
                  className='mission-create-dialog__tasks-search-input'
                  value={taskQuery}
                  onChange={(event) => setTaskQuery(event.target.value)}
                  placeholder='Buscar tasks...'
                  aria-label='Buscar tasks'
                />
              </div>
            </div>
            {allTaskOptions.length === 0 ? (
              <EmptyState
                icon={ListTodo}
                message='Nenhuma task nos projetos'
                compact
              />
            ) : filteredTaskOptions.length === 0 ? (
              <EmptyState
                icon={Search}
                message={
                  taskProjectFilter
                    ? 'Nenhuma task neste projeto'
                    : 'Nenhuma task encontrada'
                }
                compact
              />
            ) : (
              <div className='mission-create-dialog__tasks-list' role='listbox' aria-multiselectable>
                {filteredTaskOptions.map((option) => {
                  const checked = selectedTaskKeySet.has(option.key);
                  return (
                    <div
                      key={option.key}
                      className={`mission-create-dialog__task-item app-button${
                        checked ? ' mission-create-dialog__task-item--active' : ''
                      }`}
                      role='option'
                      aria-selected={checked}
                      tabIndex={0}
                      onClick={() => handleToggleTask(option.key, !checked)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          handleToggleTask(option.key, !checked);
                        }
                      }}
                    >
                      <span
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                      >
                        <AppCheckbox
                          checked={checked}
                          aria-label={`Selecionar ${option.task.title}`}
                          onChange={(next) => handleToggleTask(option.key, next)}
                        />
                      </span>
                      <span className='mission-create-dialog__task-icon' aria-hidden='true'>
                        <MissionCreateProjectThumb
                          logo={option.projectLogo}
                          icon={option.projectIcon}
                          color={option.projectColor}
                        />
                      </span>
                      <span className='mission-create-dialog__task-copy'>
                        <span className='mission-create-dialog__task-title'>
                          {option.task.title || 'Sem título'}
                        </span>
                        <span className='mission-create-dialog__task-meta'>
                          {option.projectName}
                          {option.task.status ? ` · ${option.task.status}` : ''}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className='mission-create-dialog__attachments'>
            <div className='mission-create-dialog__attachments-header'>
              <span className='project-dialog__label'>Anexos</span>
              <button
                type='button'
                className='mission-create-dialog__add-attachment app-button app-button--enter'
                disabled={saving}
                onClick={() => {
                  void handleAddAttachments();
                }}
              >
                <Paperclip size={14} strokeWidth={2} aria-hidden='true' />
                <span className='app-button__label'>Adicionar</span>
              </button>
            </div>
            {attachments.length > 0 ? (
              <ul className='mission-create-dialog__attachment-list'>
                {attachments.map((attachment) => (
                  <li key={attachment.id} className='mission-create-dialog__attachment-item'>
                    <FileIcon size={14} strokeWidth={2} aria-hidden='true' />
                    <span className='mission-create-dialog__attachment-name' title={attachment.name}>
                      {attachment.name}
                    </span>
                    <button
                      type='button'
                      className='mission-create-dialog__attachment-remove app-button'
                      aria-label={`Remover ${attachment.name}`}
                      disabled={saving}
                      onClick={() => handleRemoveAttachment(attachment.id)}
                    >
                      <Trash2 size={12} strokeWidth={2} aria-hidden='true' />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className='mission-create-dialog__attachments-hint'>
                Qualquer arquivo — imagem, áudio, PDF, zip... Ou cole com ⌘V na descrição/objetivo.
              </p>
            )}
          </div>

          <div className='project-dialog__actions'>
            <button
              type='button'
              className='project-dialog__btn app-button'
              onClick={requestClose}
            >
              Cancelar
            </button>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--primary app-button'
              disabled={!objective.trim() || saving}
              onClick={() => {
                void handleSubmit();
              }}
            >
              {saving ? 'Criando...' : 'Criar missão'}
            </button>
          </div>
        </>
      )}
    </AnimatedModal>
  );
}

export const CreateMissionDialog = memo(CreateMissionDialogComponent);
