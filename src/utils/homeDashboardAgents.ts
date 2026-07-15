const HOME_AGENT_STORAGE_KEY = 'nexus.home-dashboard.project-agents';
export const HOME_AGENT_CHANGE_EVENT = 'nexus-home-dashboard-project-agents';
export const HOME_AGENT_FOCUS_EVENT = 'nexus-home-dashboard-focus-agent';

export interface HomeAgentBinding {
  projectId: string;
  paneId: string;
}

export type HomeAgentQueue = HomeAgentBinding[];
export type HomeAgentMap = Record<string, string[]>;

function normalizePaneIds(value: unknown): string[] {
  if (typeof value === 'string' && value) {
    return [value];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const paneIds: string[] = [];

  for (const entry of value) {
    if (typeof entry !== 'string' || !entry || seen.has(entry)) {
      continue;
    }

    seen.add(entry);
    paneIds.push(entry);
  }

  return paneIds;
}

function bindingKey(projectId: string, paneId: string): string {
  return `${projectId}::${paneId}`;
}

function normalizeHomeAgentQueue(raw: unknown): HomeAgentQueue {
  if (Array.isArray(raw)) {
    const seen = new Set<string>();
    const queue: HomeAgentQueue = [];

    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const projectId = (entry as { projectId?: unknown }).projectId;
      const paneId = (entry as { paneId?: unknown }).paneId;

      if (typeof projectId !== 'string' || !projectId || typeof paneId !== 'string' || !paneId) {
        continue;
      }

      const key = bindingKey(projectId, paneId);

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      queue.push({ projectId, paneId });
    }

    return queue;
  }

  if (!raw || typeof raw !== 'object') {
    return [];
  }

  const queue: HomeAgentQueue = [];
  const seen = new Set<string>();

  for (const [projectId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!projectId) {
      continue;
    }

    for (const paneId of normalizePaneIds(value)) {
      const key = bindingKey(projectId, paneId);

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      queue.push({ projectId, paneId });
    }
  }

  return queue;
}

function queueToMap(queue: HomeAgentQueue): HomeAgentMap {
  const next: HomeAgentMap = {};

  for (const binding of queue) {
    const existing = next[binding.projectId];

    if (existing) {
      existing.push(binding.paneId);
    } else {
      next[binding.projectId] = [binding.paneId];
    }
  }

  return next;
}

export function readHomeAgentQueue(): HomeAgentQueue {
  try {
    const raw = window.localStorage.getItem(HOME_AGENT_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    return normalizeHomeAgentQueue(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function writeHomeAgentQueue(queue: HomeAgentQueue): void {
  try {
    window.localStorage.setItem(HOME_AGENT_STORAGE_KEY, JSON.stringify(queue));
  } catch {
  }
}

export function readHomeAgentMap(): HomeAgentMap {
  return queueToMap(readHomeAgentQueue());
}

export function writeHomeAgentMap(map: HomeAgentMap): void {
  const queue: HomeAgentQueue = [];

  for (const [projectId, paneIds] of Object.entries(map)) {
    for (const paneId of paneIds) {
      queue.push({ projectId, paneId });
    }
  }

  writeHomeAgentQueue(queue);
}

export function readHomeAgentPaneIds(projectId: string): string[] {
  return readHomeAgentMap()[projectId] ?? [];
}

export function readHomeAgentPaneId(projectId: string): string | null {
  const paneIds = readHomeAgentPaneIds(projectId);
  return paneIds[paneIds.length - 1] ?? null;
}

export function isHomeBoundAgentPane(projectId: string, paneId: string): boolean {
  return readHomeAgentPaneIds(projectId).includes(paneId);
}

export function isProjectSurfaceNotification(
  projectId: string,
  notifiedPaneId: string | undefined | null,
): boolean {
  if (!notifiedPaneId) {
    return false;
  }

  return !isHomeBoundAgentPane(projectId, notifiedPaneId);
}

export function filterProjectSurfaceNotifications(
  notifiedAgentPaneByProject: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = {};

  for (const [projectId, paneId] of Object.entries(notifiedAgentPaneByProject)) {
    if (isProjectSurfaceNotification(projectId, paneId)) {
      next[projectId] = paneId;
    }
  }

  return next;
}

export function bindHomeDashboardProjectAgent(projectId: string, paneId: string): void {
  const queue = readHomeAgentQueue();
  const alreadyBound = queue.some(
    (binding) => binding.projectId === projectId && binding.paneId === paneId,
  );

  if (alreadyBound) {
    window.dispatchEvent(new CustomEvent(HOME_AGENT_FOCUS_EVENT, { detail: { paneId } }));
    return;
  }

  writeHomeAgentQueue([...queue, { projectId, paneId }]);
  window.dispatchEvent(new Event(HOME_AGENT_CHANGE_EVENT));
  window.dispatchEvent(new CustomEvent(HOME_AGENT_FOCUS_EVENT, { detail: { paneId } }));
}

export function forgetHomeDashboardProjectAgent(projectId: string, paneId?: string): void {
  const queue = readHomeAgentQueue();
  const filtered = paneId
    ? queue.filter((binding) => !(binding.projectId === projectId && binding.paneId === paneId))
    : queue.filter((binding) => binding.projectId !== projectId);

  if (filtered.length === queue.length) {
    return;
  }

  writeHomeAgentQueue(filtered);
  window.dispatchEvent(new Event(HOME_AGENT_CHANGE_EVENT));
}
