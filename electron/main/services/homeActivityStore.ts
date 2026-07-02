import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export type HomeActivityMetricKind = 'prompts' | 'agentExecutions';

interface HomeActivityDayMetrics {
  prompts: number;
  agentExecutions: number;
}

interface HomeActivityFile {
  days: Record<string, HomeActivityDayMetrics>;
}

const MAX_STORED_DAYS = 120;

function getStorePath(): string {
  return path.join(app.getPath('userData'), 'home-dashboard-activity.json');
}

let cache: HomeActivityFile | null = null;

function emptyDayMetrics(): HomeActivityDayMetrics {
  return { prompts: 0, agentExecutions: 0 };
}

function formatLocalDateKey(ms: number): string {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function loadStore(): HomeActivityFile {
  if (cache) {
    return cache;
  }

  const filePath = getStorePath();

  if (existsSync(filePath)) {
    try {
      cache = JSON.parse(readFileSync(filePath, 'utf8')) as HomeActivityFile;
      return cache;
    } catch {
      cache = { days: {} };
      return cache;
    }
  }

  cache = { days: {} };
  return cache;
}

function pruneOldDays(store: HomeActivityFile): void {
  const keys = Object.keys(store.days).sort();

  if (keys.length <= MAX_STORED_DAYS) {
    return;
  }

  for (const key of keys.slice(0, keys.length - MAX_STORED_DAYS)) {
    delete store.days[key];
  }
}

function persistStore(store: HomeActivityFile): void {
  pruneOldDays(store);
  cache = store;
  const filePath = getStorePath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(store));
}

export function recordHomeActivityMetric(
  kind: HomeActivityMetricKind,
  atMs = Date.now(),
): void {
  const store = loadStore();
  const dayKey = formatLocalDateKey(atMs);
  const current = store.days[dayKey] ?? emptyDayMetrics();

  store.days[dayKey] = {
    ...current,
    [kind]: current[kind] + 1,
  };

  persistStore(store);
}

export function getHomeActivityMetricsForDay(dayKey: string): HomeActivityDayMetrics {
  const store = loadStore();
  return store.days[dayKey] ?? emptyDayMetrics();
}

export function formatLocalDateKeyFromMs(ms: number): string {
  return formatLocalDateKey(ms);
}

export function getLocalDayBoundsMs(referenceMs: number): { startMs: number; endMs: number } {
  const start = new Date(referenceMs);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startMs: start.getTime(), endMs: end.getTime() };
}
