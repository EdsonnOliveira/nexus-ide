import type { Project } from '@/types';
import { collectProjectPanes } from '@/utils/tabGroups';

export function formatLocalDayKey(timestampMs: number): string {
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isSameLocalCalendarDay(timestampMs: number, nowMs = Date.now()): boolean {
  return formatLocalDayKey(timestampMs) === formatLocalDayKey(nowMs);
}

export function projectHasAgentActivityToday(
  project: Project,
  nowMs = Date.now(),
): boolean {
  for (const pane of collectProjectPanes(project.tabs)) {
    if (pane.type !== 'agent') {
      continue;
    }

    for (const turn of pane.turns ?? []) {
      if (isSameLocalCalendarDay(turn.startedAt, nowMs)) {
        return true;
      }

      if (turn.completedAt && isSameLocalCalendarDay(turn.completedAt, nowMs)) {
        return true;
      }
    }
  }

  return false;
}

function getProjectTodaySortKey(project: Project, nowMs: number): number {
  let latest = 0;

  for (const pane of collectProjectPanes(project.tabs)) {
    if (pane.type !== 'agent') {
      continue;
    }

    for (const turn of pane.turns ?? []) {
      if (isSameLocalCalendarDay(turn.startedAt, nowMs)) {
        latest = Math.max(latest, turn.startedAt);
      }

      if (turn.completedAt && isSameLocalCalendarDay(turn.completedAt, nowMs)) {
        latest = Math.max(latest, turn.completedAt);
      }
    }
  }

  return latest;
}

export function splitSidebarProjectsByTodayActivity(
  projects: Project[],
  nowMs = Date.now(),
): { today: Project[]; others: Project[] } {
  const today: Project[] = [];
  const others: Project[] = [];

  for (const project of projects) {
    if (projectHasAgentActivityToday(project, nowMs)) {
      today.push(project);
    } else {
      others.push(project);
    }
  }

  today.sort(
    (left, right) =>
      getProjectTodaySortKey(right, nowMs) - getProjectTodaySortKey(left, nowMs),
  );

  return { today, others };
}
