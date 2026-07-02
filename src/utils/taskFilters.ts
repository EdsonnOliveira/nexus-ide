import type { ProjectTask, TaskFilterCategory, TaskListFilters } from '@/types/task';
import { isLocalTaskCompleted, LOCAL_TASK_STATUS_DONE } from '@/utils/taskJson';

export const TASK_FILTER_NONE_PARENT = '__none__';
export const TASK_FILTER_UNASSIGNED = '__unassigned__';

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

  const pendingStatus = resolveDefaultPendingStatus(tasks);

  return {
    parent: [],
    assignee,
    issueType: [],
    categories: [],
    status: pendingStatus ? [pendingStatus] : [],
    priority: [],
  };
}

function resolveDefaultPendingStatus(tasks: ProjectTask[]): string | null {
  const statuses = new Set<string>();

  for (const task of tasks) {
    if (task.status?.trim()) {
      statuses.add(task.status.trim());
    }
  }

  if (statuses.has('Tarefas pendentes')) {
    return 'Tarefas pendentes';
  }

  for (const status of statuses) {
    if (/pendente/i.test(status)) {
      return status;
    }
  }

  return null;
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

export function filterProjectTasks(
  tasks: ProjectTask[],
  query: string,
  filters: TaskListFilters,
): ProjectTask[] {
  const normalizedQuery = query.trim().toLowerCase();

  const filtered = tasks.filter((task) => {
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

  if (filters.status.includes(LOCAL_TASK_STATUS_DONE)) {
    return filtered;
  }

  return filtered.filter((task) => !isLocalTaskCompleted(task));
}

function matchesTaskFilters(task: ProjectTask, filters: TaskListFilters): boolean {
  const hasJiraOnlyFilters =
    filters.parent.length > 0 ||
    filters.assignee.length > 0 ||
    filters.issueType.length > 0;

  if (filters.status.length > 0 && (!task.status || !filters.status.includes(task.status))) {
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
    return !hasJiraOnlyFilters;
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

export function countProjectTasksForToolbarBadge(
  tasks: ProjectTask[],
  options: { useDefaultFilters: boolean; jiraAccountName?: string },
): number {
  const filters = options.useDefaultFilters
    ? buildDefaultTaskFilters(tasks, options.jiraAccountName)
    : EMPTY_TASK_FILTERS;

  return filterProjectTasks(tasks, '', filters).length;
}
