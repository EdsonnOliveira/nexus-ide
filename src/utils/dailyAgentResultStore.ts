import type { Project, TerminalCommandHint } from '@/types';
import type { AgentGitChangeGroup } from '@/types/agentGit';
import { DAILY_RESPONSE_TONES, type DailyResponseTone } from '@/utils/dailyResponseTone';
import type { GitFlatChange } from '@/utils/gitFlatChanges';

export type DailyAgentResultStatus = 'loading' | 'success' | 'error';

export interface DailyAgentResultEntry {
  content: string;
  status: DailyAgentResultStatus;
  errorMessage?: string;
}

export interface DailyAgentResultModalState {
  project: Project;
  projectMeta: string;
  responses: Record<DailyResponseTone, DailyAgentResultEntry>;
}

export interface DailyGenerationContext {
  project: Project;
  skill: TerminalCommandHint;
  groups: AgentGitChangeGroup[];
  gitChanges: GitFlatChange[];
  targetDate: Date;
}

export interface CachedDailyResult {
  modal: DailyAgentResultModalState;
  context: DailyGenerationContext;
}

const STORAGE_KEY = 'nexus.home-dashboard.daily-results';
const STORAGE_VERSION = 1;

interface PersistedDailyResultsPayload {
  version: number;
  entries: PersistedDailyResultEntry[];
}

interface PersistedDailyResultEntry {
  projectId: string;
  projectMeta: string;
  responses: Record<DailyResponseTone, DailyAgentResultEntry>;
  context: {
    skill: TerminalCommandHint;
    groups: AgentGitChangeGroup[];
    gitChanges: GitFlatChange[];
    targetDate: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDailyAgentResultEntry(value: unknown): value is DailyAgentResultEntry {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.content === 'string' &&
    (value.status === 'loading' || value.status === 'success' || value.status === 'error') &&
    (value.errorMessage === undefined || typeof value.errorMessage === 'string')
  );
}

function isDailyResponses(value: unknown): value is Record<DailyResponseTone, DailyAgentResultEntry> {
  if (!isRecord(value)) {
    return false;
  }

  return DAILY_RESPONSE_TONES.every((tone) => isDailyAgentResultEntry(value[tone]));
}

function isTerminalCommandHint(value: unknown): value is TerminalCommandHint {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.badge === 'string' &&
    typeof value.label === 'string' &&
    typeof value.command === 'string'
  );
}

function isPersistedEntry(value: unknown): value is PersistedDailyResultEntry {
  if (!isRecord(value) || typeof value.projectId !== 'string' || typeof value.projectMeta !== 'string') {
    return false;
  }

  if (!isDailyResponses(value.responses) || !isRecord(value.context)) {
    return false;
  }

  const context = value.context;

  return (
    isTerminalCommandHint(context.skill) &&
    Array.isArray(context.groups) &&
    Array.isArray(context.gitChanges) &&
    typeof context.targetDate === 'string'
  );
}

function isDailyResultComplete(modal: DailyAgentResultModalState): boolean {
  return DAILY_RESPONSE_TONES.every((tone) => modal.responses[tone].status !== 'loading');
}

function serializeCacheEntry(entry: CachedDailyResult): PersistedDailyResultEntry {
  return {
    projectId: entry.modal.project.id,
    projectMeta: entry.modal.projectMeta,
    responses: entry.modal.responses,
    context: {
      skill: entry.context.skill,
      groups: entry.context.groups,
      gitChanges: entry.context.gitChanges,
      targetDate: entry.context.targetDate.toISOString(),
    },
  };
}

function deserializeCacheEntry(
  entry: PersistedDailyResultEntry,
  project: Project,
): CachedDailyResult | null {
  const targetDate = new Date(entry.context.targetDate);

  if (Number.isNaN(targetDate.getTime())) {
    return null;
  }

  const modal: DailyAgentResultModalState = {
    project,
    projectMeta: entry.projectMeta,
    responses: entry.responses,
  };

  if (!isDailyResultComplete(modal)) {
    return null;
  }

  return {
    modal,
    context: {
      project,
      skill: entry.context.skill,
      groups: entry.context.groups,
      gitChanges: entry.context.gitChanges,
      targetDate,
    },
  };
}

export function loadDailyResultsCache(projects: Project[]): Map<string, CachedDailyResult> {
  const cache = new Map<string, CachedDailyResult>();
  const projectsById = new Map(projects.map((project) => [project.id, project]));

  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return cache;
    }

    const parsed = JSON.parse(raw) as PersistedDailyResultsPayload;

    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.entries)) {
      return cache;
    }

    for (const entry of parsed.entries) {
      if (!isPersistedEntry(entry)) {
        continue;
      }

      const project = projectsById.get(entry.projectId);

      if (!project) {
        continue;
      }

      const cached = deserializeCacheEntry(entry, project);

      if (cached) {
        cache.set(entry.projectId, cached);
      }
    }
  } catch {
    return cache;
  }

  return cache;
}

export function writeDailyResultsCache(cache: Map<string, CachedDailyResult>): void {
  const entries = Array.from(cache.values())
    .filter((entry) => isDailyResultComplete(entry.modal))
    .map(serializeCacheEntry);

  if (entries.length === 0) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }

  const payload: PersistedDailyResultsPayload = {
    version: STORAGE_VERSION,
    entries,
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function refreshDailyResultsProjects(
  cache: Map<string, CachedDailyResult>,
  projects: Project[],
): void {
  const projectsById = new Map(projects.map((project) => [project.id, project]));

  for (const [projectId, entry] of cache) {
    const project = projectsById.get(projectId);

    if (!project) {
      continue;
    }

    cache.set(projectId, {
      modal: {
        ...entry.modal,
        project,
      },
      context: {
        ...entry.context,
        project,
      },
    });
  }
}
