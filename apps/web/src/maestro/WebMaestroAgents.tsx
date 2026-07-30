import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Bot, FolderKanban, ListTodo, Monitor, Play, Smartphone, Trash2 } from 'lucide-react';
import type { CloudProject } from '@nexus/protocol';
import type { WebAgentSession } from '../store';
import { WebAgentChat } from './WebAgentChat';
import type { WebAgentMode } from './WebAgentPlusMenu';
import { WebAgentShellTerminals } from './WebAgentShellTerminals';
import type { WebFileAttachmentPayload } from './webAgentPromptImages';
import { WebTaskDetailModal } from './WebTaskDetailModal';
import {
  buildWebTaskPrompt,
  formatWebTaskSource,
  getWebTaskTagBorderColor,
  resolveCloudProjectTasks,
  resolveCloudTaskIntegration,
  type WebProjectTask,
} from './webProjectTasks';

interface WebMaestroAgentsProps {
  agents: WebAgentSession[];
  projects: CloudProject[];
  selectedProjectId: string | null;
  deviceId: string | null;
  focusedAgentId?: string | null;
  openAgentId?: string | null;
  emulatorProjectIds?: Set<string>;
  previewProjectIds?: Set<string>;
  headerMacSelect?: ReactNode;
  onOpenEmulator?: (projectId: string) => void;
  onOpenPreview?: (projectId: string) => void;
  onSelectProject: (projectId: string) => void;
  onBackToProjects: () => void;
  onBackFromAgent?: () => void;
  onFocusedAgentHandled?: () => void;
  onOpenAgentChange?: (agentId: string | null) => void;
  onRemove: (id: string) => void;
  onFollowUp: (
    agentId: string,
    prompt: string,
    imageDataUrls?: string[],
    fileAttachments?: WebFileAttachmentPayload[],
  ) => boolean | Promise<boolean>;
  onStop: (agentId: string) => void;
  onModelChange: (agentId: string, modelId: string) => void;
  onModeChange: (agentId: string, modeId: WebAgentMode) => void;
  onExecuteTask?: (task: WebProjectTask) => void | Promise<void>;
  onScrollChange?: (scrolled: boolean) => void;
}

interface AgentProjectGroup {
  projectId: string;
  name: string;
  color: string;
  logoUrl: string | null;
  agents: WebAgentSession[];
  runningCount: number;
  errorCount: number;
}

function formatBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

function resolveAgentTitle(agent: WebAgentSession): string {
  const latestPrompt = agent.turns[agent.turns.length - 1]?.prompt?.trim();
  const prompt = latestPrompt || agent.prompt.trim();
  return prompt || 'Agent';
}

function resolveAgentStatusLabel(status: WebAgentSession['status']): string {
  if (status === 'running') {
    return 'Rodando';
  }
  if (status === 'error') {
    return 'Erro';
  }
  return 'Parado';
}

function groupAgentsByProject(agents: WebAgentSession[]): AgentProjectGroup[] {
  const groups = new Map<string, AgentProjectGroup>();

  for (const agent of agents) {
    if (!agent.projectId) {
      continue;
    }

    let group = groups.get(agent.projectId);
    if (!group) {
      group = {
        projectId: agent.projectId,
        name: agent.projectName,
        color: agent.projectColor || '#8b5cf6',
        logoUrl: agent.logoUrl,
        agents: [],
        runningCount: 0,
        errorCount: 0,
      };
      groups.set(agent.projectId, group);
    }

    group.agents.push(agent);
    if (agent.status === 'running') {
      group.runningCount += 1;
    }
    if (agent.status === 'error') {
      group.errorCount += 1;
    }
  }

  return Array.from(groups.values()).sort((left, right) =>
    left.name.localeCompare(right.name, 'pt-BR', { sensitivity: 'base' }),
  );
}

function ProjectThumb({
  logoUrl,
  color,
  name,
}: {
  logoUrl: string | null;
  color: string;
  name: string;
}) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=''
        className='home-dashboard__agent-project-logo'
        draggable={false}
      />
    );
  }

  const letter = name.trim().slice(0, 1).toUpperCase();

  return (
    <span className='home-dashboard__agent-project-icon' style={{ backgroundColor: color }}>
      {letter || <Bot size={14} aria-hidden='true' />}
    </span>
  );
}

function AgentCloseConfirm({
  projectName,
  onConfirm,
  onClose,
}: {
  projectName: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className='web-modal web-modal--viewport' role='presentation' onClick={onClose}>
      <div
        className='web-modal__card project-dialog app-button--enter'
        role='dialog'
        aria-modal='true'
        aria-labelledby='web-agent-close-title'
        onClick={(event) => event.stopPropagation()}
      >
        <span id='web-agent-close-title' className='project-dialog__title'>
          Excluir agent?
        </span>
        <p className='project-dialog__message'>
          Tem certeza que deseja excluir o agent de <strong>{projectName}</strong>?
        </p>
        <div className='project-dialog__actions'>
          <button
            type='button'
            className='project-dialog__btn project-dialog__btn--ghost app-button'
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type='button'
            className='project-dialog__btn project-dialog__btn--danger app-button app-button--enter'
            onClick={onConfirm}
          >
            Excluir
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function AgentListRow({
  agent,
  enterIndex,
  onOpen,
}: {
  agent: WebAgentSession;
  enterIndex: number;
  onOpen: (agentId: string) => void;
}) {
  const title = resolveAgentTitle(agent);
  const running = agent.status === 'running';
  const statusLabel = resolveAgentStatusLabel(agent.status);

  return (
    <button
      type='button'
      data-agent-id={agent.id}
      className='home-dashboard__agent-list-row app-button app-button--enter'
      style={{ ['--enter-index' as string]: enterIndex }}
      aria-label={`${title}. ${statusLabel}`}
      onClick={() => onOpen(agent.id)}
    >
      <span className='home-dashboard__agent-list-row-main'>
        <span className='home-dashboard__agent-list-row-title'>{title}</span>
      </span>
      <span
        className={`home-dashboard__agent-list-row-status home-dashboard__agent-list-row-status--${agent.status}`}
      >
        <span
          className={`home-dashboard__agent-list-row-dot${
            running ? ' home-dashboard__agent-list-row-dot--running' : ''
          }`}
          aria-hidden='true'
        />
        {statusLabel}
      </span>
    </button>
  );
}

function ProjectTaskItem({
  task,
  enterIndex,
  onOpen,
  onExecute,
}: {
  task: WebProjectTask;
  enterIndex: number;
  onOpen: (task: WebProjectTask) => void;
  onExecute?: (task: WebProjectTask) => void | Promise<void>;
}) {
  const handlePlay = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      void onExecute?.(task);
    },
    [onExecute, task],
  );

  const handleOpen = useCallback(() => {
    onOpen(task);
  }, [onOpen, task]);

  const visibleLabels = task.labels.slice(0, 6);
  const sourceLabel = formatWebTaskSource(task.source);

  return (
    <article
      className='home-dashboard__project-task app-button--enter'
      style={{ ['--enter-index' as string]: enterIndex }}
      role='button'
      tabIndex={0}
      aria-label={task.title}
      onClick={handleOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleOpen();
        }
      }}
    >
      <div className='home-dashboard__project-task-body'>
        <div className='home-dashboard__project-task-top'>
          <span className='home-dashboard__project-task-title' title={task.title}>
            {task.title}
          </span>
          {onExecute ? (
            <button
              type='button'
              className='home-dashboard__project-task-play app-button app-button--enter'
              aria-label={`Executar ${task.title}`}
              onClick={handlePlay}
            >
              <Play size={13} strokeWidth={2.25} aria-hidden='true' />
            </button>
          ) : null}
        </div>
        {visibleLabels.length > 0 ? (
          <div className='home-dashboard__project-task-tags'>
            {visibleLabels.map((label) => (
              <span
                key={label}
                className='home-dashboard__project-task-tag'
                style={{ borderColor: getWebTaskTagBorderColor(label) }}
              >
                {label}
              </span>
            ))}
          </div>
        ) : null}
        <div className='home-dashboard__project-task-footer'>
          <div className='home-dashboard__project-task-meta'>
            <span className='home-dashboard__project-task-key'>
              {task.externalId ?? sourceLabel}
            </span>
            {task.priority ? (
              <span
                className='home-dashboard__project-task-priority'
                title={task.priority}
                aria-label={`Prioridade ${task.priority}`}
              />
            ) : null}
          </div>
          {task.assigneeAvatarUrl ? (
            <img
              className='home-dashboard__project-task-avatar'
              src={task.assigneeAvatarUrl}
              alt={task.assignee ?? 'Responsável'}
              draggable={false}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ProjectTasksRail({
  tasks,
  onOpen,
  onExecute,
}: {
  tasks: WebProjectTask[];
  onOpen: (task: WebProjectTask) => void;
  onExecute?: (task: WebProjectTask) => void | Promise<void>;
}) {
  if (tasks.length === 0) {
    return (
      <div className='empty-state home-dashboard__project-section-empty' data-compact='true'>
        <div className='empty-state__icon'>
          <ListTodo size={22} aria-hidden='true' />
        </div>
        <p className='empty-state__message'>Nenhuma task neste projeto</p>
      </div>
    );
  }

  return (
    <div className='home-dashboard__project-tasks-rail' role='list'>
      {tasks.map((task, index) => (
        <div key={task.id} role='listitem'>
          <ProjectTaskItem
            task={task}
            enterIndex={index}
            onOpen={onOpen}
            onExecute={onExecute}
          />
        </div>
      ))}
    </div>
  );
}

function AgentFullscreen({
  agent,
  deviceId,
  hasEmulator,
  hasPreview,
  headerMacSelect,
  onOpenEmulator,
  onOpenPreview,
  onBack,
  onRemove,
  onFollowUp,
  onStop,
  onModelChange,
  onModeChange,
}: {
  agent: WebAgentSession;
  deviceId: string | null;
  hasEmulator: boolean;
  hasPreview: boolean;
  headerMacSelect?: ReactNode;
  onOpenEmulator?: (projectId: string) => void;
  onOpenPreview?: (projectId: string) => void;
  onBack: () => void;
  onRemove: (id: string) => void;
  onFollowUp: (
    agentId: string,
    prompt: string,
    imageDataUrls?: string[],
    fileAttachments?: WebFileAttachmentPayload[],
  ) => boolean | Promise<boolean>;
  onStop: (agentId: string) => void;
  onModelChange: (agentId: string, modelId: string) => void;
  onModeChange: (agentId: string, modeId: WebAgentMode) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const title = resolveAgentTitle(agent);
  const statusLabel = resolveAgentStatusLabel(agent.status);
  const running = agent.status === 'running';

  return (
    <div
      className='home-dashboard__agent-fullscreen app-button--enter'
      role='main'
      aria-label={title}
    >
      <div className='home-dashboard__agent-fullscreen-header'>
        <button
          type='button'
          className='home-dashboard__agent-project-back app-button app-button--enter'
          aria-label='Voltar para agents do projeto'
          onClick={onBack}
        >
          <ArrowLeft size={16} strokeWidth={2.25} aria-hidden='true' />
        </button>
        <div className='home-dashboard__agent-fullscreen-heading'>
          <span className='home-dashboard__agent-fullscreen-title' title={title}>
            {title}
          </span>
          <span
            className={`home-dashboard__agent-list-row-status home-dashboard__agent-list-row-status--${agent.status}`}
          >
            <span
              className={`home-dashboard__agent-list-row-dot${
                running ? ' home-dashboard__agent-list-row-dot--running' : ''
              }`}
              aria-hidden='true'
            />
            {statusLabel}
          </span>
        </div>
        <div className='home-dashboard__agent-fullscreen-actions'>
          {headerMacSelect ? (
            <div className='home-dashboard__header-mac'>{headerMacSelect}</div>
          ) : null}
          <WebAgentShellTerminals agent={agent} deviceId={deviceId} />
          {hasEmulator && agent.projectId ? (
            <button
              type='button'
              className='home-dashboard__agent-card-terminal app-button app-button--enter'
              aria-label='Abrir emulador'
              title='Emulador rodando'
              onClick={() => {
                if (agent.projectId) {
                  onOpenEmulator?.(agent.projectId);
                }
              }}
            >
              <Smartphone size={14} strokeWidth={2.25} aria-hidden='true' />
            </button>
          ) : null}
          {hasPreview && agent.projectId ? (
            <button
              type='button'
              className='home-dashboard__agent-card-terminal app-button app-button--enter'
              aria-label='Abrir front web'
              title='Front web rodando'
              onClick={() => {
                if (agent.projectId) {
                  onOpenPreview?.(agent.projectId);
                }
              }}
            >
              <Monitor size={14} strokeWidth={2.25} aria-hidden='true' />
            </button>
          ) : null}
          <button
            type='button'
            className='home-dashboard__agent-card-close app-button app-button--enter'
            aria-label='Excluir agent'
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 size={14} strokeWidth={2.25} aria-hidden='true' />
          </button>
        </div>
      </div>
      <div className='home-dashboard__agent-fullscreen-body'>
        <WebAgentChat
          agent={agent}
          onFollowUp={onFollowUp}
          onStop={onStop}
          onModelChange={onModelChange}
          onModeChange={onModeChange}
        />
      </div>
      {confirmOpen ? (
        <AgentCloseConfirm
          projectName={agent.projectName}
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            onRemove(agent.id);
            onBack();
          }}
        />
      ) : null}
    </div>
  );
}

function AgentProjectRow({
  group,
  enterIndex,
  hasEmulator,
  hasPreview,
  onSelect,
  onOpenEmulator,
  onOpenPreview,
}: {
  group: AgentProjectGroup;
  enterIndex: number;
  hasEmulator: boolean;
  hasPreview: boolean;
  onSelect: (projectId: string) => void;
  onOpenEmulator?: (projectId: string) => void;
  onOpenPreview?: (projectId: string) => void;
}) {
  const handleClick = useCallback(() => {
    onSelect(group.projectId);
  }, [group.projectId, onSelect]);

  const handleOpenEmulator = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onOpenEmulator?.(group.projectId);
    },
    [group.projectId, onOpenEmulator],
  );

  const handleOpenPreview = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onOpenPreview?.(group.projectId);
    },
    [group.projectId, onOpenPreview],
  );

  const showRunningBadge = group.agents.length > 0;
  const showErrorBadge = group.errorCount > 0;

  return (
    <div
      className='home-dashboard__agent-project app-button app-button--enter'
      style={{ ['--enter-index' as string]: enterIndex }}
      title={group.name}
      role='button'
      tabIndex={0}
      aria-label={`Abrir agents de ${group.name}`}
      onClick={handleClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleClick();
        }
      }}
    >
      <span className='home-dashboard__agent-project-icon-wrap'>
        <ProjectThumb logoUrl={group.logoUrl} color={group.color} name={group.name} />
      </span>
      <span className='home-dashboard__agent-project-name'>{group.name}</span>
      <span className='home-dashboard__agent-project-indicators'>
        {showRunningBadge ? (
          <span
            className='home-dashboard__agent-project-badge home-dashboard__agent-project-badge--running'
            aria-label={`${group.agents.length} agents`}
          >
            {formatBadgeCount(group.agents.length)}
          </span>
        ) : null}
        {showErrorBadge ? (
          <span
            className='home-dashboard__agent-project-badge home-dashboard__agent-project-badge--error'
            aria-label={`${group.errorCount} agents com erro`}
          >
            {formatBadgeCount(group.errorCount)}
          </span>
        ) : null}
        {hasEmulator ? (
          <button
            type='button'
            className='web-emulator-project-icon app-button'
            aria-label={`Abrir emulador de ${group.name}`}
            title='Emulador rodando'
            onClick={handleOpenEmulator}
          >
            <Smartphone size={13} aria-hidden='true' />
          </button>
        ) : null}
        {hasPreview ? (
          <button
            type='button'
            className='web-preview-project-icon app-button'
            aria-label={`Abrir front web de ${group.name}`}
            title='Front web rodando'
            onClick={handleOpenPreview}
          >
            <Monitor size={13} aria-hidden='true' />
          </button>
        ) : null}
        {group.runningCount > 0 ? (
          <span
            className='home-dashboard__agent-project-busy'
            aria-label='Agent em execução'
          />
        ) : null}
      </span>
    </div>
  );
}

export function WebMaestroAgents({
  agents,
  projects,
  selectedProjectId,
  deviceId,
  focusedAgentId = null,
  openAgentId: openAgentIdProp = null,
  emulatorProjectIds,
  previewProjectIds,
  headerMacSelect,
  onOpenEmulator,
  onOpenPreview,
  onSelectProject,
  onBackToProjects,
  onBackFromAgent,
  onFocusedAgentHandled,
  onOpenAgentChange,
  onRemove,
  onFollowUp,
  onStop,
  onModelChange,
  onModeChange,
  onExecuteTask,
  onScrollChange,
}: WebMaestroAgentsProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const [openAgentId, setOpenAgentIdState] = useState<string | null>(openAgentIdProp);
  const [detailTask, setDetailTask] = useState<WebProjectTask | null>(null);

  const setOpenAgentId = useCallback(
    (agentId: string | null) => {
      setOpenAgentIdState(agentId);
      onOpenAgentChange?.(agentId);
    },
    [onOpenAgentChange],
  );

  useEffect(() => {
    setOpenAgentIdState(openAgentIdProp);
  }, [openAgentIdProp]);

  const projectGroups = useMemo(() => groupAgentsByProject(agents), [agents]);
  const selectedGroup = useMemo(
    () =>
      selectedProjectId
        ? projectGroups.find((group) => group.projectId === selectedProjectId) ?? null
        : null,
    [projectGroups, selectedProjectId],
  );
  const projectAgents = selectedGroup?.agents ?? [];
  const showingProjects = selectedProjectId === null;
  const selectedCloudProject = useMemo(
    () =>
      selectedProjectId
        ? projects.find((project) => project.id === selectedProjectId) ?? null
        : null,
    [projects, selectedProjectId],
  );
  const projectTasks = useMemo(
    () => resolveCloudProjectTasks(selectedCloudProject),
    [selectedCloudProject],
  );
  const taskIntegration = useMemo(
    () => resolveCloudTaskIntegration(selectedCloudProject),
    [selectedCloudProject],
  );
  const openAgent = useMemo(
    () => (openAgentId ? projectAgents.find((agent) => agent.id === openAgentId) ?? null : null),
    [openAgentId, projectAgents],
  );
  const hasEmulator = Boolean(
    selectedProjectId && emulatorProjectIds?.has(selectedProjectId),
  );
  const hasPreview = Boolean(
    selectedProjectId && previewProjectIds?.has(selectedProjectId),
  );

  const handleOpenAgent = useCallback(
    (agentId: string) => {
      setOpenAgentId(agentId);
    },
    [setOpenAgentId],
  );

  const handleCloseAgent = useCallback(() => {
    if (onBackFromAgent) {
      onBackFromAgent();
      return;
    }
    setOpenAgentId(null);
  }, [onBackFromAgent, setOpenAgentId]);

  const handleBackFromProject = useCallback(() => {
    setDetailTask(null);
    onBackToProjects();
  }, [onBackToProjects]);

  useEffect(() => {
    setDetailTask(null);
  }, [selectedProjectId]);

  useEffect(() => {
    if (showingProjects) {
      setOpenAgentIdState(null);
      onOpenAgentChange?.(null);
    }
  }, [showingProjects, onOpenAgentChange]);

  useEffect(() => {
    if (!openAgentId) {
      return;
    }
    if (!projectAgents.some((agent) => agent.id === openAgentId)) {
      setOpenAgentId(null);
    }
  }, [openAgentId, projectAgents, setOpenAgentId]);

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) {
      onScrollChange?.(false);
      return;
    }

    const syncScroll = () => {
      onScrollChange?.(node.scrollTop > 8);
    };

    syncScroll();
    node.addEventListener('scroll', syncScroll, { passive: true });
    return () => {
      node.removeEventListener('scroll', syncScroll);
    };
  }, [agents.length, selectedProjectId, openAgentId, onScrollChange]);

  useEffect(() => {
    if (!focusedAgentId || showingProjects) {
      return;
    }

    setOpenAgentId(focusedAgentId);
    onFocusedAgentHandled?.();
  }, [focusedAgentId, onFocusedAgentHandled, setOpenAgentId, showingProjects]);

  useEffect(() => {
    if (showingProjects) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      if (openAgentId) {
        handleCloseAgent();
        return;
      }
      onBackToProjects();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleCloseAgent, onBackToProjects, openAgentId, showingProjects]);

  if (agents.length === 0) {
    return (
      <section
        ref={sectionRef}
        className='home-dashboard__agent-mode app-button--enter'
      >
        <div className='empty-state home-dashboard__agent-mode-empty'>
          <div className='empty-state__icon'>
            <Bot size={28} aria-hidden='true' />
          </div>
          <strong className='empty-state__title'>Nenhum agent na área</strong>
          <p className='empty-state__message'>
            Escolha um projeto e pergunte algo ao Nexus para criar um agent aqui.
          </p>
        </div>
      </section>
    );
  }

  if (showingProjects) {
    return (
      <section ref={sectionRef} className='home-dashboard__agent-mode app-button--enter'>
        {projectGroups.length === 0 ? (
          <div className='empty-state home-dashboard__agent-mode-empty'>
            <div className='empty-state__icon'>
              <FolderKanban size={28} aria-hidden='true' />
            </div>
            <strong className='empty-state__title'>Nenhum projeto com agent</strong>
            <p className='empty-state__message'>
              Quando um agent estiver ativo, o projeto aparece aqui.
            </p>
          </div>
        ) : (
          <div className='home-dashboard__agent-project-list' role='list'>
            {projectGroups.map((group, index) => (
              <AgentProjectRow
                key={group.projectId}
                group={group}
                enterIndex={index}
                hasEmulator={Boolean(emulatorProjectIds?.has(group.projectId))}
                hasPreview={Boolean(previewProjectIds?.has(group.projectId))}
                onSelect={onSelectProject}
                onOpenEmulator={onOpenEmulator}
                onOpenPreview={onOpenPreview}
              />
            ))}
          </div>
        )}
      </section>
    );
  }

  if (openAgent) {
    return (
      <section
        ref={sectionRef}
        className='home-dashboard__agent-mode home-dashboard__agent-mode--fullscreen app-button--enter'
      >
        <AgentFullscreen
          agent={openAgent}
          deviceId={deviceId}
          hasEmulator={Boolean(
            openAgent.projectId && emulatorProjectIds?.has(openAgent.projectId),
          )}
          hasPreview={Boolean(
            openAgent.projectId && previewProjectIds?.has(openAgent.projectId),
          )}
          headerMacSelect={headerMacSelect}
          onOpenEmulator={onOpenEmulator}
          onOpenPreview={onOpenPreview}
          onBack={handleCloseAgent}
          onRemove={onRemove}
          onFollowUp={onFollowUp}
          onStop={onStop}
          onModelChange={onModelChange}
          onModeChange={onModeChange}
        />
      </section>
    );
  }

  return (
    <section
      ref={sectionRef}
      className='home-dashboard__agent-mode home-dashboard__agent-mode--project app-button--enter'
    >
      <div className='home-dashboard__agent-project-header app-button--enter'>
        <button
          type='button'
          className='home-dashboard__agent-project-back app-button app-button--enter'
          aria-label='Voltar para projetos'
          onClick={handleBackFromProject}
        >
          <ArrowLeft size={16} strokeWidth={2.25} aria-hidden='true' />
        </button>
        {selectedGroup || selectedCloudProject ? (
          <>
            <span className='home-dashboard__agent-project-icon-wrap'>
              <ProjectThumb
                logoUrl={selectedGroup?.logoUrl ?? selectedCloudProject?.logo_url ?? null}
                color={
                  selectedGroup?.color ?? selectedCloudProject?.color ?? '#8b5cf6'
                }
                name={selectedGroup?.name ?? selectedCloudProject?.name ?? 'Projeto'}
              />
            </span>
            <span className='home-dashboard__agent-project-header-name'>
              {selectedGroup?.name ?? selectedCloudProject?.name ?? 'Projeto'}
            </span>
          </>
        ) : (
          <span className='home-dashboard__agent-project-header-name'>Projeto</span>
        )}
        <div className='home-dashboard__agent-project-header-actions'>
          {headerMacSelect ? (
            <div className='home-dashboard__header-mac'>{headerMacSelect}</div>
          ) : null}
          {hasEmulator && selectedProjectId ? (
            <button
              type='button'
              className='web-emulator-header-btn app-button home-dashboard__agent-project-emulator'
              aria-label='Abrir emulador'
              title='Emulador rodando'
              onClick={() => onOpenEmulator?.(selectedProjectId)}
            >
              <Smartphone size={15} aria-hidden='true' />
            </button>
          ) : null}
          {hasPreview && selectedProjectId ? (
            <button
              type='button'
              className='web-preview-header-btn app-button home-dashboard__agent-project-emulator'
              aria-label='Abrir front web'
              title='Front web rodando'
              onClick={() => onOpenPreview?.(selectedProjectId)}
            >
              <Monitor size={15} aria-hidden='true' />
            </button>
          ) : null}
        </div>
      </div>
      <div className='home-dashboard__project-sections'>
        <section className='home-dashboard__project-section' aria-label='Tasks'>
          <h2 className='home-dashboard__project-section-title'>Tasks</h2>
          <ProjectTasksRail
            tasks={projectTasks}
            onOpen={setDetailTask}
            onExecute={onExecuteTask}
          />
        </section>
        <section className='home-dashboard__project-section' aria-label='Agents'>
          <h2 className='home-dashboard__project-section-title'>Agents</h2>
          {projectAgents.length === 0 ? (
            <div className='empty-state home-dashboard__project-section-empty'>
              <div className='empty-state__icon'>
                <Bot size={22} aria-hidden='true' />
              </div>
              <p className='empty-state__message'>Nenhum agent neste projeto</p>
            </div>
          ) : (
            <div className='home-dashboard__agent-list' role='list'>
              {projectAgents.map((agent, index) => (
                <AgentListRow
                  key={agent.id}
                  agent={agent}
                  enterIndex={index}
                  onOpen={handleOpenAgent}
                />
              ))}
            </div>
          )}
        </section>
      </div>
      {detailTask ? (
        <WebTaskDetailModal
          task={detailTask}
          integration={taskIntegration}
          onClose={() => setDetailTask(null)}
          onExecute={onExecuteTask}
        />
      ) : null}
    </section>
  );
}
