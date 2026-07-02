import type { LucideIcon } from 'lucide-react';
import { ChevronDown, ChevronUp, ChevronsDown, ChevronsUp, Minus } from 'lucide-react';
import type { ProjectTask, TaskAttachment, TaskSource } from '@/types/task';
import { stripMarkdownSyntax } from '@/utils/markdownPreview';

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

export interface TaskPriorityVisual {
  label: string;
  className: string;
  Icon: LucideIcon;
}

export const LOCAL_TASK_PRIORITY_OPTIONS = [
  { value: 'Muito alta', label: 'Muito alta' },
  { value: 'Alta', label: 'Alta' },
  { value: 'Média', label: 'Média' },
  { value: 'Baixa', label: 'Baixa' },
  { value: 'Muito baixa', label: 'Muito baixa' },
] as const;

export function toDatetimeLocalInputValue(value?: string): string {
  if (!value?.trim()) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const pad = (part: number) => String(part).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDatetimeLocalInputValue(value: string): string | undefined {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  const date = new Date(trimmed);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
}

export function formatTaskSource(source: TaskSource): string {
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

export function getTaskTagBorderColor(label: string): string {
  let hash = 0;

  for (const char of label) {
    hash = (hash + char.charCodeAt(0)) % TASK_TAG_BORDER_COLORS.length;
  }

  return TASK_TAG_BORDER_COLORS[hash] ?? TASK_TAG_BORDER_COLORS[0];
}

export function resolveTaskCoverAttachment(task: ProjectTask): TaskAttachment | undefined {
  return task.attachments.find((attachment) => attachment.kind === 'image');
}

export function resolveTaskPriorityVisual(priority?: string): TaskPriorityVisual | null {
  const normalized = priority?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (
    normalized.includes('highest') ||
    normalized.includes('muitíssima alta') ||
    normalized.includes('muitissima alta') ||
    normalized.includes('muito alta')
  ) {
    return {
      label: priority!.trim(),
      className: 'tasks-drawer__priority--highest',
      Icon: ChevronsUp,
    };
  }

  if (
    normalized.includes('lowest') ||
    normalized.includes('muitíssima baixa') ||
    normalized.includes('muitissima baixa') ||
    normalized.includes('muito baixa')
  ) {
    return {
      label: priority!.trim(),
      className: 'tasks-drawer__priority--lowest',
      Icon: ChevronsDown,
    };
  }

  if (
    normalized.includes('high') ||
    normalized === 'alta' ||
    normalized.startsWith('alta ') ||
    normalized === 'high'
  ) {
    return {
      label: priority!.trim(),
      className: 'tasks-drawer__priority--high',
      Icon: ChevronUp,
    };
  }

  if (
    normalized.includes('low') ||
    normalized === 'baixa' ||
    normalized.startsWith('baixa ') ||
    normalized === 'low'
  ) {
    return {
      label: priority!.trim(),
      className: 'tasks-drawer__priority--low',
      Icon: ChevronDown,
    };
  }

  if (
    normalized.includes('medium') ||
    normalized.includes('média') ||
    normalized.includes('media') ||
    normalized === 'medium'
  ) {
    return {
      label: priority!.trim(),
      className: 'tasks-drawer__priority--medium',
      Icon: Minus,
    };
  }

  return {
    label: priority!.trim(),
    className: 'tasks-drawer__priority--medium',
    Icon: Minus,
  };
}

export function summarizeTaskDescription(description: string, maxLength = 72): string {
  const normalized = description.replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return 'Sem descrição';
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

export function resolveTaskDescriptionFirstLine(description: string): string {
  const firstLine = description.split(/\r?\n/)[0]?.trim() ?? '';
  return stripMarkdownSyntax(firstLine);
}

export function isImageAttachmentName(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif|heic|heif)$/i.test(name);
}

export function mergeProjectTasks(
  currentTasks: ProjectTask[],
  remoteTasks: ProjectTask[],
  hiddenExternalTaskIds: ReadonlySet<string> = new Set(),
): ProjectTask[] {
  const localTasks = currentTasks.filter((task) => task.source === 'local');
  const existingByExternalId = new Map(
    currentTasks
      .filter((task) => task.externalId)
      .map((task) => [task.externalId!, task]),
  );

  const mergedRemote = remoteTasks
    .filter((remote) => !remote.externalId || !hiddenExternalTaskIds.has(remote.externalId))
    .map((remote) => {
      const existing = remote.externalId ? existingByExternalId.get(remote.externalId) : undefined;

      if (!existing) {
        return remote;
      }

      return {
        ...remote,
        id: existing.id,
      };
    });

  return [...localTasks, ...mergedRemote];
}

function taskSyncSignature(task: ProjectTask): string {
  return JSON.stringify({
    source: task.source,
    externalId: task.externalId,
    title: task.title,
    description: task.description,
    status: task.status,
    local: task.local,
    jira: task.jira,
    deepcrm: task.deepcrm,
    attachments: task.attachments.map((item) => ({
      name: item.name,
      kind: item.kind,
      path: item.path,
    })),
  });
}

export function areProjectTasksEqual(left: ProjectTask[], right: ProjectTask[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const rightByKey = new Map(
    right.map((task) => [task.externalId ?? task.id, taskSyncSignature(task)]),
  );

  for (const task of left) {
    const key = task.externalId ?? task.id;

    if (rightByKey.get(key) !== taskSyncSignature(task)) {
      return false;
    }
  }

  return true;
}

export function formatTaskDate(value?: string): string {
  if (!value?.trim()) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatTaskHistoryDate(value?: string): string {
  if (!value?.trim()) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatHistoryEmptyValue(field: string): string {
  const normalized = field.trim().toLowerCase();

  if (
    normalized.includes('resolução') ||
    normalized.includes('resolucao') ||
    normalized.includes('prioridade') ||
    normalized.includes('priority') ||
    normalized === 'rank'
  ) {
    return 'Nenhuma';
  }

  return 'Nenhum';
}

export interface HistoryStatusBadge {
  label: string;
  className: string;
}

export function resolveHistoryStatusBadge(value: string): HistoryStatusBadge | null {
  const normalized = value.trim().toLowerCase();

  if (
    normalized === 'to do' ||
    normalized === 'pendente' ||
    normalized === 'a fazer' ||
    normalized === 'open' ||
    normalized === 'aberto'
  ) {
    return {
      label: value,
      className: 'task-detail-modal__history-badge--todo',
    };
  }

  if (
    normalized === 'in progress' ||
    normalized === 'em progresso' ||
    normalized.includes('progress')
  ) {
    return {
      label: value,
      className: 'task-detail-modal__history-badge--progress',
    };
  }

  if (
    normalized === 'done' ||
    normalized === 'concluído' ||
    normalized === 'concluido' ||
    normalized === 'concluída' ||
    normalized === 'concluida' ||
    normalized === 'resolved' ||
    normalized === 'resolvido'
  ) {
    return {
      label: value,
      className: 'task-detail-modal__history-badge--done',
    };
  }

  return null;
}

export function getTaskInitials(name?: string): string {
  const trimmed = name?.trim();

  if (!trimmed) {
    return '?';
  }

  const parts = trimmed.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
}
