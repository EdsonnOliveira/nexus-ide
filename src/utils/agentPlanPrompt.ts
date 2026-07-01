import type { AgentActivity, AgentPlanTodo } from '@/types';

function slugifyPlanToken(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || 'todo';
}

function readPlanStringField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

export function normalizePlanTodo(raw: unknown, index: number): AgentPlanTodo | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const item = raw as Record<string, unknown>;
  const content = readPlanStringField(item, ['content', 'text', 'label', 'title']);

  if (!content) {
    return null;
  }

  const id = readPlanStringField(item, ['id']) || slugifyPlanToken(content || `todo_${index + 1}`);
  const status = item.status === 'done' ? 'done' : 'pending';

  return { id, content, status };
}

export function normalizePlanTodos(raw: unknown): AgentPlanTodo[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry, index) => normalizePlanTodo(entry, index))
    .filter((entry): entry is AgentPlanTodo => Boolean(entry));
}

export function parsePlanTodosFromMarkdown(planBody: string): AgentPlanTodo[] {
  const lines = planBody.split('\n');
  const todos: AgentPlanTodo[] = [];

  for (const line of lines) {
    const match = line.match(/^\s*[-*]\s*\[[ xX]\]\s+(.+)$/);

    if (match?.[1]) {
      const content = match[1].trim();
      todos.push({
        id: slugifyPlanToken(content),
        content,
        status: /^\s*[-*]\s*\[[xX]\]/.test(line) ? 'done' : 'pending',
      });
    }
  }

  return todos;
}

export function buildAgentPlanImplementPrompt(planBody: string, planName?: string): string {
  const sections = ['Implement the plan below. Follow the todos in order.', ''];

  if (planName?.trim()) {
    sections.push(planName.trim(), '');
  }

  sections.push(planBody.trim());
  return sections.join('\n');
}

export function stripPlanUriScheme(planUri: string): string {
  return planUri.trim().replace(/^file:\/\//, '');
}

export async function resolvePlanBodyFromUri(planUri: string): Promise<string | null> {
  const filePath = stripPlanUriScheme(planUri);

  if (!filePath) {
    return null;
  }

  const result = await window.nexus.files.readTextFile(filePath);

  if (!result.ok) {
    return null;
  }

  return result.content.trim() || null;
}

export function hasPendingAgentPlan(activities: { kind: string; planStatus?: string }[]): boolean {
  return activities.some((entry) => entry.kind === 'plan' && entry.planStatus === 'pending');
}

export function findPendingAgentPlanActivity<T extends { kind: string; planStatus?: string }>(
  activities: T[],
): T | undefined {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const entry = activities[index];

    if (entry?.kind === 'plan' && entry.planStatus === 'pending') {
      return entry;
    }
  }

  return undefined;
}

export function finalizeBuildingAgentPlans<T extends { activities: AgentActivity[] }>(turns: T[]): T[] {
  return turns.map((turn) => {
    let turnChanged = false;

    const nextActivities = turn.activities.map((entry) => {
      if (entry.kind !== 'plan' || entry.planStatus !== 'building') {
        return entry;
      }

      turnChanged = true;
      return { ...entry, planStatus: 'accepted' as const };
    });

    if (!turnChanged) {
      return turn;
    }

    return { ...turn, activities: nextActivities };
  });
}

export function hasBuildingAgentPlans(turns: { activities: AgentActivity[] }[]): boolean {
  return turns.some((turn) =>
    turn.activities.some((entry) => entry.kind === 'plan' && entry.planStatus === 'building'),
  );
}

export function repairStaleBuildingAgentPlans<T extends { activities: AgentActivity[] }>(turns: T[]): T[] {
  return turns.map((turn, turnIndex) => {
    if (turnIndex >= turns.length - 1) {
      return turn;
    }

    let turnChanged = false;

    const nextActivities = turn.activities.map((entry) => {
      if (entry.kind !== 'plan' || entry.planStatus !== 'building') {
        return entry;
      }

      turnChanged = true;
      return { ...entry, planStatus: 'accepted' as const };
    });

    if (!turnChanged) {
      return turn;
    }

    return { ...turn, activities: nextActivities };
  });
}

function normalizeComparableText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function isDuplicatePlanResponse(planBody: string, responseText: string): boolean {
  const plan = normalizeComparableText(planBody);
  const response = normalizeComparableText(responseText);

  if (!plan || !response) {
    return false;
  }

  if (plan === response) {
    return true;
  }

  const shorter = plan.length <= response.length ? plan : response;
  const longer = plan.length <= response.length ? response : plan;

  if (shorter.length >= 80 && longer.includes(shorter.slice(0, Math.floor(shorter.length * 0.8)))) {
    return true;
  }

  return shorter.length / longer.length >= 0.8 && longer.startsWith(shorter.slice(0, 64));
}

export function deduplicatePlanResponseActivities(activities: AgentActivity[]): AgentActivity[] {
  const planBodies = activities
    .filter((entry) => entry.kind === 'plan')
    .map((entry) => entry.planBody?.trim())
    .filter((entry): entry is string => Boolean(entry));

  if (planBodies.length === 0) {
    return activities;
  }

  return activities.filter((entry) => {
    if (entry.kind !== 'response') {
      return true;
    }

    return !planBodies.some((planBody) => isDuplicatePlanResponse(planBody, entry.label));
  });
}
