import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { Bell, Bot, CalendarDays, ListTodo } from 'lucide-react';
import { HomeDashboardAgentMode } from '@/components/home/HomeDashboardAgentMode';
import { CreateMissionDialog } from '@/components/mission/CreateMissionDialog';
import { MissionGraphView } from '@/components/mission/MissionGraphView';
import { MissionInbox } from '@/components/mission/MissionInbox';
import { MissionMultiSelectBar } from '@/components/mission/MissionMultiSelectBar';
import { useMissionStore } from '@/stores/useMissionStore';
import { useMissionHydration } from '@/hooks/useMissionHydration';
import { useMissionOrchestration } from '@/hooks/useMissionOrchestration';
import { HomeCalendarView } from '@/components/home/calendar/HomeCalendarView';
import { HomeDashboardMailCard } from '@/components/home/HomeDashboardMailCard';
import { HomeDashboardMacParakeetCard } from '@/components/home/HomeDashboardMacParakeetCard';
import { HomeDashboardDailyCard } from '@/components/home/HomeDashboardDailyCard';
import { HomeDashboardActivityStats } from '@/components/home/HomeDashboardActivityStats';
import {
  HomeDashboardAskBar,
  type HomeDashboardPromptFlightStart,
} from '@/components/home/HomeDashboardAskBar';
import { HomeDashboardHero } from '@/components/home/HomeDashboardHero';
import {
  HomeDashboardModeSwitch,
  type HomeDashboardViewMode,
} from '@/components/home/HomeDashboardModeSwitch';
import { useNowMs } from '@/hooks/useHomeDashboardClock';
import {
  HomeDashboardCalendarSkeleton,
  HomeDashboardNotificationSkeleton,
} from '@/components/home/HomeDashboardSkeletons';
import { HomeDashboardSection } from '@/components/home/HomeDashboardSection';
import { HomeDashboardTaskRow } from '@/components/home/HomeDashboardTaskRow';
import { HomeDashboardTasksBoard } from '@/components/home/HomeDashboardTasksBoard';
import { EmptyState } from '@/components/overlay/EmptyState';
import { SidebarCalendarEventPopup } from '@/components/sidebar/SidebarCalendarEventPopup';
import { TaskDetailModal } from '@/components/tasks/TaskDetailModal';
import { TaskFormModal } from '@/components/tasks/TaskFormModal';
import type { TaskExecutionAnchor } from '@/components/tasks/TaskAgentModeModal';
import type { HomeDashboardTaskEntry } from '@/hooks/useHomeDashboardData';
import { useHomeDashboardData, useHomeSurfaceProjects } from '@/hooks/useHomeDashboardData';
import { useHomeDashboardActivityStats } from '@/hooks/useHomeDashboardActivityStats';
import { openAppleCalendarEvent } from '@/hooks/useAppleCalendarEvents';
import { useProjectTaskExecution } from '@/hooks/useProjectTaskExecution';
import { useProjectNotificationStore } from '@/stores/useProjectNotificationStore';
import { useAppSettingsStore } from '@/stores/useAppSettingsStore';
import { useCloudAgentSessionsStore } from '@/stores/useCloudAgentSessionsStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useToastStore } from '@/stores/useToastStore';
import { useTabActions } from '@/stores/useTabStore';
import type { CalendarEventItem, Project } from '@/types';
import type { ProjectTask } from '@/types/task';
import { upsertProjectTasks } from '@/utils/taskJson';
import {
  buildCalendarEventStyle,
  formatCalendarEventTime,
  getVisibleCalendarEvents,
  shouldShowCalendarEventLivePing,
} from '@/utils/calendarEventStyle';
import { formatNotificationRelativeTime } from '@/utils/notificationRelativeTime';
import { notificationAppIconKey, useNotificationAppIcons } from '@/hooks/useNotificationAppIcons';
import {
  HOME_AGENT_CHANGE_EVENT,
  getHomeMaestroDense,
  readHomeAgentQueue,
  setHomeDashboardViewMode,
  setHomeMaestroDense,
} from '@/utils/homeDashboardAgents';
import { findPaneTab } from '@/utils/tabGroups';

interface PromptFlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PromptFlightState extends HomeDashboardPromptFlightStart {
  paneId: string | null;
  toRect: PromptFlightRect | null;
  phase: 'hold' | 'fly';
}

interface ActiveCalendarPopupState {
  event: CalendarEventItem;
  anchorRect: DOMRect;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}

const VIEW_MODE_STORAGE_KEY = 'nexus.home-dashboard.view-mode';

function readStoredViewMode(): HomeDashboardViewMode {
  try {
    const raw = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (raw === 'agent' || raw === 'dashboard' || raw === 'calendar' || raw === 'tasks') {
      return raw;
    }
  } catch {}

  return 'agent';
}

function HomeDashboardComponent() {
  const projects = useHomeSurfaceProjects();
  const cloudSessionCount = useCloudAgentSessionsStore((state) => state.sessions.length);
  const activeWorkspaceId = useProjectStore((state) => state.activeWorkspaceId);
  const [viewMode, setViewMode] = useState<HomeDashboardViewMode>(() => readStoredViewMode());
  const [maestroDense, setMaestroDense] = useState(() => getHomeMaestroDense());
  const selectProject = useProjectStore((state) => state.selectProject);
  const updateProject = useProjectStore((state) => state.updateProject);
  const notifiedAgentPaneByProject = useProjectNotificationStore(
    (state) => state.notifiedAgentPaneByProject,
  );
  const clearProjectNotification = useProjectNotificationStore(
    (state) => state.clearProjectNotification,
  );
  const { selectPane } = useTabActions();
  const { executeTask, executionModals } = useProjectTaskExecution(null);

  const {
    visibleProjects,
    pendingTasks,
    allTasks,
    notifiedProjects,
    systemNotificationPreview,
    systemNotifications,
    calendarEvents,
    calendarSnapshot,
    notificationsLoading,
    calendarHydrated,
  } = useHomeDashboardData(projects, activeWorkspaceId, viewMode === 'dashboard');

  const visibleProjectPathsKey = useMemo(
    () =>
      visibleProjects
        .map((project) => project.path)
        .filter(Boolean)
        .sort()
        .join('|'),
    [visibleProjects],
  );
  const preferredAiProvider = useAppSettingsStore((state) => state.preferredAiProvider);
  const { stats: activityStats, loading: activityLoading } = useHomeDashboardActivityStats(
    visibleProjectPathsKey,
    preferredAiProvider,
    viewMode === 'dashboard',
  );

  const appIcons = useNotificationAppIcons(systemNotificationPreview);
  const [calendarPopup, setCalendarPopup] = useState<ActiveCalendarPopupState | null>(null);
  const [detailEntry, setDetailEntry] = useState<HomeDashboardTaskEntry | null>(null);
  const [formEntry, setFormEntry] = useState<{
    project: Project;
    task: ProjectTask | null;
  } | null>(null);
  const [promptFlight, setPromptFlight] = useState<PromptFlightState | null>(null);
  const [spawningPaneId, setSpawningPaneId] = useState<string | null>(null);
  const [homeAgentQueue, setHomeAgentQueue] = useState(readHomeAgentQueue);
  const [createMissionOpen, setCreateMissionOpen] = useState(false);
  const activeMissionId = useMissionStore((state) => state.activeMissionId);
  const setStoreActiveMissionId = useMissionStore((state) => state.setActiveMissionId);
  const missionInboxCount = useMissionStore(
    (state) => state.inbox.filter((item) => !item.resolvedAt).length,
  );
  const missionCardCount = useMissionStore(
    (state) =>
      state.missions.reduce(
        (count, mission) => (mission.status !== 'cancelled' ? count + 1 : count),
        0,
      ),
  );
  useMissionHydration();
  useMissionOrchestration();
  const promptFlightClearRef = useRef<number | null>(null);
  const spawningClearRef = useRef<number | null>(null);

  useEffect(() => {
    const refresh = () => {
      setHomeAgentQueue(readHomeAgentQueue());
    };

    window.addEventListener(HOME_AGENT_CHANGE_EVENT, refresh);
    return () => {
      window.removeEventListener(HOME_AGENT_CHANGE_EVENT, refresh);
    };
  }, []);

  const homeAgentCount = useMemo(() => {
    const projectsById = new Map(projects.map((project) => [project.id, project]));
    let count = 0;

    for (const binding of homeAgentQueue) {
      const project = projectsById.get(binding.projectId);
      if (project && findPaneTab(project.tabs, binding.paneId)?.type === 'agent') {
        count += 1;
      }
    }

    return count;
  }, [homeAgentQueue, projects]);

  const maestroCardCount = homeAgentCount + cloudSessionCount + missionCardCount;
  const compactChrome = maestroCardCount >= 4 || viewMode === 'calendar';
  const hideHeroBrand = maestroCardCount >= 4;

  const detailProject = useMemo(() => {
    if (!detailEntry) {
      return null;
    }

    return projects.find((project) => project.id === detailEntry.project.id) ?? detailEntry.project;
  }, [detailEntry, projects]);

  const detailTask = useMemo(() => {
    if (!detailEntry || !detailProject) {
      return null;
    }

    return detailProject.tasks?.find((task) => task.id === detailEntry.task.id) ?? detailEntry.task;
  }, [detailEntry, detailProject]);

  const hasNotifications = notifiedProjects.length > 0 || systemNotificationPreview.length > 0;
  const hasMaestroPing = Object.keys(notifiedAgentPaneByProject).length > 0;

  const showNotificationSkeleton = notificationsLoading;
  const showCalendarSkeleton = !calendarHydrated;

  const handleOpenAgentNotification = useCallback(
    (projectId: string, paneId: string | null) => {
      void (async () => {
        await selectProject(projectId);
        clearProjectNotification(projectId);

        if (paneId) {
          await selectPane(paneId);
        }
      })();
    },
    [clearProjectNotification, selectPane, selectProject],
  );

  const handleOpenSystemNotification = useCallback((appId: string) => {
    void window.nexus.systemNotifications.openApp(appId);
  }, []);

  const handleOpenTask = useCallback((entry: HomeDashboardTaskEntry) => {
    setDetailEntry(entry);
  }, []);

  const handleCloseTaskDetail = useCallback(() => {
    setDetailEntry(null);
  }, []);

  const handleExecuteFromDetail = useCallback(
    (task?: ProjectTask, anchor?: TaskExecutionAnchor | null) => {
      if (!detailEntry) {
        return;
      }

      const entry = detailEntry;
      const target = task ?? entry.task;
      setDetailEntry(null);

      void (async () => {
        await selectProject(entry.project.id);
        executeTask(target, entry.project.id, anchor);
      })();
    },
    [detailEntry, executeTask, selectProject],
  );

  const handleEditTaskDetail = useCallback(() => {
    if (!detailEntry || detailEntry.task.source !== 'local') {
      return;
    }

    setFormEntry({ project: detailEntry.project, task: detailEntry.task });
    setDetailEntry(null);
  }, [detailEntry]);

  const handleCreateTask = useCallback(
    (preferredProjectId: string | null) => {
      const project =
        (preferredProjectId
          ? visibleProjects.find((item) => item.id === preferredProjectId)
          : null) ?? visibleProjects[0];

      if (!project) {
        useToastStore.getState().showToast('Nenhum projeto disponível');
        return;
      }

      setFormEntry({ project, task: null });
    },
    [visibleProjects],
  );

  const handleFormProjectChange = useCallback(
    (projectId: string) => {
      const project = visibleProjects.find((item) => item.id === projectId);

      if (!project) {
        return;
      }

      setFormEntry((current) => (current ? { ...current, project } : current));
    },
    [visibleProjects],
  );

  const handleCloseTaskForm = useCallback(() => {
    setFormEntry(null);
  }, []);

  const handleSaveTasks = useCallback(
    async (incoming: ProjectTask[]) => {
      if (!formEntry) {
        return;
      }

      const project = projects.find((item) => item.id === formEntry.project.id);

      if (!project) {
        return;
      }

      await updateProject(project.id, {
        tasks: upsertProjectTasks(project.tasks ?? [], incoming),
      });
      setFormEntry(null);
    },
    [formEntry, projects, updateProject],
  );

  const handleSaveTask = useCallback(
    async (task: ProjectTask) => {
      await handleSaveTasks([task]);
    },
    [handleSaveTasks],
  );

  const handleExecuteTask = useCallback(
    (entry: HomeDashboardTaskEntry, anchor?: TaskExecutionAnchor | null) => {
      void (async () => {
        await selectProject(entry.project.id);
        executeTask(entry.task, entry.project.id, anchor);
      })();
    },
    [executeTask, selectProject],
  );

  const handleTaskDetailUpdated = useCallback(
    (updated: ProjectTask) => {
      if (!detailEntry) {
        return;
      }

      const projectId = detailEntry.project.id;
      const project = projects.find((item) => item.id === projectId);

      if (!project) {
        return;
      }

      const nextTasks = (project.tasks ?? []).map((item) =>
        item.id === updated.id || (updated.externalId && item.externalId === updated.externalId)
          ? {
              ...item,
              ...updated,
              updatedAt: Date.now(),
            }
          : item,
      );

      void updateProject(projectId, { tasks: nextTasks });
      setDetailEntry({
        project: { ...project, tasks: nextTasks },
        task: updated,
      });
    },
    [detailEntry, projects, updateProject],
  );

  const handleCalendarEventClick = useCallback(
    (event: CalendarEventItem, anchorRef: React.RefObject<HTMLButtonElement | null>) => {
      const rect = anchorRef.current?.getBoundingClientRect();

      if (!rect) {
        void openAppleCalendarEvent(event.startAt);
        return;
      }

      setCalendarPopup({
        event,
        anchorRect: rect,
        anchorRef,
      });
    },
    [],
  );

  const handleCloseCalendarPopup = useCallback(() => {
    setCalendarPopup(null);
  }, []);

  const handleViewModeChange = useCallback((mode: HomeDashboardViewMode) => {
    setViewMode(mode);
    setHomeDashboardViewMode(mode);
  }, []);

  const handleMaestroDensityToggle = useCallback(() => {
    setMaestroDense((current) => {
      const next = !current;
      setHomeMaestroDense(next);
      return next;
    });
  }, []);

  const handleShowAgentMode = useCallback(() => {
    setViewMode('agent');
    setHomeDashboardViewMode('agent');
  }, []);

  const clearPromptFlightTimers = useCallback(() => {
    if (promptFlightClearRef.current !== null) {
      window.clearTimeout(promptFlightClearRef.current);
      promptFlightClearRef.current = null;
    }
    if (spawningClearRef.current !== null) {
      window.clearTimeout(spawningClearRef.current);
      spawningClearRef.current = null;
    }
  }, []);

  const handlePromptFlightStart = useCallback(
    (payload: HomeDashboardPromptFlightStart) => {
      clearPromptFlightTimers();
      setPromptFlight({
        ...payload,
        paneId: null,
        toRect: null,
        phase: 'hold',
      });
    },
    [clearPromptFlightTimers],
  );

  const handlePromptFlightCancel = useCallback(
    (flightId: string) => {
      clearPromptFlightTimers();
      setPromptFlight((current) => (current?.id === flightId ? null : current));
      setSpawningPaneId(null);
    },
    [clearPromptFlightTimers],
  );

  const handlePromptFlightLand = useCallback(
    (flightId: string, paneId: string) => {
      setSpawningPaneId(paneId);
      setPromptFlight((current) => {
        if (!current || current.id !== flightId) {
          return current;
        }

        return {
          ...current,
          paneId,
          phase: 'fly',
        };
      });

      clearPromptFlightTimers();
      promptFlightClearRef.current = window.setTimeout(() => {
        setPromptFlight((current) => (current?.id === flightId ? null : current));
        promptFlightClearRef.current = null;
      }, 520);

      spawningClearRef.current = window.setTimeout(() => {
        setSpawningPaneId((current) => (current === paneId ? null : current));
        spawningClearRef.current = null;
      }, 720);
    },
    [clearPromptFlightTimers],
  );

  useLayoutEffect(() => {
    if (
      !promptFlight ||
      promptFlight.phase !== 'fly' ||
      !promptFlight.paneId ||
      promptFlight.toRect
    ) {
      return;
    }

    const measureTarget = (): PromptFlightRect | null => {
      const card = document.querySelector<HTMLElement>(
        `[data-home-agent-pane="${promptFlight.paneId}"]`,
      );

      if (card) {
        const rect = card.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        };
      }

      const grid = document.querySelector<HTMLElement>('.home-dashboard__agent-grid');
      if (grid) {
        const rect = grid.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          width: Math.min(480, rect.width),
          height: Math.min(220, rect.height || 220),
        };
      }

      const mode = document.querySelector<HTMLElement>('.home-dashboard__agent-mode');
      if (!mode) {
        return null;
      }

      const rect = mode.getBoundingClientRect();
      return {
        left: rect.left + Math.max(0, (rect.width - 480) / 2),
        top: rect.top + 24,
        width: Math.min(480, rect.width),
        height: 220,
      };
    };

    let attempts = 0;
    let frameId = 0;

    const tick = () => {
      const toRect = measureTarget();
      attempts += 1;

      if (toRect) {
        setPromptFlight((current) => {
          if (!current || current.id !== promptFlight.id || current.toRect) {
            return current;
          }

          return {
            ...current,
            toRect,
          };
        });
        return;
      }

      if (attempts < 12) {
        frameId = window.requestAnimationFrame(tick);
      }
    };

    frameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [promptFlight]);

  useEffect(() => {
    return () => {
      clearPromptFlightTimers();
    };
  }, [clearPromptFlightTimers]);

  const promptFlightStyle = useMemo(() => {
    if (!promptFlight) {
      return undefined;
    }

    const style: CSSProperties & Record<string, string | number> = {
      left: promptFlight.fromRect.left,
      top: promptFlight.fromRect.top,
      width: promptFlight.fromRect.width,
      height: Math.max(44, Math.min(promptFlight.fromRect.height, 72)),
      '--prompt-flight-accent': promptFlight.projectColor,
    };

    if (promptFlight.toRect) {
      const fromCenterX = promptFlight.fromRect.left + promptFlight.fromRect.width / 2;
      const fromCenterY = promptFlight.fromRect.top + promptFlight.fromRect.height / 2;
      const toCenterX = promptFlight.toRect.left + promptFlight.toRect.width / 2;
      const toCenterY = promptFlight.toRect.top + Math.min(56, promptFlight.toRect.height / 2);
      style['--prompt-flight-x'] = `${toCenterX - fromCenterX}px`;
      style['--prompt-flight-y'] = `${toCenterY - fromCenterY}px`;
    }

    return style;
  }, [promptFlight]);

  const promptFlightNode =
    promptFlight && promptFlightStyle
      ? createPortal(
          <div
            className={`home-dashboard__prompt-flight${
              promptFlight.phase === 'fly' && promptFlight.toRect
                ? ' home-dashboard__prompt-flight--fly'
                : ' home-dashboard__prompt-flight--hold'
            }`}
            style={promptFlightStyle}
            aria-hidden='true'
          >
            <span className='home-dashboard__prompt-flight-project'>
              {promptFlight.projectName}
            </span>
            <span className='home-dashboard__prompt-flight-text'>{promptFlight.text}</span>
          </div>,
          document.body,
        )
      : null;

  const askBar = (
    <div
      className={`home-dashboard__ask-bar${
        viewMode === 'dashboard' || viewMode === 'tasks' || viewMode === 'calendar'
          ? ' home-dashboard__ask-bar--sticky'
          : ''
      }${compactChrome ? ' home-dashboard__ask-bar--compact' : ''}${
        promptFlight ? ' home-dashboard__ask-bar--launching' : ''
      }`}
    >
      <HomeDashboardAskBar
        projects={visibleProjects}
        viewMode={viewMode}
        compact={compactChrome}
        onAgentOpened={handleShowAgentMode}
        onPromptFlightStart={handlePromptFlightStart}
        onPromptFlightLand={handlePromptFlightLand}
        onPromptFlightCancel={handlePromptFlightCancel}
      />
    </div>
  );

  return (
    <div
      className={`home-dashboard nexus-hero${viewMode === 'agent' ? ' home-dashboard--maestro' : ''}${
        viewMode === 'calendar' ? ' home-dashboard--calendar' : ''
      }${viewMode === 'tasks' ? ' home-dashboard--tasks' : ''}${
        compactChrome ? ' home-dashboard--compact-chrome' : ''
      }${viewMode === 'agent' && maestroDense ? ' home-dashboard--maestro-dense' : ''}${
        promptFlight ? ' home-dashboard--prompt-flight' : ''
      }${activeMissionId ? ' home-dashboard--mission' : ''}`}
    >
      {activeMissionId ? (
        <MissionGraphView
          missionId={activeMissionId}
          onClose={() => {
            setStoreActiveMissionId(null);
          }}
        />
      ) : (
        <>
          {viewMode === 'agent' ? (
            <div className='home-dashboard__aurora' aria-hidden='true'>
              <span className='home-dashboard__aurora-blob home-dashboard__aurora-blob--a' />
              <span className='home-dashboard__aurora-blob home-dashboard__aurora-blob--b' />
              <span className='home-dashboard__aurora-blob home-dashboard__aurora-blob--c' />
            </div>
          ) : null}
          <HomeDashboardHero
            compact={compactChrome}
            dense={viewMode === 'agent' && maestroDense}
            hideBrand={hideHeroBrand}
            showDensityToggle={viewMode === 'agent'}
            onDensityToggle={handleMaestroDensityToggle}
            showCreateMission={viewMode === 'agent'}
            onCreateMission={() => setCreateMissionOpen(true)}
            askSlot={askBar}
            switchSlot={
              compactChrome ? (
                <HomeDashboardModeSwitch
                  mode={viewMode}
                  hasMaestroPing={hasMaestroPing}
                  onChange={handleViewModeChange}
                />
              ) : null
            }
          />

          {compactChrome ? null : (
            <div className='home-dashboard__mode-switch-wrap'>
              <HomeDashboardModeSwitch
                mode={viewMode}
                hasMaestroPing={hasMaestroPing}
                onChange={handleViewModeChange}
              />
            </div>
          )}

          {viewMode === 'calendar' ? (
            <HomeCalendarView />
          ) : viewMode === 'agent' ? (
            <>
              {missionInboxCount > 0 ? (
                <MissionInbox onOpenMission={(missionId) => setStoreActiveMissionId(missionId)} />
              ) : null}
              <MissionMultiSelectBar />
              <HomeDashboardAgentMode
                spawningPaneId={spawningPaneId}
                onOpenMission={(missionId) => {
                  setStoreActiveMissionId(missionId);
                }}
              />
            </>
          ) : viewMode === 'tasks' ? (
            <HomeDashboardTasksBoard
              projects={visibleProjects}
              entries={allTasks}
              onOpen={handleOpenTask}
              onExecute={handleExecuteTask}
              onCreate={handleCreateTask}
            />
          ) : (
            <>
              <HomeDashboardDailyCard projects={visibleProjects} enterDelayMs={40} />

              <div className='home-dashboard__bento'>
                <HomeDashboardSection
                  icon={Bell}
                  title='Notificações'
                  accent='#94a3b8'
                  enterDelayMs={80}
                >
              {showNotificationSkeleton ? (
                <HomeDashboardNotificationSkeleton />
              ) : !hasNotifications ? (
                <EmptyState icon={Bell} message='Nenhuma notificação recente' compact />
              ) : (
                <div className='home-dashboard__notification-list'>
                  {notifiedProjects.map(({ project, paneId }, index) => (
                    <button
                      key={project.id}
                      type='button'
                      className='home-dashboard__notification-row app-button app-button--enter'
                      style={{ animationDelay: `${120 + index * 40}ms` }}
                      onClick={() => handleOpenAgentNotification(project.id, paneId)}
                    >
                      <span className='home-dashboard__notification-icon' aria-hidden='true'>
                        <Bot size={14} />
                      </span>
                      <span className='home-dashboard__notification-copy'>
                        <span className='home-dashboard__notification-title'>Agent pronto</span>
                        <span className='home-dashboard__notification-meta'>{project.name}</span>
                      </span>
                    </button>
                  ))}
                  {systemNotificationPreview.map((item, index) => {
                    const iconKey = notificationAppIconKey(item.appId, item.appLabel);
                    const iconSrc = appIcons[iconKey];

                    return (
                      <button
                        key={item.id}
                        type='button'
                        className='home-dashboard__notification-row app-button app-button--enter'
                        style={{
                          animationDelay: `${120 + (notifiedProjects.length + index) * 40}ms`,
                        }}
                        onClick={() => handleOpenSystemNotification(item.appId)}
                      >
                        <span className='home-dashboard__notification-icon' aria-hidden='true'>
                          {iconSrc ? (
                            <img
                              src={iconSrc}
                              alt=''
                              className='home-dashboard__notification-app-icon'
                            />
                          ) : (
                            <Bell size={14} />
                          )}
                        </span>
                        <span className='home-dashboard__notification-copy'>
                          <span className='home-dashboard__notification-title'>{item.title}</span>
                          <span className='home-dashboard__notification-meta'>
                            {item.appLabel} · {formatNotificationRelativeTime(item.deliveredAt)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                  {!systemNotifications.accessGranted && systemNotifications.platformSupported ? (
                    <button
                      type='button'
                      className='home-dashboard__permission-hint app-button app-button--enter'
                      onClick={() =>
                        void window.nexus.systemNotifications.openFullDiskAccessSettings()
                      }
                    >
                      Permitir acesso às notificações do sistema
                    </button>
                  ) : null}
                </div>
              )}
            </HomeDashboardSection>

            <HomeDashboardSection
              icon={CalendarDays}
              title='Eventos de hoje'
              accent='#94a3b8'
              enterDelayMs={120}
            >
              {showCalendarSkeleton ? (
                <HomeDashboardCalendarSkeleton />
              ) : !calendarSnapshot.platformSupported ? (
                <EmptyState
                  icon={CalendarDays}
                  message='Calendário disponível apenas no macOS'
                  compact
                />
              ) : !calendarSnapshot.accessGranted ? (
                <button
                  type='button'
                  className='home-dashboard__permission-hint app-button app-button--enter'
                  onClick={() => void window.nexus.calendar.requestAccess()}
                >
                  Permitir acesso ao Calendário
                </button>
              ) : (
                <HomeDashboardCalendarList
                  events={calendarEvents}
                  onSelect={handleCalendarEventClick}
                />
              )}
            </HomeDashboardSection>
          </div>

          <HomeDashboardActivityStats
            today={activityStats.today}
            yesterday={activityStats.yesterday}
            loading={activityLoading}
          />

          <HomeDashboardMacParakeetCard />

          <HomeDashboardMailCard />

          <HomeDashboardSection
            icon={ListTodo}
            title='Tasks pendentes'
            accent='#94a3b8'
            enterDelayMs={200}
          >
            {pendingTasks.length === 0 ? (
              <EmptyState icon={ListTodo} message='Nenhuma task pendente' compact />
            ) : (
              <div className='home-dashboard__task-list'>
                {pendingTasks.map((entry, index) => (
                  <HomeDashboardTaskRow
                    key={`${entry.project.id}-${entry.task.id}`}
                    entry={entry}
                    enterDelayMs={240 + index * 35}
                    onOpen={handleOpenTask}
                    onExecute={handleExecuteTask}
                  />
                ))}
              </div>
            )}
          </HomeDashboardSection>
        </>
      )}
        </>
      )}

      {calendarPopup ? (
        <SidebarCalendarEventPopup
          event={calendarPopup.event}
          anchorRect={calendarPopup.anchorRect}
          anchorRef={calendarPopup.anchorRef}
          onClose={handleCloseCalendarPopup}
          onOpenInCalendar={openAppleCalendarEvent}
        />
      ) : null}
      {detailProject && detailTask ? (
        <TaskDetailModal
          projectId={detailProject.id}
          task={detailTask}
          relatedTasks={detailProject.tasks}
          jiraSiteUrl={detailProject.taskIntegration?.jiraSiteUrl}
          onClose={handleCloseTaskDetail}
          onEdit={detailTask.source === 'local' ? handleEditTaskDetail : undefined}
          onExecute={handleExecuteFromDetail}
          onTaskUpdated={handleTaskDetailUpdated}
        />
      ) : null}
      {formEntry ? (
        <TaskFormModal
          projectId={formEntry.project.id}
          task={formEntry.task}
          projects={formEntry.task ? undefined : visibleProjects}
          onProjectChange={formEntry.task ? undefined : handleFormProjectChange}
          onClose={handleCloseTaskForm}
          onSave={(task) => void handleSaveTask(task)}
          onSaveMany={(incoming) => void handleSaveTasks(incoming)}
        />
      ) : null}
      {executionModals}
      {promptFlightNode}
      {createMissionOpen ? (
        <CreateMissionDialog
          onClose={() => setCreateMissionOpen(false)}
          onCreated={(missionId) => {
            setCreateMissionOpen(false);
            setStoreActiveMissionId(missionId);
          }}
        />
      ) : null}
    </div>
  );
}

interface HomeDashboardCalendarListProps {
  events: CalendarEventItem[];
  onSelect: (
    event: CalendarEventItem,
    anchorRef: React.RefObject<HTMLButtonElement | null>,
  ) => void;
}

function HomeDashboardCalendarListComponent({ events, onSelect }: HomeDashboardCalendarListProps) {
  const nowMs = useNowMs(15_000);
  const visibleEvents = useMemo(() => getVisibleCalendarEvents(events, nowMs), [events, nowMs]);

  if (visibleEvents.length === 0) {
    return <EmptyState icon={CalendarDays} message='Nenhum evento para hoje' compact />;
  }

  return (
    <div className='home-dashboard__calendar-list'>
      {visibleEvents.map((event, index) => (
        <HomeDashboardCalendarRow
          key={`${event.startAt}-${event.title}`}
          event={event}
          enterDelayMs={160 + index * 40}
          nowMs={nowMs}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

const HomeDashboardCalendarList = memo(HomeDashboardCalendarListComponent);

interface HomeDashboardCalendarRowProps {
  event: CalendarEventItem;
  enterDelayMs: number;
  nowMs: number;
  onSelect: (
    event: CalendarEventItem,
    anchorRef: React.RefObject<HTMLButtonElement | null>,
  ) => void;
}

function HomeDashboardCalendarRow({
  event,
  enterDelayMs,
  nowMs,
  onSelect,
}: HomeDashboardCalendarRowProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const style = useMemo(() => buildCalendarEventStyle(event.colorHex), [event.colorHex]);
  const startLabel = useMemo(
    () => formatCalendarEventTime(event.startAt, event.allDay),
    [event.allDay, event.startAt],
  );
  const endLabel = useMemo(
    () => formatCalendarEventTime(event.endAt, event.allDay),
    [event.allDay, event.endAt],
  );
  const showLivePing = useMemo(() => shouldShowCalendarEventLivePing(event, nowMs), [event, nowMs]);
  const locationLabel = event.location.trim();

  const handleClick = useCallback(() => {
    onSelect(event, anchorRef);
  }, [event, onSelect]);

  return (
    <button
      ref={anchorRef}
      type='button'
      className='home-dashboard__calendar-row app-button app-button--enter'
      style={{ ...style, animationDelay: `${enterDelayMs}ms` }}
      onClick={handleClick}
    >
      <span className='home-dashboard__calendar-accent' aria-hidden='true' />
      <span className='home-dashboard__calendar-body'>
        <span className='home-dashboard__calendar-title'>{event.title}</span>
        <span className='home-dashboard__calendar-meta'>
          {locationLabel || event.calendarName || '—'}
        </span>
        <span className='home-dashboard__calendar-times'>
          {showLivePing ? (
            <span className='home-dashboard__calendar-live' aria-label='Reunião em andamento'>
              <span className='home-dashboard__calendar-live-dot' aria-hidden='true' />
            </span>
          ) : null}
          <span className='home-dashboard__calendar-times-copy'>
            <span className='home-dashboard__calendar-time home-dashboard__calendar-time--primary'>
              {startLabel}
            </span>
            {!event.allDay ? (
              <span className='home-dashboard__calendar-time home-dashboard__calendar-time--secondary'>
                {endLabel}
              </span>
            ) : null}
          </span>
        </span>
      </span>
    </button>
  );
}

export const HomeDashboard = memo(HomeDashboardComponent);
