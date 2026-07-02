import type { HomeDashboardActivityKind } from '@/types';

export function recordHomeDashboardActivity(kind: HomeDashboardActivityKind): void {
  if (!window.nexus?.homeDashboard?.recordActivity) {
    return;
  }

  void window.nexus.homeDashboard.recordActivity(kind);
}
