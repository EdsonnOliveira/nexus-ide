import { ListTodo, Play, Plus, Search } from 'lucide-react';
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
} from 'react';
import {
  readTaskExecutionAnchor,
  type TaskExecutionAnchor,
} from '@/components/tasks/TaskAgentModeModal';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import { EmptyState } from '@/components/overlay/EmptyState';
import { ProjectIconMark } from '@/components/sidebar/ProjectIconMark';
import type { HomeDashboardTaskEntry } from '@/hooks/useHomeDashboardData';
import type { Project } from '@/types';
import { useToastStore } from '@/stores/useToastStore';
import {
  formatTaskMoveError,
  moveTaskToStatusKind,
  type BoardStatusKind,
} from '@/utils/moveTaskToStatusKind';
import { classifyTaskStatus, formatTaskSource } from '@/utils/taskLabels';

const BOARD_COLUMNS: Array<{ kind: BoardStatusKind; title: string }> = [
  { kind: 'pending', title: 'Pendente' },
  { kind: 'progress', title: 'Em andamento' },
  { kind: 'done', title: 'Concluído' },
];

const DRAG_MIME = 'application/x-nexus-home-task';

interface DragPayload {
  projectId: string;
  taskId: string;
}

interface HomeDashboardTasksBoardProps {
  projects: Project[];
  entries: HomeDashboardTaskEntry[];
  onOpen: (entry: HomeDashboardTaskEntry) => void;
  onExecute: (entry: HomeDashboardTaskEntry, anchor?: TaskExecutionAnchor | null) => void;
  onCreate: (projectId: string | null) => void;
}

interface BoardCardProps {
  entry: HomeDashboardTaskEntry;
  isDragging: boolean;
  isMoving: boolean;
  onOpen: (entry: HomeDashboardTaskEntry) => void;
  onExecute: (entry: HomeDashboardTaskEntry, anchor?: TaskExecutionAnchor | null) => void;
  onDragStart: (entry: HomeDashboardTaskEntry, event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

function resolveEntryKind(entry: HomeDashboardTaskEntry): BoardStatusKind {
  return classifyTaskStatus(entry.task.status ?? '') ?? 'pending';
}

function BoardCardComponent({
  entry,
  isDragging,
  isMoving,
  onOpen,
  onExecute,
  onDragStart,
  onDragEnd,
}: BoardCardProps) {
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setLogoSrc(null);
    setLogoFailed(false);

    if (!entry.project.logo || !window.nexus) {
      return;
    }

    void window.nexus.files.readImageAsDataUrl(entry.project.logo).then((dataUrl) => {
      if (cancelled) {
        return;
      }

      if (dataUrl) {
        setLogoSrc(dataUrl);
        return;
      }

      setLogoFailed(true);
    });

    return () => {
      cancelled = true;
    };
  }, [entry.project.logo]);

  const handleOpen = useCallback(() => {
    onOpen(entry);
  }, [entry, onOpen]);

  const handlePlay = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onExecute(entry, readTaskExecutionAnchor(event.currentTarget));
    },
    [entry, onExecute],
  );

  const handleDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      onDragStart(entry, event);
    },
    [entry, onDragStart],
  );

  const showLogo = Boolean(logoSrc) && !logoFailed;
  const showPlay = classifyTaskStatus(entry.task.status ?? '') !== 'done';
  const sourceLabel =
    entry.task.source === 'local' ? entry.project.name : formatTaskSource(entry.task.source);

  return (
    <div
      className={`home-dashboard__kanban-card app-button--enter${isDragging ? ' home-dashboard__kanban-card--dragging' : ''}${isMoving ? ' home-dashboard__kanban-card--moving' : ''}`}
      style={{
        ['--project-accent' as string]: entry.project.color,
        ['--card-accent' as string]: entry.project.color,
      }}
      draggable={!isMoving}
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
    >
      <button type='button' className='home-dashboard__kanban-card-main app-button' onClick={handleOpen}>
        <span className='home-dashboard__kanban-card-project-icon' aria-hidden='true'>
          {showLogo ? (
            <img src={logoSrc ?? undefined} alt='' className='home-dashboard__kanban-card-project-logo' />
          ) : (
            <span
              className='home-dashboard__kanban-card-project-fallback'
              style={{ backgroundColor: entry.project.color }}
            >
              <ProjectIconMark icon={entry.project.icon} />
            </span>
          )}
        </span>
        <span className='home-dashboard__kanban-card-copy'>
          <span className='home-dashboard__kanban-card-title'>{entry.task.title}</span>
          <span className='home-dashboard__kanban-card-meta'>
            <span className='home-dashboard__kanban-card-chip'>{entry.project.name}</span>
            {entry.task.externalId ? (
              <span className='home-dashboard__kanban-card-chip home-dashboard__kanban-card-chip--muted'>
                {entry.task.externalId}
              </span>
            ) : (
              <span className='home-dashboard__kanban-card-chip home-dashboard__kanban-card-chip--muted'>
                {sourceLabel}
              </span>
            )}
          </span>
        </span>
      </button>
      {showPlay ? (
        <button
          type='button'
          className='home-dashboard__kanban-card-play app-button app-button--enter'
          aria-label={`Executar ${entry.task.title}`}
          onClick={handlePlay}
        >
          <Play size={14} strokeWidth={2.25} />
        </button>
      ) : null}
    </div>
  );
}

const BoardCard = memo(BoardCardComponent);

function HomeDashboardTasksBoardComponent({
  projects,
  entries,
  onOpen,
  onExecute,
  onCreate,
}: HomeDashboardTasksBoardProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dropKind, setDropKind] = useState<BoardStatusKind | null>(null);
  const [movingKey, setMovingKey] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(searchQuery);

  const projectOptions = useMemo(
    () => projects.map((project) => ({ value: project.id, label: project.name })),
    [projects],
  );

  const filteredEntries = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();

    return entries.filter((entry) => {
      if (projectFilter && entry.project.id !== projectFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = `${entry.task.title} ${entry.task.externalId ?? ''} ${entry.project.name}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [deferredSearch, entries, projectFilter]);

  const columns = useMemo(() => {
    const grouped: Record<BoardStatusKind, HomeDashboardTaskEntry[]> = {
      pending: [],
      progress: [],
      done: [],
    };

    for (const entry of filteredEntries) {
      grouped[resolveEntryKind(entry)].push(entry);
    }

    return grouped;
  }, [filteredEntries]);

  const entryKey = useCallback(
    (entry: HomeDashboardTaskEntry) => `${entry.project.id}:${entry.task.id}`,
    [],
  );

  const handleDragStart = useCallback(
    (entry: HomeDashboardTaskEntry, event: DragEvent<HTMLDivElement>) => {
      const payload: DragPayload = {
        projectId: entry.project.id,
        taskId: entry.task.id,
      };

      event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
      event.dataTransfer.setData('text/plain', entry.task.title);
      event.dataTransfer.effectAllowed = 'move';
      setDraggingKey(entryKey(entry));
    },
    [entryKey],
  );

  const handleDragEnd = useCallback(() => {
    setDraggingKey(null);
    setDropKind(null);
  }, []);

  const handleColumnDragOver = useCallback((kind: BoardStatusKind, event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropKind(kind);
  }, []);

  const handleColumnDragLeave = useCallback((kind: BoardStatusKind, event: DragEvent<HTMLElement>) => {
    const related = event.relatedTarget as Node | null;

    if (related && event.currentTarget.contains(related)) {
      return;
    }

    setDropKind((current) => (current === kind ? null : current));
  }, []);

  const handleDrop = useCallback(
    (kind: BoardStatusKind, event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      setDropKind(null);
      setDraggingKey(null);

      const raw = event.dataTransfer.getData(DRAG_MIME);

      if (!raw) {
        return;
      }

      let payload: DragPayload;

      try {
        payload = JSON.parse(raw) as DragPayload;
      } catch {
        return;
      }

      const entry = entries.find(
        (item) => item.project.id === payload.projectId && item.task.id === payload.taskId,
      );

      if (!entry) {
        return;
      }

      if (resolveEntryKind(entry) === kind) {
        return;
      }

      const key = entryKey(entry);
      setMovingKey(key);

      void (async () => {
        try {
          await moveTaskToStatusKind(entry.project.id, entry.task, kind);
        } catch (error) {
          useToastStore.getState().showToast(formatTaskMoveError(error, entry.task.source));
        } finally {
          setMovingKey((current) => (current === key ? null : current));
        }
      })();
    },
    [entries, entryKey],
  );

  return (
    <section className='home-dashboard__kanban app-button--enter' aria-label='Kanban de tasks'>
      <div className='home-dashboard__kanban-toolbar'>
        <label className='home-dashboard__kanban-search'>
          <Search size={14} strokeWidth={2.1} aria-hidden='true' />
          <input
            type='search'
            className='home-dashboard__kanban-search-input'
            placeholder='Buscar tasks...'
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>
        <AnchoredSelect
          value={projectFilter}
          options={projectOptions}
          allowEmpty
          emptyLabel='Todos os projetos'
          onChange={setProjectFilter}
          triggerClassName='home-dashboard__kanban-project-select'
        />
        <button
          type='button'
          className='home-dashboard__kanban-add app-button app-button--enter'
          aria-label='Nova tarefa'
          title='Nova tarefa'
          disabled={projects.length === 0}
          onClick={() => onCreate(projectFilter || null)}
        >
          <Plus size={16} strokeWidth={2.25} />
          <span className='app-button__label'>Nova tarefa</span>
        </button>
      </div>

      {filteredEntries.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          message={entries.length === 0 ? 'Nenhuma task nos projetos' : 'Nenhuma task encontrada'}
          className='home-dashboard__kanban-empty'
          compact
        />
      ) : (
        <div className='home-dashboard__kanban-board'>
          {BOARD_COLUMNS.map((column) => {
            const columnEntries = columns[column.kind];

            return (
              <div
                key={column.kind}
                className={`home-dashboard__kanban-column${dropKind === column.kind ? ' home-dashboard__kanban-column--drop' : ''}`}
                onDragOver={(event) => handleColumnDragOver(column.kind, event)}
                onDragLeave={(event) => handleColumnDragLeave(column.kind, event)}
                onDrop={(event) => handleDrop(column.kind, event)}
              >
                <header className='home-dashboard__kanban-column-header'>
                  <h2 className='home-dashboard__kanban-column-title'>{column.title}</h2>
                  <span className='home-dashboard__kanban-column-count'>{columnEntries.length}</span>
                </header>
                <div className='home-dashboard__kanban-column-body'>
                  {columnEntries.length === 0 ? (
                    <div className='home-dashboard__kanban-column-empty'>Solte aqui</div>
                  ) : (
                    columnEntries.map((entry) => {
                      const key = entryKey(entry);

                      return (
                        <BoardCard
                          key={key}
                          entry={entry}
                          isDragging={draggingKey === key}
                          isMoving={movingKey === key}
                          onOpen={onOpen}
                          onExecute={onExecute}
                          onDragStart={handleDragStart}
                          onDragEnd={handleDragEnd}
                        />
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export const HomeDashboardTasksBoard = memo(HomeDashboardTasksBoardComponent);
