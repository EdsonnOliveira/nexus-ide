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

const STATS_CACHE_TTL_MS = 45_000;

interface StatsCacheEntry {
  key: string;
  expiresAt: number;
  value: HomeDashboardActivityComparison;
}

let statsCache: StatsCacheEntry | null = null;

function emptyDayStats(): HomeDashboardDayStats {
  return {
    commits: 0,
    linesChanged: 0,
    agentExecutions: 0,
    prompts: 0,
  };
}

function buildStatsCacheKey(projectPaths: string[], referenceMs: number): string {
  const dayKey = formatLocalDateKeyFromMs(referenceMs);
  const pathsKey = [...new Set(projectPaths.filter(Boolean))].sort().join('|');
  return `${dayKey}:${pathsKey}`;
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
  const cacheKey = buildStatsCacheKey(uniquePaths, referenceMs);
  const cached = statsCache;

  if (cached && cached.key === cacheKey && cached.expiresAt > referenceMs) {
    return cached.value;
  }

  if (uniquePaths.length === 0) {
    const emptyComparison = {
      today: emptyDayStats(),
      yesterday: emptyDayStats(),
    };

    statsCache = {
      key: cacheKey,
      expiresAt: referenceMs + STATS_CACHE_TTL_MS,
      value: emptyComparison,
    };

    return emptyComparison;
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

  const value = { today, yesterday };

  statsCache = {
    key: cacheKey,
    expiresAt: referenceMs + STATS_CACHE_TTL_MS,
    value,
  };

  return value;
}
