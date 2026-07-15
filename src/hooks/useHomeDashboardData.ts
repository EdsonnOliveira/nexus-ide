import { useMemo } from 'react';
import type { Project } from '@/types';
import type { ProjectTask } from '@/types/task';
import { useAppleCalendarEvents } from '@/hooks/useAppleCalendarEvents';
import { useSystemNotifications } from '@/hooks/useSystemNotifications';
import { useProjectNotificationStore } from '@/stores/useProjectNotificationStore';
import { isProjectSurfaceNotification } from '@/utils/homeDashboardAgents';
import { buildDefaultTaskFilters, filterProjectTasks } from '@/utils/taskFilters';
import { isLocalTaskCompleted } from '@/utils/taskJson';

export const HOME_DASHBOARD_TASK_LIMIT = 12;
export const HOME_DASHBOARD_NOTIFICATION_LIMIT = 5;

export interface HomeDashboardTaskEntry {
  project: Project;
  task: ProjectTask;
}

function filterVisibleProjects(projects: Project[], activeWorkspaceId: string | null): Project[] {
  if (activeWorkspaceId === null) {
    return projects;
  }

  return projects.filter((project) => project.workspaceId === activeWorkspaceId);
}

function resolvePendingTasksForProject(project: Project): ProjectTask[] {
  const tasks = project.tasks ?? [];

  if (tasks.length === 0) {
    return [];
  }

  const useDefaultFilters = project.taskIntegration?.platform === 'jira';
  const filters = useDefaultFilters
    ? buildDefaultTaskFilters(tasks, project.taskIntegration?.jiraAccountName)
    : {
        parent: [],
        assignee: [],
        issueType: [],
        categories: [],
        status: [],
        priority: [],
      };

  const filtered = filterProjectTasks(tasks, '', filters);

  return filtered.filter((task) => !isLocalTaskCompleted(task));
}

function compareTasks(left: ProjectTask, right: ProjectTask): number {
  const leftDue = left.local?.dueDate?.trim() ?? '';
  const rightDue = right.local?.dueDate?.trim() ?? '';

  if (leftDue && rightDue && leftDue !== rightDue) {
    return leftDue.localeCompare(rightDue, 'pt-BR');
  }

  if (leftDue && !rightDue) {
    return -1;
  }

  if (!leftDue && rightDue) {
    return 1;
  }

  return right.updatedAt - left.updatedAt;
}

export function useHomeDashboardData(projects: Project[], activeWorkspaceId: string | null) {
  const notifiedAgentPaneByProject = useProjectNotificationStore(
    (state) => state.notifiedAgentPaneByProject,
  );
  const { snapshot: calendarSnapshot, loading: calendarLoading, hydrated: calendarHydrated } =
    useAppleCalendarEvents(true);
  const { snapshot: systemNotifications, loading: notificationsLoading } =
    useSystemNotifications(true);

  const visibleProjects = useMemo(
    () => filterVisibleProjects(projects, activeWorkspaceId),
    [activeWorkspaceId, projects],
  );

  const pendingTasks = useMemo(() => {
    const entries: HomeDashboardTaskEntry[] = [];

    for (const project of visibleProjects) {
      for (const task of resolvePendingTasksForProject(project)) {
        entries.push({ project, task });
      }
    }

    entries.sort((left, right) => compareTasks(left.task, right.task));

    return entries.slice(0, HOME_DASHBOARD_TASK_LIMIT);
  }, [visibleProjects]);

  const notifiedProjects = useMemo(
    () =>
      visibleProjects
        .filter((project) =>
          isProjectSurfaceNotification(project.id, notifiedAgentPaneByProject[project.id]),
        )
        .map((project) => ({
          project,
          paneId: notifiedAgentPaneByProject[project.id] ?? null,
        })),
    [notifiedAgentPaneByProject, visibleProjects],
  );

  const systemNotificationPreview = useMemo(
    () => systemNotifications.items.slice(0, HOME_DASHBOARD_NOTIFICATION_LIMIT),
    [systemNotifications.items],
  );

  const calendarEvents = useMemo(
    () => calendarSnapshot.events,
    [calendarSnapshot.events],
  );

  return {
    visibleProjects,
    pendingTasks,
    notifiedProjects,
    systemNotificationPreview,
    systemNotifications,
    notificationsLoading,
    calendarEvents,
    calendarSnapshot,
    calendarLoading,
    calendarHydrated,
  };
}
