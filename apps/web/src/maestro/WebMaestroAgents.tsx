import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Bot, FolderKanban, Smartphone, X } from 'lucide-react';
import type { WebAgentSession } from '../store';
import { WebAgentChat } from './WebAgentChat';
import type { WebAgentMode } from './WebAgentPlusMenu';
import { WebAgentShellTerminals } from './WebAgentShellTerminals';
import type { WebFileAttachmentPayload } from './webAgentPromptImages';

interface WebMaestroAgentsProps {
  agents: WebAgentSession[];
  selectedProjectId: string | null;
  deviceId: string | null;
  focusedAgentId?: string | null;
  emulatorProjectIds?: Set<string>;
  onOpenEmulator?: (projectId: string) => void;
  onSelectProject: (projectId: string) => void;
  onBackToProjects: () => void;
  onFocusedAgentHandled?: () => void;
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
          Fechar agent?
        </span>
        <p className='project-dialog__message'>
          Tem certeza que deseja fechar o agent de <strong>{projectName}</strong>?
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
            Fechar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function AgentCard({
  agent,
  deviceId,
  highlighted,
  onRemove,
  onFollowUp,
  onStop,
  onModelChange,
  onModeChange,
}: {
  agent: WebAgentSession;
  deviceId: string | null;
  highlighted: boolean;
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

  return (
    <article
      data-agent-id={agent.id}
      className={`home-dashboard__agent-card home-dashboard__agent-card--spawn${
        highlighted ? ' home-dashboard__agent-card--focused' : ''
      }`}
    >
      <div className='home-dashboard__agent-card-float'>
        <WebAgentShellTerminals agent={agent} deviceId={deviceId} />
        <button
          type='button'
          className='home-dashboard__agent-card-close app-button app-button--enter'
          aria-label='Fechar agent'
          onClick={() => setConfirmOpen(true)}
        >
          <X size={14} strokeWidth={2.25} aria-hidden='true' />
        </button>
      </div>
      <div className='home-dashboard__agent-card-body'>
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
          }}
        />
      ) : null}
    </article>
  );
}

function AgentProjectRow({
  group,
  enterIndex,
  hasEmulator,
  onSelect,
  onOpenEmulator,
}: {
  group: AgentProjectGroup;
  enterIndex: number;
  hasEmulator: boolean;
  onSelect: (projectId: string) => void;
  onOpenEmulator?: (projectId: string) => void;
}) {
  const handleClick = useCallback(() => {
    onSelect(group.projectId);
  }, [group.projectId, onSelect]);

  const handleOpenEmulator = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onOpenEmulator?.(group.projectId);
    },
    [group.projectId, onOpenEmulator],
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
        {!hasEmulator && showRunningBadge ? (
          <span
            className='home-dashboard__agent-project-badge home-dashboard__agent-project-badge--running'
            aria-label={`${group.agents.length} agents`}
          >
            {formatBadgeCount(group.agents.length)}
          </span>
        ) : null}
        {!hasEmulator && showErrorBadge ? (
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
  selectedProjectId,
  deviceId,
  focusedAgentId = null,
  emulatorProjectIds,
  onOpenEmulator,
  onSelectProject,
  onBackToProjects,
  onFocusedAgentHandled,
  onRemove,
  onFollowUp,
  onStop,
  onModelChange,
  onModeChange,
  onScrollChange,
}: WebMaestroAgentsProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

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
  }, [agents.length, selectedProjectId, onScrollChange]);

  useEffect(() => {
    if (!focusedAgentId || showingProjects) {
      return;
    }

    const section = sectionRef.current;
    if (!section) {
      return;
    }

    const card = section.querySelector<HTMLElement>(
      `[data-agent-id="${CSS.escape(focusedAgentId)}"]`,
    );
    if (!card) {
      return;
    }

    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setHighlightId(focusedAgentId);
    onFocusedAgentHandled?.();

    const timeoutId = window.setTimeout(() => {
      setHighlightId((current) => (current === focusedAgentId ? null : current));
    }, 1600);

    return () => window.clearTimeout(timeoutId);
  }, [focusedAgentId, onFocusedAgentHandled, projectAgents, showingProjects]);

  useEffect(() => {
    if (showingProjects) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onBackToProjects();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onBackToProjects, showingProjects]);

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
                onSelect={onSelectProject}
                onOpenEmulator={onOpenEmulator}
              />
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <section ref={sectionRef} className='home-dashboard__agent-mode app-button--enter'>
      <div className='home-dashboard__agent-project-header app-button--enter'>
        <button
          type='button'
          className='home-dashboard__agent-project-back app-button app-button--enter'
          aria-label='Voltar para projetos'
          onClick={onBackToProjects}
        >
          <ArrowLeft size={16} strokeWidth={2.25} aria-hidden='true' />
        </button>
        {selectedGroup ? (
          <>
            <span className='home-dashboard__agent-project-icon-wrap'>
              <ProjectThumb
                logoUrl={selectedGroup.logoUrl}
                color={selectedGroup.color}
                name={selectedGroup.name}
              />
            </span>
            <span className='home-dashboard__agent-project-header-name'>
              {selectedGroup.name}
            </span>
          </>
        ) : (
          <span className='home-dashboard__agent-project-header-name'>Agents</span>
        )}
      </div>
      {projectAgents.length === 0 ? (
        <div className='empty-state home-dashboard__agent-mode-empty'>
          <div className='empty-state__icon'>
            <Bot size={28} aria-hidden='true' />
          </div>
          <strong className='empty-state__title'>Nenhum agent neste projeto</strong>
          <p className='empty-state__message'>
            Pergunte algo ao Nexus para criar um agent aqui.
          </p>
        </div>
      ) : (
        <div className='home-dashboard__agent-grid'>
          {projectAgents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              deviceId={deviceId}
              highlighted={highlightId === agent.id}
              onRemove={onRemove}
              onFollowUp={onFollowUp}
              onStop={onStop}
              onModelChange={onModelChange}
              onModeChange={onModeChange}
            />
          ))}
        </div>
      )}
    </section>
  );
}
