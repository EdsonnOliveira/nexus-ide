import type {
  ProjectTask,
  ProjectTaskJiraSubtask,
  TaskFilterCategory,
  TaskListFilters,
} from '@/types/task';
import { classifyTaskStatus } from '@/utils/taskLabels';
import {
  isLocalTaskCompleted,
  LOCAL_TASK_STATUS_DONE,
  LOCAL_TASK_STATUS_PENDING,
} from '@/utils/taskJson';

export const TASK_FILTER_NONE_PARENT = '__none__';
export const TASK_FILTER_UNASSIGNED = '__unassigned__';

export interface TaskSubtaskProgress {
  completed: number;
  total: number;
}

export interface TaskAssigneeAvatar {
  name: string;
  avatarUrl?: string;
}

export function buildTaskAssigneeAvatars(
  tasks: ProjectTask[],
  preferredName?: string,
): TaskAssigneeAvatar[] {
  const byName = new Map<string, string | undefined>();

  for (const task of tasks) {
    const name = task.jira?.assignee?.trim() || task.deepcrm?.assignee?.trim();

    if (!name) {
      continue;
    }

    const avatarUrl =
      task.jira?.assigneeAvatarUrl?.trim() || task.deepcrm?.assigneeAvatarUrl?.trim() || undefined;
    const current = byName.get(name);

    if (!byName.has(name) || (!current && avatarUrl)) {
      byName.set(name, avatarUrl);
    }
  }

  const preferred = preferredName?.trim();

  return Array.from(byName.entries())
    .map(([name, avatarUrl]) => ({ name, avatarUrl }))
    .sort((left, right) => {
      if (preferred) {
        if (left.name === preferred && right.name !== preferred) {
          return -1;
        }

        if (right.name === preferred && left.name !== preferred) {
          return 1;
        }
      }

      return left.name.localeCompare(right.name, 'pt-BR');
    });
}

export function isJiraSubtaskTask(task: ProjectTask): boolean {
  if (task.source !== 'jira') {
    return false;
  }

  if (task.jira?.isSubtask === true) {
    return true;
  }

  const issueType = task.jira?.issueType?.trim().toLowerCase() ?? '';

  if (!issueType) {
    return false;
  }

  return (
    issueType === 'sub-task' ||
    issueType === 'subtask' ||
    issueType === 'subtarefa' ||
    issueType.includes('sub-task') ||
    issueType.includes('subtask') ||
    issueType.includes('subtarefa')
  );
}

export function resolveTaskSubtasks(
  task: ProjectTask,
  relatedTasks: ProjectTask[] = [],
): ProjectTaskJiraSubtask[] {
  if (task.source !== 'jira') {
    return [];
  }

  const parentKey = task.externalId ?? task.id;
  const fromRelated = relatedTasks.filter(
    (item) => item.jira?.parentKey === parentKey && isJiraSubtaskTask(item),
  );
  const fromMeta = task.jira?.subtasks ?? [];

  if (fromMeta.length > 0) {
    return fromMeta.map((subtask) => {
      const related = fromRelated.find((item) => item.externalId === subtask.key);

      return {
        key: subtask.key,
        title: related?.title ?? subtask.title,
        status: related?.status ?? subtask.status,
        assignee: related?.jira?.assignee ?? subtask.assignee,
        assigneeAvatarUrl: related?.jira?.assigneeAvatarUrl ?? subtask.assigneeAvatarUrl,
      };
    });
  }

  return fromRelated.map((item) => ({
    key: item.externalId ?? item.id,
    title: item.title,
    status: item.status,
    assignee: item.jira?.assignee,
    assigneeAvatarUrl: item.jira?.assigneeAvatarUrl,
  }));
}

export function getTaskSubtaskProgress(
  task: ProjectTask,
  relatedTasks: ProjectTask[] = [],
): TaskSubtaskProgress | null {
  if (task.source === 'deepcrm') {
    const total = task.deepcrm?.totalTaskCount;
    const pending = task.deepcrm?.pendingTaskCount;

    if (typeof total !== 'number' || total <= 0 || typeof pending !== 'number') {
      return null;
    }

    return {
      completed: Math.max(0, total - pending),
      total,
    };
  }

  const subtasks = resolveTaskSubtasks(task, relatedTasks);

  if (subtasks.length === 0) {
    return null;
  }

  const completed = subtasks.filter(
    (subtask) => classifyTaskStatus(subtask.status ?? '') === 'done',
  ).length;

  return {
    completed,
    total: subtasks.length,
  };
}

export const EMPTY_TASK_FILTERS: TaskListFilters = {
  parent: [],
  assignee: [],
  issueType: [],
  categories: [],
  status: [],
  priority: [],
};

export const TASK_FILTER_CATEGORIES: Array<{ id: TaskFilterCategory; label: string }> = [
  { id: 'parent', label: 'Pai' },
  { id: 'assignee', label: 'Responsável' },
  { id: 'issueType', label: 'Tipo do ticket' },
  { id: 'categories', label: 'Categorias' },
  { id: 'status', label: 'Status' },
  { id: 'priority', label: 'Prioridade' },
];

export interface TaskFilterOption {
  value: string;
  label: string;
}

export function hasActiveTaskFilters(filters: TaskListFilters): boolean {
  return Object.values(filters).some((values) => values.length > 0);
}

export function countActiveTaskFilters(filters: TaskListFilters): number {
  return Object.values(filters).reduce((total, values) => total + values.length, 0);
}

export function getTaskFilterSearchPlaceholder(category: TaskFilterCategory): string {
  if (category === 'parent') {
    return 'Pesquisar pai';
  }

  if (category === 'assignee') {
    return 'Pesquisar responsável';
  }

  if (category === 'issueType') {
    return 'Pesquisar tipo';
  }

  if (category === 'categories') {
    return 'Pesquisar categorias';
  }

  if (category === 'status') {
    return 'Pesquisar status';
  }

  return 'Pesquisar prioridade';
}

export function buildDefaultTaskFilters(
  tasks: ProjectTask[],
  jiraAccountName?: string,
): TaskListFilters {
  const assignee = [TASK_FILTER_UNASSIGNED];

  if (jiraAccountName?.trim()) {
    assignee.unshift(jiraAccountName.trim());
  }

  return {
    parent: [],
    assignee,
    issueType: [],
    categories: [],
    status: resolveDefaultStatuses(tasks),
    priority: [],
  };
}

function resolveDefaultStatuses(tasks: ProjectTask[]): string[] {
  const statuses = new Set<string>();

  for (const task of tasks) {
    if (task.status?.trim()) {
      statuses.add(task.status.trim());
    }
  }

  const defaults: string[] = [];

  if (statuses.has('Tarefas pendentes')) {
    defaults.push('Tarefas pendentes');
  } else {
    for (const status of statuses) {
      if (/pendente/i.test(status)) {
        defaults.push(status);
        break;
      }
    }
  }

  if (statuses.has('Em andamento')) {
    defaults.push('Em andamento');
  } else {
    for (const status of statuses) {
      if (/em andamento|in progress/i.test(status) && !defaults.includes(status)) {
        defaults.push(status);
        break;
      }
    }
  }

  return defaults;
}

export function areTaskFiltersEqual(left: TaskListFilters, right: TaskListFilters): boolean {
  const categories: TaskFilterCategory[] = [
    'parent',
    'assignee',
    'issueType',
    'categories',
    'status',
    'priority',
  ];

  return categories.every((category) => {
    const leftValues = [...left[category]].sort();
    const rightValues = [...right[category]].sort();

    if (leftValues.length !== rightValues.length) {
      return false;
    }

    return leftValues.every((value, index) => value === rightValues[index]);
  });
}

export function buildTaskFilterOptions(
  tasks: ProjectTask[],
  category: TaskFilterCategory,
): TaskFilterOption[] {
  if (category === 'parent') {
    const options = new Map<string, string>();

    for (const task of tasks) {
      if (task.source !== 'jira') {
        continue;
      }

      if (task.jira?.parentKey) {
        const label = task.jira.parentSummary
          ? `${task.jira.parentKey} · ${task.jira.parentSummary}`
          : task.jira.parentKey;
        options.set(task.jira.parentKey, label);
        continue;
      }

      options.set(TASK_FILTER_NONE_PARENT, 'Nenhum pai');
    }

    return Array.from(options.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label, 'pt-BR'));
  }

  if (category === 'assignee') {
    const options = new Map<string, string>();

    for (const task of tasks) {
      if (task.source !== 'jira') {
        continue;
      }

      if (task.jira?.assignee) {
        options.set(task.jira.assignee, task.jira.assignee);
        continue;
      }

      options.set(TASK_FILTER_UNASSIGNED, 'Não atribuído');
    }

    return Array.from(options.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label, 'pt-BR'));
  }

  if (category === 'issueType') {
    return collectUniqueValues(tasks, (task) => task.jira?.issueType);
  }

  if (category === 'categories') {
    const labels = new Set<string>();

    for (const task of tasks) {
      for (const label of task.jira?.labels ?? []) {
        labels.add(label);
      }

      for (const label of task.deepcrm?.labels ?? []) {
        labels.add(label);
      }

      for (const label of task.local?.labels ?? []) {
        labels.add(label);
      }
    }

    return Array.from(labels)
      .sort((left, right) => left.localeCompare(right, 'pt-BR'))
      .map((value) => ({ value, label: value }));
  }

  if (category === 'status') {
    return collectUniqueValues(tasks, (task) => task.status);
  }

  return collectUniqueValues(
    tasks,
    (task) => task.jira?.priority ?? task.deepcrm?.priority ?? task.local?.priority,
  );
}

function collectUniqueValues(
  tasks: ProjectTask[],
  getValue: (task: ProjectTask) => string | undefined,
): TaskFilterOption[] {
  const values = new Set<string>();

  for (const task of tasks) {
    const value = getValue(task)?.trim();

    if (value) {
      values.add(value);
    }
  }

  return Array.from(values)
    .sort((left, right) => left.localeCompare(right, 'pt-BR'))
    .map((value) => ({ value, label: value }));
}

function collectJiraSubtaskKeys(tasks: ProjectTask[]): Set<string> {
  const keys = new Set<string>();

  for (const task of tasks) {
    for (const subtask of task.jira?.subtasks ?? []) {
      keys.add(subtask.key);
    }
  }

  return keys;
}

export function filterProjectTasks(
  tasks: ProjectTask[],
  query: string,
  filters: TaskListFilters,
): ProjectTask[] {
  const normalizedQuery = query.trim().toLowerCase();
  const jiraSubtaskKeys = collectJiraSubtaskKeys(tasks);

  const filtered = tasks.filter((task) => {
    if (
      isJiraSubtaskTask(task) ||
      (task.externalId ? jiraSubtaskKeys.has(task.externalId) : false)
    ) {
      return false;
    }

    if (normalizedQuery) {
      const haystack = [
        task.title,
        task.description,
        task.externalId ?? '',
        task.status ?? '',
        task.jira?.parentKey ?? '',
        task.jira?.parentSummary ?? '',
        task.jira?.assignee ?? '',
        task.jira?.issueType ?? '',
        task.jira?.priority ?? '',
        task.deepcrm?.priority ?? '',
        task.local?.priority ?? '',
        ...(task.jira?.labels ?? []),
        ...(task.deepcrm?.labels ?? []),
        ...(task.local?.labels ?? []),
      ]
        .join(' ')
        .toLowerCase();

      if (!haystack.includes(normalizedQuery)) {
        return false;
      }
    }

    return matchesTaskFilters(task, filters);
  });

  const result = filters.status.includes(LOCAL_TASK_STATUS_DONE)
    ? filtered
    : filtered.filter((task) => !isLocalTaskCompleted(task));

  return [...result].sort(compareProjectTasksByStatus);
}

function taskStatusSortRank(status?: string): number {
  const kind = status ? classifyTaskStatus(status) : null;

  if (kind === 'progress') {
    return 0;
  }

  if (kind === 'pending') {
    return 1;
  }

  if (kind === 'done') {
    return 3;
  }

  return 2;
}

function compareProjectTasksByStatus(left: ProjectTask, right: ProjectTask): number {
  const rankDiff = taskStatusSortRank(left.status) - taskStatusSortRank(right.status);

  if (rankDiff !== 0) {
    return rankDiff;
  }

  return right.updatedAt - left.updatedAt;
}

function matchesTaskFilters(task: ProjectTask, filters: TaskListFilters): boolean {
  if (!matchesStatusFilter(task, filters.status)) {
    return false;
  }

  if (filters.categories.length > 0) {
    const labels = task.jira?.labels ?? task.deepcrm?.labels ?? task.local?.labels ?? [];

    if (!filters.categories.some((category) => labels.includes(category))) {
      return false;
    }
  }

  if (filters.priority.length > 0) {
    const priority = task.jira?.priority ?? task.deepcrm?.priority ?? task.local?.priority;

    if (!priority || !filters.priority.includes(priority)) {
      return false;
    }
  }

  if (task.source !== 'jira') {
    return true;
  }

  if (filters.parent.length > 0) {
    const parentValue = task.jira?.parentKey ?? TASK_FILTER_NONE_PARENT;

    if (!filters.parent.includes(parentValue)) {
      return false;
    }
  }

  if (filters.assignee.length > 0) {
    const assigneeValue = task.jira?.assignee ?? TASK_FILTER_UNASSIGNED;

    if (!filters.assignee.includes(assigneeValue)) {
      return false;
    }
  }

  if (filters.issueType.length > 0) {
    const issueType = task.jira?.issueType;

    if (!issueType || !filters.issueType.includes(issueType)) {
      return false;
    }
  }

  return true;
}

function matchesStatusFilter(task: ProjectTask, statuses: string[]): boolean {
  if (statuses.length === 0) {
    return true;
  }

  const taskStatus =
    task.status?.trim() || (task.source === 'local' ? LOCAL_TASK_STATUS_PENDING : '');

  if (!taskStatus) {
    return false;
  }

  if (statuses.includes(taskStatus)) {
    return true;
  }

  const taskKind = classifyTaskStatus(taskStatus);

  if (!taskKind) {
    return false;
  }

  return statuses.some((status) => classifyTaskStatus(status) === taskKind);
}

export function countProjectTasksForToolbarBadge(
  tasks: ProjectTask[],
  options: { useDefaultFilters: boolean; jiraAccountName?: string },
): number {
  const filters = options.useDefaultFilters
    ? buildDefaultTaskFilters(tasks, options.jiraAccountName)
    : EMPTY_TASK_FILTERS;

  return filterProjectTasks(tasks, '', filters).length;
}
