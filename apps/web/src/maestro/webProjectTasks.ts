import type { CloudProject } from '@nexus/protocol';

export type WebTaskSource = 'local' | 'jira' | 'trello' | 'deepcrm';

export interface WebProjectTask {
  id: string;
  source: WebTaskSource;
  externalId?: string;
  title: string;
  description: string;
  status?: string;
  labels: string[];
  priority?: string;
  assignee?: string;
  assigneeAvatarUrl?: string;
  parentKey?: string;
  parentSummary?: string;
  issueType?: string;
  dueDate?: string;
  updatedAt: number;
}

export interface WebTaskIntegration {
  platform?: string;
  jiraSiteUrl?: string;
  jiraAccountName?: string;
  jiraProjectKey?: string;
  syncEnabled?: boolean;
}

const TASK_TAG_BORDER_COLORS = [
  '#94a3b8',
  '#f472b6',
  '#60a5fa',
  '#fbbf24',
  '#34d399',
  '#a78bfa',
  '#fb7185',
  '#f97316',
];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function asSource(value: unknown): WebTaskSource {
  if (value === 'jira' || value === 'trello' || value === 'deepcrm' || value === 'local') {
    return value;
  }
  return 'local';
}

function normalizeStatus(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function isWebTaskCompleted(task: WebProjectTask): boolean {
  if (task.source !== 'local') {
    return false;
  }
  const status = task.status?.trim();
  if (!status) {
    return false;
  }
  return normalizeStatus(status) === 'concluido' || normalizeStatus(status) === 'done';
}

export function getWebTaskTagBorderColor(label: string): string {
  let hash = 0;
  for (const char of label) {
    hash = (hash + char.charCodeAt(0)) % TASK_TAG_BORDER_COLORS.length;
  }
  return TASK_TAG_BORDER_COLORS[hash] ?? TASK_TAG_BORDER_COLORS[0];
}

export function formatWebTaskSource(source: WebTaskSource): string {
  if (source === 'jira') {
    return 'Jira';
  }
  if (source === 'trello') {
    return 'Trello';
  }
  if (source === 'deepcrm') {
    return 'DeepCRM';
  }
  return 'Local';
}

export function buildWebTaskPrompt(task: WebProjectTask): string {
  const lines = [`# ${task.title.trim()}`, ''];
  if (task.priority?.trim()) {
    lines.push(`Prioridade: ${task.priority.trim()}`, '');
  }
  if (task.labels.length > 0) {
    lines.push(`Tags: ${task.labels.join(', ')}`, '');
  }
  if (task.description.trim()) {
    lines.push(task.description.trim(), '');
  }
  return lines.join('\n').trim();
}

export function resolveCloudProjectTasks(project: CloudProject | null | undefined): WebProjectTask[] {
  const raw = project?.metadata?.tasks;
  if (!Array.isArray(raw)) {
    return [];
  }

  const tasks: WebProjectTask[] = [];

  for (const item of raw) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    const id = asString(record.id);
    const title = asString(record.title);
    if (!id || !title) {
      continue;
    }

    const jira = asRecord(record.jira);
    const deepcrm = asRecord(record.deepcrm);
    const local = asRecord(record.local);
    const source = asSource(record.source);
    const jiraLabels = asStringArray(jira?.labels);
    const deepcrmLabels = asStringArray(deepcrm?.labels);
    const localLabels = asStringArray(local?.labels);

    tasks.push({
      id,
      source,
      externalId: asString(record.externalId),
      title,
      description: asString(record.description) ?? '',
      status: asString(record.status),
      labels:
        jiraLabels.length > 0
          ? jiraLabels
          : deepcrmLabels.length > 0
            ? deepcrmLabels
            : localLabels,
      priority:
        asString(jira?.priority) ?? asString(deepcrm?.priority) ?? asString(local?.priority),
      assignee: asString(jira?.assignee) ?? asString(deepcrm?.assignee),
      assigneeAvatarUrl:
        asString(jira?.assigneeAvatarUrl) ?? asString(deepcrm?.assigneeAvatarUrl),
      parentKey: asString(jira?.parentKey),
      parentSummary: asString(jira?.parentSummary),
      issueType: asString(jira?.issueType),
      dueDate: asString(local?.dueDate) ?? asString(jira?.dueDate) ?? asString(deepcrm?.dueDate),
      updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0,
    });
  }

  return tasks
    .filter((task) => !isWebTaskCompleted(task))
    .sort((left, right) => {
      if (right.updatedAt !== left.updatedAt) {
        return right.updatedAt - left.updatedAt;
      }
      return (left.externalId ?? left.title).localeCompare(
        right.externalId ?? right.title,
        'pt-BR',
        { sensitivity: 'base' },
      );
    });
}

export function resolveCloudTaskIntegration(
  project: CloudProject | null | undefined,
): WebTaskIntegration | null {
  const raw = project?.metadata?.taskIntegration;
  const record = asRecord(raw);
  if (!record) {
    return null;
  }
  return {
    platform: asString(record.platform),
    jiraSiteUrl: asString(record.jiraSiteUrl),
    jiraAccountName: asString(record.jiraAccountName),
    jiraProjectKey: asString(record.jiraProjectKey),
    syncEnabled: record.syncEnabled === true,
  };
}

export function buildWebJiraIssueUrl(siteUrl: string | undefined, issueKey: string | undefined): string | null {
  const site = siteUrl?.trim().replace(/\/+$/, '');
  const key = issueKey?.trim();
  if (!site || !key) {
    return null;
  }
  return `${site}/browse/${encodeURIComponent(key)}`;
}

export function formatWebTaskDate(value?: string): string {
  if (!value?.trim()) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
