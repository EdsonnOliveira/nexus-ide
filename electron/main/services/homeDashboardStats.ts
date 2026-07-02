import { aggregateGitDailyStats } from './git';
import {
  formatLocalDateKeyFromMs,
  getHomeActivityMetricsForDay,
  getLocalDayBoundsMs,
} from './homeActivityStore';

export interface HomeDashboardDayStats {
  commits: number;
  linesChanged: number;
  agentExecutions: number;
  prompts: number;
}

export interface HomeDashboardActivityComparison {
  today: HomeDashboardDayStats;
  yesterday: HomeDashboardDayStats;
}

function emptyDayStats(): HomeDashboardDayStats {
  return {
    commits: 0,
    linesChanged: 0,
    agentExecutions: 0,
    prompts: 0,
  };
}

async function resolveDayStats(
  projectPaths: string[],
  dayStartMs: number,
  dayEndMs: number,
  dayKey: string,
): Promise<HomeDashboardDayStats> {
  const gitStats = await aggregateGitDailyStats(projectPaths, dayStartMs, dayEndMs);
  const activityStats = getHomeActivityMetricsForDay(dayKey);

  return {
    commits: gitStats.commits,
    linesChanged: gitStats.linesChanged,
    agentExecutions: activityStats.agentExecutions,
    prompts: activityStats.prompts,
  };
}

export async function getHomeDashboardActivityComparison(
  projectPaths: string[],
  referenceMs = Date.now(),
): Promise<HomeDashboardActivityComparison> {
  const uniquePaths = [...new Set(projectPaths.filter(Boolean))];

  if (uniquePaths.length === 0) {
    return {
      today: emptyDayStats(),
      yesterday: emptyDayStats(),
    };
  }

  const todayBounds = getLocalDayBoundsMs(referenceMs);
  const yesterdayReference = todayBounds.startMs - 1;
  const yesterdayBounds = getLocalDayBoundsMs(yesterdayReference);
  const todayKey = formatLocalDateKeyFromMs(referenceMs);
  const yesterdayKey = formatLocalDateKeyFromMs(yesterdayReference);

  const [today, yesterday] = await Promise.all([
    resolveDayStats(uniquePaths, todayBounds.startMs, todayBounds.endMs, todayKey),
    resolveDayStats(
      uniquePaths,
      yesterdayBounds.startMs,
      yesterdayBounds.endMs,
      yesterdayKey,
    ),
  ]);

  return { today, yesterday };
}
