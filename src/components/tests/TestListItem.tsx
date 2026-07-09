import { Pause, Play } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { TestContextMenu } from '@/components/tests/TestContextMenu';
import { TestRunProgressPanel } from '@/components/tests/TestRunProgressPanel';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { ProjectPromptDialog } from '@/components/sidebar/ProjectPromptDialog';
import { useTestExecutionStore, useTestRunForEntry } from '@/stores/useTestExecutionStore';
import type { ProjectTestEntry } from '@/types/test';
import { getTestRunnerLabel, hasDistinctTestEntrySourceName, resolveTestEntrySourceName } from '@/utils/testLabels';
import { TEST_RUNNER_ICON_SRC } from '@/utils/testRunnerIcons';

interface TestListItemProps {
  entry: ProjectTestEntry;
  showRunnerKind: boolean;
  onPlay: (entry: ProjectTestEntry) => void;
  onStop: (entry: ProjectTestEntry) => void;
  onRename: (entry: ProjectTestEntry, name: string) => void;
  onRemove: (entry: ProjectTestEntry) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
}

function TestListItemComponent({
  entry,
  showRunnerKind,
  onPlay,
  onStop,
  onRename,
  onRemove,
}: TestListItemProps) {
  const run = useTestRunForEntry(entry.id);
  const expandedEntryId = useTestExecutionStore((state) => state.expandedEntryId);
  const isExpanded = expandedEntryId === entry.id;
  const isPreparing = run?.status === 'preparing';
  const isRunning = run?.status === 'running';
  const isBusy = isPreparing || isRunning;
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const handlePlayClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onPlay(entry);
    },
    [entry, onPlay],
  );

  const handleStopClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onStop(entry);
    },
    [entry, onStop],
  );

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY });
  }, []);

  const handleDeleteRequest = useCallback(() => {
    setDeleteConfirmOpen(true);
  }, []);

  const handleRenameRequest = useCallback(() => {
    setRenameOpen(true);
  }, []);

  const handleRenameConfirm = useCallback(
    (name: string) => {
      onRename(entry, name);
      setRenameOpen(false);
    },
    [entry, onRename],
  );

  const handleDeleteConfirm = useCallback(
    (requestClose: () => void) => {
      onRemove(entry);
      requestClose();
      setDeleteConfirmOpen(false);
    },
    [entry, onRemove],
  );

  const sourceName = resolveTestEntrySourceName(entry);
  const showSourceName = hasDistinctTestEntrySourceName(entry);

  return (
    <div className='tests-drawer__item'>
      <div
        className='tests-drawer__row app-button--enter'
        onContextMenu={handleContextMenu}
      >
        <div className='tests-drawer__row-main'>
          <span className='tests-drawer__name'>{entry.name}</span>
          {showSourceName ? (
            <span className='tests-drawer__source'>{sourceName}</span>
          ) : null}
          {showRunnerKind ? (
            <span className='tests-drawer__meta'>
              <img
                src={TEST_RUNNER_ICON_SRC[entry.kind]}
                alt=''
                className='tests-drawer__runner-icon'
                draggable={false}
                aria-hidden='true'
              />
              {getTestRunnerLabel(entry.kind)}
            </span>
          ) : null}
        </div>
        <div className='tests-drawer__actions'>
          {isBusy ? (
            <button
              type='button'
              className='tests-drawer__action tests-drawer__action--pause app-button app-button--enter'
              aria-label={`Pausar ${entry.name}`}
              onClick={handleStopClick}
            >
              {isPreparing ? (
                <span className='tests-drawer__action-spinner' aria-hidden='true' />
              ) : (
                <Pause size={13} strokeWidth={2.25} />
              )}
            </button>
          ) : (
            <button
              type='button'
              className='tests-drawer__action tests-drawer__action--play app-button app-button--enter'
              aria-label={isExpanded ? `Recolher ${entry.name}` : `Executar ${entry.name}`}
              onClick={handlePlayClick}
            >
              <Play size={13} strokeWidth={2.25} />
            </button>
          )}
        </div>
      </div>
      {isExpanded && run ? (
        <TestRunProgressPanel
          testName={entry.name}
          runnerKind={entry.kind}
          targetPath={entry.targetPath}
          steps={run.steps}
          status={run.status}
          error={run.error}
          logTail={run.logTail}
          startedAt={run.startedAt}
          finishedAt={run.finishedAt}
        />
      ) : null}

      {contextMenu ? (
        <TestContextMenu
          entry={entry}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onRename={handleRenameRequest}
          onDelete={handleDeleteRequest}
        />
      ) : null}

      {renameOpen ? (
        <ProjectPromptDialog
          mode='rename'
          initialValue={entry.name}
          dialogTitle='Renomear teste'
          dialogLabel='Nome do teste'
          onConfirm={handleRenameConfirm}
          onClose={() => setRenameOpen(false)}
        />
      ) : null}

      {deleteConfirmOpen ? (
        <AnimatedModal panelClassName='project-dialog' onClose={() => setDeleteConfirmOpen(false)}>
          {(requestClose) => (
            <>
              <span className='project-dialog__title'>Excluir teste</span>
              <p className='project-dialog__message'>
                Tem certeza que deseja excluir <strong>{entry.name}</strong>?
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
    </div>
  );
}

export const TestListItem = memo(TestListItemComponent);
