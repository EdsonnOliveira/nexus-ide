import { AudioLines, Download, Loader2, Mic, Star } from 'lucide-react';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import { EmptyState } from '@/components/overlay/EmptyState';
import { HomeDashboardSection } from '@/components/home/HomeDashboardSection';
import { MacParakeetTranscriptionModal } from '@/components/home/MacParakeetTranscriptionModal';
import {
  HomeDashboardParakeetSkeleton,
  HomeDashboardSelectSkeleton,
} from '@/components/home/HomeDashboardSkeletons';
import { TaskFormModal } from '@/components/tasks/TaskFormModal';
import { TaskProjectPickerModal } from '@/components/tasks/TaskProjectPickerModal';
import { useHomeDashboardMacParakeet } from '@/hooks/useHomeDashboardMacParakeet';
import { useProjectStore } from '@/stores/useProjectStore';
import type { MacParakeetTranscriptionDetail, MacParakeetTranscriptionItem } from '@/types';
import type { ProjectTask } from '@/types/task';
import { formatNotificationRelativeTime } from '@/utils/notificationRelativeTime';
import {
  buildTaskDraftFromTranscription,
  formatMacParakeetDuration,
  resolveMacParakeetSourceAccent,
  resolveMacParakeetSourceLabel,
} from '@/utils/macParakeetLabels';

interface MacParakeetTaskFormState {
  projectId: string;
  task: ProjectTask;
}

function buildPreviewDetail(item: MacParakeetTranscriptionItem): MacParakeetTranscriptionDetail {
  return {
    ...item,
    transcript: '',
    conclusion: null,
    segments: [],
    sourceUrl: '',
  };
}

function HomeDashboardMacParakeetCardComponent() {
  const projects = useProjectStore((state) => state.projects);
  const activeWorkspaceId = useProjectStore((state) => state.activeWorkspaceId);
  const updateProject = useProjectStore((state) => state.updateProject);
  const {
    snapshot,
    transcriptions,
    loading,
    importing,
    hydrated,
    selectedSourceType,
    filterOptions,
    selectSourceType,
    importTranscriptions,
    loadDetail,
    openApp,
    renameTitle,
  } = useHomeDashboardMacParakeet(true);
  const [activeDetail, setActiveDetail] = useState<MacParakeetTranscriptionDetail | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const detailRequestRef = useRef(0);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [taskFormState, setTaskFormState] = useState<MacParakeetTaskFormState | null>(null);

  const visibleProjects = useMemo(() => {
    if (activeWorkspaceId === null) {
      return projects;
    }

    return projects.filter((project) => project.workspaceId === activeWorkspaceId);
  }, [activeWorkspaceId, projects]);

  const createTaskDisabled = visibleProjects.length === 0;

  const selectOptions = useMemo(
    () =>
      filterOptions
        .filter((option) => option.value !== '')
        .map((option) => ({ value: option.value, label: option.label })),
    [filterOptions],
  );

  const handleImportTranscriptions = useCallback(() => {
    void importTranscriptions();
  }, [importTranscriptions]);

  const headerActions = useMemo(() => {
    if (!snapshot.installed) {
      return null;
    }

    if (!hydrated) {
      return <HomeDashboardSelectSkeleton />;
    }

    return (
      <div className='home-dashboard__parakeet-header-actions'>
        <button
          type='button'
          className='home-dashboard__parakeet-import app-button app-button--enter'
          aria-label='Importar transcrições do ParakeetAI'
          disabled={!snapshot.available || importing}
          onClick={handleImportTranscriptions}
        >
          {importing ? (
            <Loader2 size={14} className='home-dashboard__parakeet-import-spinner' />
          ) : (
            <Download size={14} />
          )}
          <span className='app-button__label'>Importar</span>
        </button>
        <AnchoredSelect
          value={selectedSourceType}
          options={selectOptions}
          allowEmpty
          emptyLabel='Todas'
          disabled={!snapshot.available}
          onChange={selectSourceType}
          triggerClassName='home-dashboard__parakeet-select'
        />
      </div>
    );
  }, [
    handleImportTranscriptions,
    hydrated,
    importing,
    selectOptions,
    selectSourceType,
    selectedSourceType,
    snapshot.available,
    snapshot.installed,
  ]);

  const handleOpenTranscription = useCallback(
    async (item: MacParakeetTranscriptionItem) => {
      const requestId = ++detailRequestRef.current;
      setActiveDetail(buildPreviewDetail(item));
      setDetailLoadingId(item.id);

      try {
        const detail = await loadDetail(item.id);
        if (requestId !== detailRequestRef.current) {
          return;
        }

        if (detail) {
          setActiveDetail(detail);
        }
      } finally {
        if (requestId === detailRequestRef.current) {
          setDetailLoadingId(null);
        }
      }
    },
    [loadDetail],
  );

  const handleCloseDetail = useCallback(() => {
    detailRequestRef.current += 1;
    setActiveDetail(null);
    setDetailLoadingId(null);
  }, []);

  const handleRenameTitle = useCallback(
    async (id: string, title: string) => {
      const nextTitle = await renameTitle(id, title);
      if (nextTitle) {
        setActiveDetail((previousDetail) =>
          previousDetail && previousDetail.id === id
            ? { ...previousDetail, title: nextTitle }
            : previousDetail,
        );
      }
      return nextTitle;
    },
    [renameTitle],
  );

  const handleOpenApp = useCallback(() => {
    void openApp();
  }, [openApp]);

  const openTaskFormForProject = useCallback(
    (projectId: string) => {
      if (!activeDetail) {
        return;
      }

      setTaskFormState({
        projectId,
        task: buildTaskDraftFromTranscription(activeDetail),
      });
      setProjectPickerOpen(false);
    },
    [activeDetail],
  );

  const handleCreateTask = useCallback(() => {
    if (!activeDetail || visibleProjects.length === 0) {
      return;
    }

    if (visibleProjects.length === 1) {
      openTaskFormForProject(visibleProjects[0].id);
      return;
    }

    setProjectPickerOpen(true);
  }, [activeDetail, openTaskFormForProject, visibleProjects]);

  const handleCloseProjectPicker = useCallback(() => {
    setProjectPickerOpen(false);
  }, []);

  const handleSelectProject = useCallback(
    (projectId: string) => {
      openTaskFormForProject(projectId);
    },
    [openTaskFormForProject],
  );

  const handleCloseTaskForm = useCallback(() => {
    setTaskFormState(null);
  }, []);

  const handleSaveTask = useCallback(
    async (task: ProjectTask) => {
      if (!taskFormState) {
        return;
      }

      const project = projects.find((item) => item.id === taskFormState.projectId);

      if (!project) {
        return;
      }

      const tasks = project.tasks ?? [];
      await updateProject(project.id, { tasks: [...tasks, task] });
      setTaskFormState(null);
    },
    [projects, taskFormState, updateProject],
  );

  const showSkeleton = !hydrated || (loading && transcriptions.length === 0);
  const showEmpty =
    hydrated && snapshot.installed && snapshot.available && !loading && transcriptions.length === 0;
  const showList = hydrated && transcriptions.length > 0;
  const favoriteCount = useMemo(
    () => transcriptions.filter((item) => item.isFavorite).length,
    [transcriptions],
  );

  return (
    <>
      <HomeDashboardSection
        icon={AudioLines}
        title='Transcrições'
        accent='#34d399'
        className='home-dashboard__parakeet-section'
        enterDelayMs={200}
        headerAction={headerActions}
        headerMeta={
          favoriteCount > 0 ? (
            <span className='home-dashboard__parakeet-favorites'>{favoriteCount} favoritas</span>
          ) : null
        }
      >
        {!snapshot.platformSupported ? (
          <EmptyState icon={Mic} message='Transcrições disponíveis apenas no macOS' compact />
        ) : !snapshot.installed ? (
          <div className='home-dashboard__parakeet-empty'>
            <EmptyState icon={Mic} message='ParakeetAI não encontrado' compact />
            <button
              type='button'
              className='home-dashboard__permission-hint app-button app-button--enter'
              onClick={handleOpenApp}
            >
              Baixar ParakeetAI
            </button>
          </div>
        ) : !snapshot.available ? (
          <div className='home-dashboard__parakeet-empty'>
            <EmptyState icon={Mic} message='Faça login no ParakeetAI' compact />
            <button
              type='button'
              className='home-dashboard__permission-hint app-button app-button--enter'
              onClick={handleOpenApp}
            >
              Abrir ParakeetAI
            </button>
          </div>
        ) : showSkeleton ? (
          <HomeDashboardParakeetSkeleton />
        ) : showEmpty ? (
          <EmptyState
            icon={Mic}
            message={
              selectedSourceType ? 'Nenhuma transcrição neste filtro' : 'Nenhuma transcrição recente'
            }
            compact
          />
        ) : showList ? (
          <ul className='home-dashboard__parakeet-list'>
            {transcriptions.map((item, index) => (
              <li key={item.id}>
                <button
                  type='button'
                  className={`home-dashboard__parakeet-row app-button app-button--enter${item.isFavorite ? ' home-dashboard__parakeet-row--favorite' : ''}${item.isLive ? ' home-dashboard__parakeet-row--live' : ''}`}
                  style={{ animationDelay: `${200 + index * 35}ms` }}
                  title={item.title}
                  aria-label={`Abrir transcrição ${item.title}`}
                  disabled={detailLoadingId === item.id}
                  onClick={() => void handleOpenTranscription(item)}
                >
                  <span className='home-dashboard__parakeet-copy'>
                    <span className='home-dashboard__parakeet-title'>{item.title}</span>
                    {item.snippet ? (
                      <span className='home-dashboard__parakeet-snippet'>{item.snippet}</span>
                    ) : null}
                    <span className='home-dashboard__parakeet-meta'>
                      <span
                        className='home-dashboard__parakeet-chip'
                        style={{
                          ['--parakeet-accent' as string]: resolveMacParakeetSourceAccent(item.sourceType),
                        }}
                      >
                        {resolveMacParakeetSourceLabel(item.sourceType)}
                      </span>
                      {item.channelName ? (
                        <span className='home-dashboard__parakeet-channel'>{item.channelName}</span>
                      ) : null}
                      <span className='home-dashboard__parakeet-duration'>
                        {formatMacParakeetDuration(item.durationMs)}
                      </span>
                      <span className='home-dashboard__parakeet-date'>
                        {formatNotificationRelativeTime(item.createdAt)}
                      </span>
                    </span>
                  </span>
                  {item.isLive ? (
                    <span className='home-dashboard__parakeet-live' aria-label='Chamada em andamento'>
                      <span className='home-dashboard__parakeet-live-dot' aria-hidden='true' />
                    </span>
                  ) : null}
                  {item.isFavorite ? (
                    <Star size={14} className='home-dashboard__parakeet-star' aria-hidden='true' />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </HomeDashboardSection>

      {activeDetail ? (
        <MacParakeetTranscriptionModal
          detail={activeDetail}
          detailLoading={detailLoadingId === activeDetail.id}
          onClose={handleCloseDetail}
          onRenameTitle={handleRenameTitle}
          onCreateTask={handleCreateTask}
          createTaskDisabled={createTaskDisabled || detailLoadingId === activeDetail.id}
        />
      ) : null}
      {projectPickerOpen ? (
        <TaskProjectPickerModal
          projects={visibleProjects}
          onClose={handleCloseProjectPicker}
          onSelect={handleSelectProject}
        />
      ) : null}
      {taskFormState ? (
        <TaskFormModal
          projectId={taskFormState.projectId}
          task={taskFormState.task}
          onClose={handleCloseTaskForm}
          onSave={(task) => void handleSaveTask(task)}
        />
      ) : null}
    </>
  );
}

export const HomeDashboardMacParakeetCard = memo(HomeDashboardMacParakeetCardComponent);
