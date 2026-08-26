import {
  aggregateProviderGitDailyStats,
  scanAiProviderActivity,
  type DashboardAiProvider,
} from './aiProviderActivityStats';
import {
  formatLocalDateKeyFromMs,
  getLocalDayBoundsMs,
} from './homeActivityStore';

export type { DashboardAiProvider };

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

export function resolveDashboardAiProvider(value: unknown): DashboardAiProvider {
  if (value === 'claude') {
    return 'claude';
  }

  if (value === 'opencode') {
    return 'opencode';
  }

  return 'cursor';
}

function buildStatsCacheKey(
  projectPaths: string[],
  provider: DashboardAiProvider,
  referenceMs: number,
): string {
  const dayKey = formatLocalDateKeyFromMs(referenceMs);
  const pathsKey = Array.from(new Set(projectPaths.filter(Boolean))).sort().join('|');
  return `${dayKey}:${provider}:${pathsKey}`;
}

export async function getHomeDashboardActivityComparison(
  projectPaths: string[],
  provider: DashboardAiProvider = 'cursor',
  referenceMs = Date.now(),
): Promise<HomeDashboardActivityComparison> {
  const uniquePaths = Array.from(new Set(projectPaths.filter(Boolean)));
  const cacheKey = buildStatsCacheKey(uniquePaths, provider, referenceMs);
  const cached = statsCache;

  if (cached && cached.key === cacheKey && cached.expiresAt > referenceMs) {
    return cached.value;
  }

  const todayBounds = getLocalDayBoundsMs(referenceMs);
  const yesterdayBounds = getLocalDayBoundsMs(todayBounds.startMs - 1);
  const todayKey = formatLocalDateKeyFromMs(referenceMs);
  const yesterdayKey = formatLocalDateKeyFromMs(todayBounds.startMs - 1);
  const providerScan = await scanAiProviderActivity(
    provider,
    yesterdayBounds.startMs,
    todayBounds.endMs,
  );
  const gitPaths = Array.from(new Set(uniquePaths.concat(providerScan.gitPaths)));
  const [todayGit, yesterdayGit] = await Promise.all([
    aggregateProviderGitDailyStats(gitPaths, todayBounds.startMs, todayBounds.endMs),
    aggregateProviderGitDailyStats(
      gitPaths,
      yesterdayBounds.startMs,
      yesterdayBounds.endMs,
    ),
  ]);
  const todayActivity = providerScan.activityByDay[todayKey];
  const yesterdayActivity = providerScan.activityByDay[yesterdayKey];
  const value = {
    today: {
      commits: todayGit.commits,
      linesChanged: todayGit.linesChanged,
      agentExecutions: todayActivity?.agentExecutions ?? 0,
      prompts: todayActivity?.prompts ?? 0,
    },
    yesterday: {
      commits: yesterdayGit.commits,
      linesChanged: yesterdayGit.linesChanged,
      agentExecutions: yesterdayActivity?.agentExecutions ?? 0,
      prompts: yesterdayActivity?.prompts ?? 0,
    },
  };

  statsCache = {
    key: cacheKey,
    expiresAt: referenceMs + STATS_CACHE_TTL_MS,
    value,
  };

  return value;
}
