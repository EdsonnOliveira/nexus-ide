import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Bell, Bot, CalendarDays, ListTodo } from 'lucide-react';
import { HomeDashboardMailCard } from '@/components/home/HomeDashboardMailCard';
import { HomeDashboardDailyCard } from '@/components/home/HomeDashboardDailyCard';
import { HomeDashboardActivityStats } from '@/components/home/HomeDashboardActivityStats';
import { HomeDashboardHero } from '@/components/home/HomeDashboardHero';
import { useHomeDashboardClock } from '@/hooks/useHomeDashboardClock';
import {
  HomeDashboardCalendarSkeleton,
  HomeDashboardHeroSkeleton,
  HomeDashboardNotificationSkeleton,
  HomeDashboardTaskListSkeleton,
} from '@/components/home/HomeDashboardSkeletons';
import { HomeDashboardSection } from '@/components/home/HomeDashboardSection';
import { HomeDashboardTaskRow } from '@/components/home/HomeDashboardTaskRow';
import { EmptyState } from '@/components/overlay/EmptyState';
import { SidebarCalendarEventPopup } from '@/components/sidebar/SidebarCalendarEventPopup';
import { TaskDetailModal } from '@/components/tasks/TaskDetailModal';
import { TaskFormModal } from '@/components/tasks/TaskFormModal';
import type { HomeDashboardTaskEntry } from '@/hooks/useHomeDashboardData';
import { useHomeDashboardData } from '@/hooks/useHomeDashboardData';
import { useHomeDashboardActivityStats } from '@/hooks/useHomeDashboardActivityStats';
import { useAppleCalendarEvents } from '@/hooks/useAppleCalendarEvents';
import { useProjectTaskExecution } from '@/hooks/useProjectTaskExecution';
import { useProjectNotificationStore } from '@/stores/useProjectNotificationStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTabActions } from '@/stores/useTabStore';
import type { CalendarEventItem } from '@/types';
import type { ProjectTask } from '@/types/task';
import {
  buildCalendarEventStyle,
  formatCalendarEventTime,
  isCalendarEventStillVisible,
} from '@/utils/calendarEventStyle';
import { formatNotificationRelativeTime } from '@/utils/notificationRelativeTime';
import {
  notificationAppIconKey,
  useNotificationAppIcons,
} from '@/hooks/useNotificationAppIcons';

interface ActiveCalendarPopupState {
  event: CalendarEventItem;
  anchorRect: DOMRect;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}

function HomeDashboardComponent() {
  const projects = useProjectStore((state) => state.projects);
  const activeWorkspaceId = useProjectStore((state) => state.activeWorkspaceId);
  const selectProject = useProjectStore((state) => state.selectProject);
  const updateProject = useProjectStore((state) => state.updateProject);
  const clearProjectNotification = useProjectNotificationStore(
    (state) => state.clearProjectNotification,
  );
  const { selectPane } = useTabActions();
  const { executeTask, executionModals } = useProjectTaskExecution(null);
  const { openEvent } = useAppleCalendarEvents(true);
  const { dateLabel, timeLabel, nowMs } = useHomeDashboardClock();

  const {
    visibleProjects,
    pendingTasks,
    notifiedProjects,
    systemNotificationPreview,
    systemNotifications,
    calendarEvents,
    calendarSnapshot,
    notificationsLoading,
    calendarHydrated,
  } = useHomeDashboardData(projects, activeWorkspaceId);

  const visibleProjectPathsKey = useMemo(
    () =>
      visibleProjects
        .map((project) => project.path)
        .filter(Boolean)
        .sort()
        .join('|'),
    [visibleProjects],
  );
  const { stats: activityStats, loading: activityLoading } =
    useHomeDashboardActivityStats(visibleProjectPathsKey);

  const appIcons = useNotificationAppIcons(systemNotificationPreview);
  const [calendarPopup, setCalendarPopup] = useState<ActiveCalendarPopupState | null>(null);
  const [detailEntry, setDetailEntry] = useState<HomeDashboardTaskEntry | null>(null);
  const [formEntry, setFormEntry] = useState<HomeDashboardTaskEntry | null>(null);

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

  const visibleCalendarEvents = useMemo(
    () => calendarEvents.filter((event) => isCalendarEventStillVisible(event, nowMs)),
    [calendarEvents, nowMs],
  );

  const hasNotifications =
    notifiedProjects.length > 0 || systemNotificationPreview.length > 0;

  const showNotificationSkeleton = notificationsLoading;
  const showCalendarSkeleton = !calendarHydrated;
  const showTasksSkeleton = activityLoading;
  const showHeroSkeleton = showNotificationSkeleton || showCalendarSkeleton || activityLoading;

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

  const handleExecuteFromDetail = useCallback(() => {
    if (!detailEntry) {
      return;
    }

    const entry = detailEntry;
    setDetailEntry(null);

    void (async () => {
      await selectProject(entry.project.id);
      executeTask(entry.task, entry.project.id);
    })();
  }, [detailEntry, executeTask, selectProject]);

  const handleEditTaskDetail = useCallback(() => {
    if (!detailEntry || detailEntry.task.source !== 'local') {
      return;
    }

    setFormEntry(detailEntry);
    setDetailEntry(null);
  }, [detailEntry]);

  const handleCloseTaskForm = useCallback(() => {
    setFormEntry(null);
  }, []);

  const handleSaveTask = useCallback(
    async (task: ProjectTask) => {
      if (!formEntry) {
        return;
      }

      const project = projects.find((item) => item.id === formEntry.project.id);

      if (!project) {
        return;
      }

      const tasks = project.tasks ?? [];
      const existingIndex = tasks.findIndex((item) => item.id === task.id);
      const nextTasks =
        existingIndex >= 0
          ? tasks.map((item, index) => (index === existingIndex ? task : item))
          : [...tasks, task];

      await updateProject(project.id, { tasks: nextTasks });
      setFormEntry(null);
    },
    [formEntry, projects, updateProject],
  );

  const handleExecuteTask = useCallback(
    (entry: HomeDashboardTaskEntry) => {
      void (async () => {
        await selectProject(entry.project.id);
        executeTask(entry.task, entry.project.id);
      })();
    },
    [executeTask, selectProject],
  );

  const handleCalendarEventClick = useCallback(
    (event: CalendarEventItem, anchorRef: React.RefObject<HTMLButtonElement | null>) => {
      const rect = anchorRef.current?.getBoundingClientRect();

      if (!rect) {
        void openEvent(event.startAt);
        return;
      }

      setCalendarPopup({
        event,
        anchorRect: rect,
        anchorRef,
      });
    },
    [openEvent],
  );

  const handleCloseCalendarPopup = useCallback(() => {
    setCalendarPopup(null);
  }, []);

  return (
    <div className='home-dashboard'>
      {showHeroSkeleton ? (
        <HomeDashboardHeroSkeleton />
      ) : (
        <HomeDashboardHero dateLabel={dateLabel} timeLabel={timeLabel} />
      )}

      <HomeDashboardDailyCard projects={visibleProjects} enterDelayMs={40} />

      <div className='home-dashboard__bento'>
        <HomeDashboardSection icon={Bell} title='Notificações' accent='#60a5fa' enterDelayMs={80}>
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
                    style={{ animationDelay: `${120 + (notifiedProjects.length + index) * 40}ms` }}
                    onClick={() => handleOpenSystemNotification(item.appId)}
                  >
                    <span className='home-dashboard__notification-icon' aria-hidden='true'>
                      {iconSrc ? (
                        <img src={iconSrc} alt='' className='home-dashboard__notification-app-icon' />
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
                  onClick={() => void window.nexus.systemNotifications.openFullDiskAccessSettings()}
                >
                  Permitir acesso às notificações do sistema
                </button>
              ) : null}
            </div>
          )}
        </HomeDashboardSection>

        <HomeDashboardSection icon={CalendarDays} title='Eventos de hoje' accent='#f472b6' enterDelayMs={120}>
          {showCalendarSkeleton ? (
            <HomeDashboardCalendarSkeleton />
          ) : !calendarSnapshot.platformSupported ? (
            <EmptyState icon={CalendarDays} message='Calendário disponível apenas no macOS' compact />
          ) : !calendarSnapshot.accessGranted ? (
            <button
              type='button'
              className='home-dashboard__permission-hint app-button app-button--enter'
              onClick={() => void window.nexus.calendar.requestAccess()}
            >
              Permitir acesso ao Calendário
            </button>
          ) : visibleCalendarEvents.length === 0 ? (
            <EmptyState icon={CalendarDays} message='Nenhum evento para hoje' compact />
          ) : (
            <div className='home-dashboard__calendar-list'>
              {visibleCalendarEvents.map((event, index) => (
                <HomeDashboardCalendarRow
                  key={`${event.startAt}-${event.title}`}
                  event={event}
                  enterDelayMs={160 + index * 40}
                  onSelect={handleCalendarEventClick}
                />
              ))}
            </div>
          )}
        </HomeDashboardSection>
      </div>

      <HomeDashboardActivityStats
        today={activityStats.today}
        yesterday={activityStats.yesterday}
        loading={activityLoading}
      />

      <HomeDashboardMailCard />

      <HomeDashboardSection icon={ListTodo} title='Tasks pendentes' accent='#c084fc' enterDelayMs={200}>
        {showTasksSkeleton ? (
          <HomeDashboardTaskListSkeleton />
        ) : pendingTasks.length === 0 ? (
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

      {calendarPopup ? (
        <SidebarCalendarEventPopup
          event={calendarPopup.event}
          anchorRect={calendarPopup.anchorRect}
          anchorRef={calendarPopup.anchorRef}
          onClose={handleCloseCalendarPopup}
          onOpenInCalendar={openEvent}
        />
      ) : null}
      {detailProject && detailTask ? (
        <TaskDetailModal
          projectId={detailProject.id}
          task={detailTask}
          jiraSiteUrl={detailProject.taskIntegration?.jiraSiteUrl}
          onClose={handleCloseTaskDetail}
          onEdit={detailTask.source === 'local' ? handleEditTaskDetail : undefined}
          onExecute={handleExecuteFromDetail}
        />
      ) : null}
      {formEntry ? (
        <TaskFormModal
          projectId={formEntry.project.id}
          task={formEntry.task}
          onClose={handleCloseTaskForm}
          onSave={(task) => void handleSaveTask(task)}
        />
      ) : null}
      {executionModals}
    </div>
  );
}

interface HomeDashboardCalendarRowProps {
  event: CalendarEventItem;
  enterDelayMs: number;
  onSelect: (event: CalendarEventItem, anchorRef: React.RefObject<HTMLButtonElement | null>) => void;
}

function HomeDashboardCalendarRow({ event, enterDelayMs, onSelect }: HomeDashboardCalendarRowProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const style = useMemo(() => buildCalendarEventStyle(event.colorHex), [event.colorHex]);
  const startLabel = useMemo(
    () => formatCalendarEventTime(event.startAt, event.allDay),
    [event.allDay, event.startAt],
  );

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
      <span className='home-dashboard__calendar-copy'>
        <span className='home-dashboard__calendar-title'>{event.title}</span>
        <span className='home-dashboard__calendar-meta'>
          {startLabel}
          {event.location.trim() ? ` · ${event.location.trim()}` : ''}
        </span>
      </span>
    </button>
  );
}

export const HomeDashboard = memo(HomeDashboardComponent);
