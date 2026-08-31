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
import { Bot, Maximize2, Minimize2, Pin, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { AgentShellTerminalDock } from '@/components/agent/AgentShellTerminalDock';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { EmptyState } from '@/components/overlay/EmptyState';
import {
  AgentCardFrame,
  useAgentCardFullscreen,
} from '@/components/home/AgentCardFullscreenOverlay';
import { HomeDashboardCloudAgentCard } from '@/components/home/HomeDashboardCloudAgentCard';
import { MissionCard } from '@/components/mission/MissionCard';
import { ProjectIconMark } from '@/components/sidebar/ProjectIconMark';
import { useAgentPipSync } from '@/hooks/useAgentPipSync';
import { useHomeSurfaceProjects } from '@/hooks/useHomeDashboardData';
import { useMissionHydration } from '@/hooks/useMissionHydration';
import { useAgentPipStore } from '@/stores/useAgentPipStore';
import { useMissionStore } from '@/stores/useMissionStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useCloudAgentSessionsStore } from '@/stores/useCloudAgentSessionsStore';
import { useProjectNotificationStore } from '@/stores/useProjectNotificationStore';
import { useTabActions } from '@/stores/useTabStore';
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
  return (
    <AnimatedModal panelClassName='project-dialog' onClose={onClose}>
      {(requestClose) => (
        <>
          <h2 className='project-dialog__title'>Fechar agent</h2>
          <p className='project-dialog__message'>
            Remover o agent de <strong>{projectName}</strong> da área do Maestro?
          </p>
          <div className='project-dialog__actions'>
            <button type='button' className='project-dialog__btn app-button' onClick={requestClose}>
              Cancelar
            </button>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--danger app-button'
              onClick={onConfirm}
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
  project: Project;
  pane: AgentTab;
  enterDelayMs: number;
  isFocused: boolean;
  isSpawning: boolean;
  isMultiSelected: boolean;
  onFocus: (paneId: string, additive: boolean) => void;
  onRemove: (project: Project, pane: AgentTab) => void;
}

function AgentCardComponent({
  project,
  pane,
  enterDelayMs,
  isFocused,
  isSpawning,
  isMultiSelected,
  onFocus,
  onRemove,
}: AgentCardProps) {
  const paneId = pane.id;
  const setTabPtyId = useProjectStore((state) => state.setTabPtyId);
  const clearNotificationForPane = useProjectNotificationStore(
    (state) => state.clearNotificationForPane,
  );
  const hasReadyPing = useProjectNotificationStore(
    (state) => state.notifiedAgentPaneByProject[project.id] === paneId,
  );
  const missionForPane = useMissionStore((state) =>
    state.missions.find(
      (mission) =>
        mission.sourcePaneId === paneId ||
        mission.nodes.some((node) => node.paneId === paneId),
    ),
  );
  const { updateAgentTab } = useTabActions();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fullscreen = useAgentCardFullscreen();
  const pinnedPaneId = useAgentPipStore((state) => state.paneId);
  const pinAgent = useAgentPipStore((state) => state.pin);
  const unpinAgent = useAgentPipStore((state) => state.unpin);
  const isPinned = pinnedPaneId === paneId;

  const handleFocus = useCallback(
    (event?: ReactMouseEvent) => {
      const additive = Boolean(event && (event.metaKey || event.ctrlKey));
      onFocus(paneId, additive);
      clearNotificationForPane(paneId);
    },
    [clearNotificationForPane, onFocus, paneId],
  );

  const handlePtyCreated = useCallback(
    (ptyId: string) => {
      setTabPtyId(project.id, paneId, ptyId);
    },
    [paneId, setTabPtyId, project.id],
  );

  const handlePtyLost = useCallback(() => {
    setTabPtyId(project.id, paneId, null);
  }, [paneId, setTabPtyId, project.id]);

  const handleUpdateTab = useCallback(
    (
      patch: Partial<Pick<AgentTab, 'turns' | 'followUps' | 'workingDirectory' | 'restoreCommand'>>,
    ) => {
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
    onRemove(project, pane);
  }, [onRemove, pane, project]);

  const stopCardFocusSteal = useCallback((event: ReactMouseEvent | ReactPointerEvent) => {
    event.stopPropagation();
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    if (fullscreen.open) {
      fullscreen.closeFullscreen();
      return;
    }

    handleFocus();
    fullscreen.openFullscreen();
  }, [fullscreen.closeFullscreen, fullscreen.open, fullscreen.openFullscreen, handleFocus]);

  const handleTogglePin = useCallback(() => {
    if (isPinned) {
      unpinAgent();
      return;
    }

    pinAgent(paneId);
  }, [isPinned, paneId, pinAgent, unpinAgent]);

  if (missionForPane && missionForPane.nodes.some((node) => node.paneId === paneId)) {
    return null;
  }

  return (
    <>
      <AgentCardFrame
        className={`home-dashboard__agent-card app-button--enter${isFocused ? ' home-dashboard__agent-card--focused' : ''}${hasReadyPing ? ' home-dashboard__agent-card--ping' : ''}${isSpawning ? ' home-dashboard__agent-card--spawn' : ''}${isMultiSelected ? ' home-dashboard__agent-card--multi' : ''}`}
        style={{ animationDelay: `${enterDelayMs}ms` }}
        fullscreen={fullscreen}
        dataHomeAgentPane={pane.id}
        onMouseDown={(event) => handleFocus(event)}
      >
        <div className='home-dashboard__agent-card-head'>
          <span className='home-dashboard__agent-card-thumb-wrap'>
            <AgentProjectThumb logo={project.logo} icon={project.icon} color={project.color} />
            {hasReadyPing ? (
              <span
                className='project-item__ping project-item__ping--red home-dashboard__project-ping'
                aria-hidden='true'
              />
            ) : null}
          </span>
          <div className='home-dashboard__agent-card-copy'>
            <span className='home-dashboard__agent-card-project'>{project.name}</span>
          </div>
          <div
            className='home-dashboard__agent-card-aside'
            onClick={stopCardFocusSteal}
            onPointerDown={stopCardFocusSteal}
            onMouseDown={stopCardFocusSteal}
          >
            <AgentShellTerminalDock
              agentPaneId={pane.id}
              projectPath={project.path}
              variant='header'
            />
            <button
              type='button'
              className={`home-dashboard__agent-card-terminal app-button app-button--enter${isPinned ? ' home-dashboard__agent-card-terminal--pinned' : ''}`}
              aria-label={isPinned ? 'Desafixar agent' : 'Fixar agent'}
              aria-pressed={isPinned}
              title={isPinned ? 'Desafixar' : 'Fixar'}
              onClick={handleTogglePin}
            >
              <Pin
                size={14}
                strokeWidth={2.25}
                fill={isPinned ? 'currentColor' : 'none'}
                aria-hidden='true'
              />
            </button>
            <button
              type='button'
              className='home-dashboard__agent-card-terminal app-button app-button--enter'
              aria-label={fullscreen.open ? 'Sair da tela cheia' : 'Tela cheia'}
              aria-pressed={fullscreen.open}
              title={fullscreen.open ? 'Sair da tela cheia' : 'Tela cheia'}
              onClick={handleToggleFullscreen}
            >
              {fullscreen.open ? (
                <Minimize2 size={14} strokeWidth={2.25} aria-hidden='true' />
              ) : (
                <Maximize2 size={14} strokeWidth={2.25} aria-hidden='true' />
              )}
            </button>
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
              tab={pane}
              projectId={project.id}
              projectPath={project.path}
              isVisible
              isRuntimeActive
              isFocused={isFocused}
              disableStickyPrompt
              onFocusPane={() => handleFocus()}
              onPtyCreated={handlePtyCreated}
              onPtyLost={handlePtyLost}
              onUpdateTab={handleUpdateTab}
            />
          </Suspense>
        </div>
      </AgentCardFrame>
      {confirmOpen ? (
        <AgentCardCloseConfirm
          projectName={project.name}
          onConfirm={handleConfirmClose}
          onClose={handleCloseConfirm}
        />
      ) : null}
    </>
  );
}

const AgentCard = memo(AgentCardComponent);

interface HomeDashboardAgentModeProps {
  spawningPaneId?: string | null;
  onOpenMission: (missionId: string) => void;
}

function HomeDashboardAgentModeComponent({
  spawningPaneId = null,
  onOpenMission,
}: HomeDashboardAgentModeProps) {
  useMissionHydration();
  const projects = useHomeSurfaceProjects();
  const { closeTabForProject } = useTabActions();
  const [homeAgentQueue, setHomeAgentQueue] = useState(readHomeAgentQueue);
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null);
  const missions = useMissionStore((state) => state.missions);
  const selectedPaneIds = useMissionStore((state) => state.selectedPaneIds);
  const toggleSelectedPaneId = useMissionStore((state) => state.toggleSelectedPaneId);
  const clearSelectedPaneIds = useMissionStore((state) => state.clearSelectedPaneIds);
  const removeMission = useMissionStore((state) => state.removeMission);
  const cloudSessionIds = useCloudAgentSessionsStore(
    useShallow((state) => state.sessions.map((session) => session.id)),
  );

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
      });
    }

    return next;
  }, [homeAgentQueue, projects]);

  const visibleMissions = useMemo(
    () => missions.filter((mission) => mission.status !== 'cancelled'),
    [missions],
  );

  const overlayPaneIdsKey = useMemo(() => slots.map((slot) => slot.pane.id).join('\0'), [slots]);

  useLayoutEffect(() => {
    setHomeAgentOverlayPaneIds(overlayPaneIdsKey ? overlayPaneIdsKey.split('\0') : []);
  }, [overlayPaneIdsKey]);

  useLayoutEffect(() => {
    return () => {
      setHomeAgentOverlayPaneIds([]);
    };
  }, []);

  useEffect(() => {
    if (slots.length === 0) {
      setFocusedPaneId(null);
      return;
    }

    if (!focusedPaneId || !slots.some((slot) => slot.pane.id === focusedPaneId)) {
      setFocusedPaneId(slots[slots.length - 1]!.pane.id);
    }
  }, [focusedPaneId, slots]);

  useAgentPipSync(slots);

  const handleFocus = useCallback(
    (paneId: string, additive: boolean) => {
      setFocusedPaneId(paneId);
      if (additive) {
        toggleSelectedPaneId(paneId, true);
        return;
      }
      clearSelectedPaneIds();
    },
    [clearSelectedPaneIds, toggleSelectedPaneId],
  );

  const handleRemove = useCallback(
    (project: Project, pane: AgentTab) => {
      const pinnedId = useAgentPipStore.getState().paneId;
      if (pinnedId === pane.id) {
        useAgentPipStore.getState().unpin();
      }

      forgetHomeDashboardProjectAgent(project.id, pane.id);
      void closeTabForProject(project.id, pane.id);
    },
    [closeTabForProject],
  );

  return (
    <section className='home-dashboard__agent-mode app-button--enter'>
      {slots.length === 0 && cloudSessionIds.length === 0 && visibleMissions.length === 0 ? (
        <EmptyState
          icon={Bot}
          title='Nenhum agent na área'
          message='Escolha um projeto e pergunte algo ao Nexus para criar um agent aqui.'
          className='home-dashboard__agent-mode-empty'
        />
      ) : (
        <div className='home-dashboard__agent-grid'>
          {visibleMissions.map((mission, index) => (
            <MissionCard
              key={mission.id}
              mission={mission}
              enterDelayMs={40 + index * 35}
              onOpen={onOpenMission}
              onClose={(missionId) => {
                void removeMission(missionId);
              }}
            />
          ))}
          {slots.map((slot, index) => (
            <AgentCard
              key={`${slot.project.id}-${slot.pane.id}`}
              project={slot.project}
              pane={slot.pane}
              enterDelayMs={spawningPaneId === slot.pane.id ? 0 : 40 + index * 35}
              isFocused={focusedPaneId === slot.pane.id}
              isSpawning={spawningPaneId === slot.pane.id}
              isMultiSelected={
                selectedPaneIds.length > 1 && selectedPaneIds.includes(slot.pane.id)
              }
              onFocus={handleFocus}
              onRemove={handleRemove}
            />
          ))}
          {cloudSessionIds.map((sessionId, index) => (
            <HomeDashboardCloudAgentCard
              key={sessionId}
              sessionId={sessionId}
              enterDelayMs={40 + (slots.length + index) * 35}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export const HomeDashboardAgentMode = memo(HomeDashboardAgentModeComponent);
