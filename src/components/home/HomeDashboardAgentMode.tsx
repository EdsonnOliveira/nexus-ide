import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Bot, X } from 'lucide-react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { EmptyState } from '@/components/overlay/EmptyState';
import { ProjectIconMark } from '@/components/sidebar/ProjectIconMark';
import { useProjectStore } from '@/stores/useProjectStore';
import { useProjectNotificationStore } from '@/stores/useProjectNotificationStore';
import { useTabActions } from '@/stores/useTabStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import type { AgentTab, Project } from '@/types';
import {
  forgetHomeDashboardProjectAgent,
  HOME_AGENT_CHANGE_EVENT,
  HOME_AGENT_FOCUS_EVENT,
  readHomeAgentQueue,
} from '@/utils/homeDashboardAgents';
import { setHomeAgentOverlayPaneIds } from '@/utils/homeAgentOverlay';
import { findPaneTab } from '@/utils/tabGroups';

export { bindHomeDashboardProjectAgent } from '@/utils/homeDashboardAgents';

const LazyAgentView = lazy(() =>
  import('@/components/agent/AgentView').then((module) => ({
    default: module.AgentView,
  })),
);

interface HomeProjectAgentSlot {
  project: Project;
  pane: AgentTab;
  busy: boolean;
}

function AgentProjectThumbComponent({
  logo,
  icon,
  color,
}: {
  logo?: string | null;
  icon: string;
  color: string;
}) {
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

  if (logoSrc && !logoFailed) {
    return (
      <img
        key={logo}
        src={logoSrc}
        alt=''
        className='home-dashboard__agent-card-logo'
        onError={() => {
          setLogoFailed(true);
          setLogoSrc(null);
        }}
      />
    );
  }

  return (
    <span className='home-dashboard__agent-card-icon' style={{ background: color }}>
      <ProjectIconMark icon={icon} size={14} />
    </span>
  );
}

const AgentProjectThumb = memo(AgentProjectThumbComponent);

interface AgentCardCloseConfirmProps {
  projectName: string;
  onConfirm: () => void;
  onClose: () => void;
}

function AgentCardCloseConfirmComponent({
  projectName,
  onConfirm,
  onClose,
}: AgentCardCloseConfirmProps) {
  const handleConfirm = useCallback(
    (requestClose: () => void) => {
      onConfirm();
      requestClose();
    },
    [onConfirm],
  );

  return (
    <AnimatedModal onClose={onClose} panelClassName='project-dialog'>
      {(requestClose) => (
        <>
          <span className='project-dialog__title'>Fechar agent?</span>
          <p className='project-dialog__message'>
            Tem certeza que deseja fechar o agent de <strong>{projectName}</strong>?
          </p>
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
              className='project-dialog__btn project-dialog__btn--danger app-button app-button--enter'
              onClick={() => handleConfirm(requestClose)}
            >
              Fechar
            </button>
          </div>
        </>
      )}
    </AnimatedModal>
  );
}

const AgentCardCloseConfirm = memo(AgentCardCloseConfirmComponent);

interface AgentCardProps {
  slot: HomeProjectAgentSlot;
  enterDelayMs: number;
  isFocused: boolean;
  isSpawning: boolean;
  onFocus: (paneId: string) => void;
  onRemove: (slot: HomeProjectAgentSlot) => void;
}

function AgentCardComponent({
  slot,
  enterDelayMs,
  isFocused,
  isSpawning,
  onFocus,
  onRemove,
}: AgentCardProps) {
  const paneId = slot.pane.id;
  const setTabPtyId = useProjectStore((state) => state.setTabPtyId);
  const clearNotificationForPane = useProjectNotificationStore(
    (state) => state.clearNotificationForPane,
  );
  const hasReadyPing = useProjectNotificationStore(
    (state) => state.notifiedAgentPaneByProject[slot.project.id] === paneId,
  );
  const { updateAgentTab } = useTabActions();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleFocus = useCallback(() => {
    onFocus(paneId);
    clearNotificationForPane(paneId);
  }, [clearNotificationForPane, onFocus, paneId]);

  const handlePtyCreated = useCallback(
    (ptyId: string) => {
      setTabPtyId(slot.project.id, paneId, ptyId);
    },
    [paneId, setTabPtyId, slot.project.id],
  );

  const handlePtyLost = useCallback(() => {
    setTabPtyId(slot.project.id, paneId, null);
  }, [paneId, setTabPtyId, slot.project.id]);

  const handleUpdateTab = useCallback(
    (patch: Partial<Pick<AgentTab, 'turns' | 'workingDirectory' | 'restoreCommand'>>) => {
      void updateAgentTab(paneId, patch);
    },
    [paneId, updateAgentTab],
  );

  const handleOpenConfirm = useCallback(() => {
    setConfirmOpen(true);
  }, []);

  const handleCloseConfirm = useCallback(() => {
    setConfirmOpen(false);
  }, []);

  const handleConfirmClose = useCallback(() => {
    onRemove(slot);
  }, [onRemove, slot]);

  const stopCardFocusSteal = useCallback((event: ReactMouseEvent | ReactPointerEvent) => {
    event.stopPropagation();
  }, []);

  return (
    <article
      data-home-agent-pane={slot.pane.id}
      className={`home-dashboard__agent-card app-button--enter${isFocused ? ' home-dashboard__agent-card--focused' : ''}${hasReadyPing ? ' home-dashboard__agent-card--ping' : ''}${isSpawning ? ' home-dashboard__agent-card--spawn' : ''}`}
      style={{ animationDelay: `${enterDelayMs}ms` }}
      onMouseDown={handleFocus}
    >
      <div className='home-dashboard__agent-card-head'>
        <span className='home-dashboard__agent-card-thumb-wrap'>
          <AgentProjectThumb
            logo={slot.project.logo}
            icon={slot.project.icon}
            color={slot.project.color}
          />
          {hasReadyPing ? (
            <span
              className='project-item__ping project-item__ping--red home-dashboard__project-ping'
              aria-hidden='true'
            />
          ) : null}
        </span>
        <div className='home-dashboard__agent-card-copy'>
          <span className='home-dashboard__agent-card-project'>{slot.project.name}</span>
        </div>
        <div
          className='home-dashboard__agent-card-aside'
          onClick={stopCardFocusSteal}
          onPointerDown={stopCardFocusSteal}
        >
          <button
            type='button'
            className='home-dashboard__agent-card-close app-button app-button--enter'
            aria-label='Fechar agent'
            onClick={handleOpenConfirm}
          >
            <X size={14} strokeWidth={2.25} aria-hidden='true' />
          </button>
        </div>
      </div>
      <div className='home-dashboard__agent-card-body'>
        <Suspense
          fallback={<div className='home-dashboard__agent-card-loading'>Carregando agent...</div>}
        >
          <LazyAgentView
            tab={slot.pane}
            projectId={slot.project.id}
            projectPath={slot.project.path}
            isVisible
            isRuntimeActive
            isFocused={isFocused}
            disableStickyPrompt
            onFocusPane={handleFocus}
            onPtyCreated={handlePtyCreated}
            onPtyLost={handlePtyLost}
            onUpdateTab={handleUpdateTab}
          />
        </Suspense>
      </div>
      <span
        className={`home-dashboard__agent-card-progress${slot.busy ? ' home-dashboard__agent-card-progress--busy' : ''}`}
        aria-hidden='true'
      />
      {confirmOpen ? (
        <AgentCardCloseConfirm
          projectName={slot.project.name}
          onConfirm={handleConfirmClose}
          onClose={handleCloseConfirm}
        />
      ) : null}
    </article>
  );
}

const AgentCard = memo(AgentCardComponent);

interface HomeDashboardAgentModeProps {
  spawningPaneId?: string | null;
}

function HomeDashboardAgentModeComponent({
  spawningPaneId = null,
}: HomeDashboardAgentModeProps) {
  const projects = useProjectStore((state) => state.projects);
  const agentBusyByPane = useTerminalSessionStore((state) => state.agentBusyByPane);
  const awaitingResponseByPane = useTerminalSessionStore((state) => state.awaitingResponseByPane);
  const { closeTabForProject } = useTabActions();
  const [homeAgentQueue, setHomeAgentQueue] = useState(readHomeAgentQueue);
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => {
      setHomeAgentQueue(readHomeAgentQueue());
    };

    const focusAgent = (event: Event) => {
      const paneId = (event as CustomEvent<{ paneId?: string }>).detail?.paneId;
      if (paneId) {
        setFocusedPaneId(paneId);
      }
    };

    window.addEventListener(HOME_AGENT_CHANGE_EVENT, refresh);
    window.addEventListener(HOME_AGENT_FOCUS_EVENT, focusAgent);
    return () => {
      window.removeEventListener(HOME_AGENT_CHANGE_EVENT, refresh);
      window.removeEventListener(HOME_AGENT_FOCUS_EVENT, focusAgent);
    };
  }, []);

  const slots = useMemo(() => {
    const projectsById = new Map(projects.map((project) => [project.id, project]));
    const next: HomeProjectAgentSlot[] = [];

    for (const binding of homeAgentQueue) {
      const project = projectsById.get(binding.projectId);
      if (!project) {
        continue;
      }

      const pane = findPaneTab(project.tabs, binding.paneId);
      if (!pane || pane.type !== 'agent') {
        continue;
      }

      next.push({
        project,
        pane,
        busy: Boolean(agentBusyByPane[pane.id] || awaitingResponseByPane[pane.id]),
      });
    }

    return next;
  }, [agentBusyByPane, awaitingResponseByPane, homeAgentQueue, projects]);

  useLayoutEffect(() => {
    setHomeAgentOverlayPaneIds(slots.map((slot) => slot.pane.id));
    return () => {
      setHomeAgentOverlayPaneIds([]);
    };
  }, [slots]);

  useEffect(() => {
    if (slots.length === 0) {
      setFocusedPaneId(null);
      return;
    }

    if (!focusedPaneId || !slots.some((slot) => slot.pane.id === focusedPaneId)) {
      setFocusedPaneId(slots[slots.length - 1]!.pane.id);
    }
  }, [focusedPaneId, slots]);

  const handleFocus = useCallback((paneId: string) => {
    setFocusedPaneId(paneId);
  }, []);

  const handleRemove = useCallback(
    (slot: HomeProjectAgentSlot) => {
      forgetHomeDashboardProjectAgent(slot.project.id, slot.pane.id);
      void closeTabForProject(slot.project.id, slot.pane.id);
    },
    [closeTabForProject],
  );

  return (
    <section className='home-dashboard__agent-mode app-button--enter'>
      {slots.length === 0 ? (
        <EmptyState
          icon={Bot}
          title='Nenhum agent na área'
          message='Escolha um projeto e pergunte algo ao Nexus para criar um agent aqui.'
          className='home-dashboard__agent-mode-empty'
        />
      ) : (
        <div className='home-dashboard__agent-grid'>
          {slots.map((slot, index) => (
            <AgentCard
              key={`${slot.project.id}-${slot.pane.id}`}
              slot={slot}
              enterDelayMs={spawningPaneId === slot.pane.id ? 0 : 40 + index * 35}
              isFocused={focusedPaneId === slot.pane.id}
              isSpawning={spawningPaneId === slot.pane.id}
              onFocus={handleFocus}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export const HomeDashboardAgentMode = memo(HomeDashboardAgentModeComponent);
