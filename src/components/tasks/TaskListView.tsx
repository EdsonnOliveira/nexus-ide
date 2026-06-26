import { ClipboardPaste, ListFilter, Plus, Search, Settings2, ListTodo } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/components/overlay/EmptyState';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { TaskContextMenu } from '@/components/tasks/TaskContextMenu';
import { TaskFilterModal } from '@/components/tasks/TaskFilterModal';
import { TaskListItem } from '@/components/tasks/TaskListItem';
import type { ProjectTask, TaskListFilters } from '@/types/task';
import {
  areTaskFiltersEqual,
  buildDefaultTaskFilters,
  countActiveTaskFilters,
  EMPTY_TASK_FILTERS,
  filterProjectTasks,
} from '@/utils/taskFilters';

interface TaskListViewProps {
  projectId: string;
  tasks: ProjectTask[];
  isSyncing: boolean;
  syncError: string | null;
  hasIntegration: boolean;
  useDefaultFilters: boolean;
  jiraAccountName?: string;
  onCreate: () => void;
  onImportJson: () => void;
  onView: (task: ProjectTask) => void;
  onExecute: (task: ProjectTask) => void;
  onCopyJson: (task: ProjectTask) => void;
  onCompleteTask: (task: ProjectTask) => void;
  onReopenTask: (task: ProjectTask) => void;
  onDeleteTask: (task: ProjectTask) => void;
  onOpenIntegration: () => void;
}

interface ContextMenuState {
  task: ProjectTask;
  x: number;
  y: number;
}

function TaskListViewComponent({
  projectId,
  tasks,
  isSyncing,
  syncError,
  hasIntegration,
  useDefaultFilters,
  jiraAccountName,
  onCreate,
  onImportJson,
  onView,
  onExecute,
  onCopyJson,
  onCompleteTask,
  onReopenTask,
  onDeleteTask,
  onOpenIntegration,
}: TaskListViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<TaskListFilters>(EMPTY_TASK_FILTERS);
  const [filtersCustomized, setFiltersCustomized] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectTask | null>(null);

  const defaultFilters = useMemo(
    () => (useDefaultFilters ? buildDefaultTaskFilters(tasks, jiraAccountName) : EMPTY_TASK_FILTERS),
    [jiraAccountName, tasks, useDefaultFilters],
  );

  useEffect(() => {
    setFiltersCustomized(false);
    setSearchQuery('');
  }, [projectId]);

  useEffect(() => {
    if (filtersCustomized) {
      return;
    }

    setFilters(defaultFilters);
  }, [defaultFilters, filtersCustomized]);

  const filteredTasks = useMemo(
    () => filterProjectTasks(tasks, searchQuery, filters),
    [filters, searchQuery, tasks],
  );

  const activeFilterCount = useMemo(() => countActiveTaskFilters(filters), [filters]);

  const handleApplyFilters = useCallback(
    (nextFilters: TaskListFilters) => {
      setFilters(nextFilters);
      setFiltersCustomized(!areTaskFiltersEqual(nextFilters, defaultFilters));
      setFilterOpen(false);
    },
    [defaultFilters],
  );

  const handleContextMenu = useCallback((task: ProjectTask, x: number, y: number) => {
    setContextMenu({ task, x, y });
  }, []);

  const handleCopyJson = useCallback(
    (task: ProjectTask) => {
      onCopyJson(task);
      setContextMenu(null);
    },
    [onCopyJson],
  );

  const handleCompleteTask = useCallback(
    (task: ProjectTask) => {
      onCompleteTask(task);
      setContextMenu(null);
    },
    [onCompleteTask],
  );

  const handleReopenTask = useCallback(
    (task: ProjectTask) => {
      onReopenTask(task);
      setContextMenu(null);
    },
    [onReopenTask],
  );

  const handleDeleteRequest = useCallback((task: ProjectTask) => {
    setDeleteTarget(task);
    setContextMenu(null);
  }, []);

  const handleDeleteConfirm = useCallback(
    (requestClose: () => void) => {
      if (!deleteTarget) {
        return;
      }

      onDeleteTask(deleteTarget);
      requestClose();
      setDeleteTarget(null);
    },
    [deleteTarget, onDeleteTask],
  );

  return (
    <>
      <div className='project-explorer__header'>
        <span className='project-explorer__title'>Tarefas</span>
        <div className='tasks-drawer__header-actions'>
          {hasIntegration && isSyncing ? (
            <span className='tasks-drawer__sync-status'>Sincronizando…</span>
          ) : null}
          {hasIntegration && syncError ? (
            <span className='tasks-drawer__sync-error'>{syncError}</span>
          ) : null}
          <button
            type='button'
            className='project-explorer__header-btn app-button app-button--enter'
            aria-label='Configurar integração'
            onClick={onOpenIntegration}
          >
            <Settings2 size={14} strokeWidth={2} />
          </button>
          <button
            type='button'
            className='project-explorer__header-btn app-button app-button--enter'
            aria-label='Colar JSON'
            onClick={onImportJson}
          >
            <ClipboardPaste size={14} strokeWidth={2} />
          </button>
          <button
            type='button'
            className='project-explorer__header-btn app-button app-button--enter'
            aria-label='Nova tarefa'
            onClick={onCreate}
          >
            <Plus size={14} strokeWidth={2} />
          </button>
        </div>
      </div>
      <div className='tasks-drawer__toolbar'>
        <label className='tasks-drawer__search-field'>
          <Search size={14} strokeWidth={2} aria-hidden />
          <input
            className='tasks-drawer__search-input'
            value={searchQuery}
            placeholder='Pesquisar tarefas'
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>
        <button
          type='button'
          className={`tasks-drawer__filter-btn app-button app-button--enter${activeFilterCount > 0 ? ' tasks-drawer__filter-btn--active' : ''}`}
          aria-label={
            activeFilterCount > 0
              ? `Filtrar tarefas (${activeFilterCount} selecionados)`
              : 'Filtrar tarefas'
          }
          onClick={() => setFilterOpen(true)}
        >
          <ListFilter size={14} strokeWidth={2} />
          {activeFilterCount > 0 ? (
            <span className='tasks-drawer__filter-badge'>{activeFilterCount}</span>
          ) : null}
        </button>
      </div>
      <div className='tasks-drawer__list'>
        {filteredTasks.length === 0 ? (
          <EmptyState
            icon={ListTodo}
            message={tasks.length === 0 ? 'Nenhuma tarefa cadastrada' : 'Nenhuma tarefa encontrada'}
            compact
            className='tasks-drawer__empty'
          />
        ) : (
          filteredTasks.map((task) => (
            <TaskListItem
              key={task.externalId ?? task.id}
              task={task}
              onView={onView}
              onExecute={onExecute}
              onContextMenu={handleContextMenu}
            />
          ))
        )}
      </div>
      {contextMenu ? (
        <TaskContextMenu
          task={contextMenu.task}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onCopyJson={handleCopyJson}
          onComplete={handleCompleteTask}
          onReopen={handleReopenTask}
          onDelete={handleDeleteRequest}
        />
      ) : null}
      {deleteTarget ? (
        <AnimatedModal onClose={() => setDeleteTarget(null)} panelClassName='project-dialog'>
          {(requestClose) => (
            <>
              <span className='project-dialog__title'>Excluir tarefa</span>
              <p className='project-dialog__message'>
                Tem certeza que deseja excluir <strong>{deleteTarget.title}</strong>?
              </p>
              <div className='project-dialog__actions'>
                <button
                  type='button'
                  className='project-dialog__btn project-dialog__btn--ghost app-button'
                  onClick={requestClose}
                >
                  Cancelar
                </button>
                <button
                  type='button'
                  className='project-dialog__btn project-dialog__btn--danger app-button'
                  onClick={() => handleDeleteConfirm(requestClose)}
                >
                  Excluir
                </button>
              </div>
            </>
          )}
        </AnimatedModal>
      ) : null}
      {filterOpen ? (
        <TaskFilterModal
          tasks={tasks}
          filters={filters}
          onClose={() => setFilterOpen(false)}
          onApply={handleApplyFilters}
        />
      ) : null}
    </>
  );
}

export const TaskListView = memo(TaskListViewComponent);
