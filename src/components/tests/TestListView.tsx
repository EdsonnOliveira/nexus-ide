import { FlaskConical, Plus } from 'lucide-react';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { TestDiscoveryModal } from '@/components/tests/TestDiscoveryModal';
import { TestListItem } from '@/components/tests/TestListItem';
import { TestTypePickerPopup } from '@/components/tests/TestTypePickerPopup';
import { EmptyState } from '@/components/overlay/EmptyState';
import type { ProjectTestEntry, TestRunnerKind } from '@/types/test';
import { getTestTabLabel, TEST_RUNNER_KINDS, type TestTabFilter } from '@/utils/testLabels';

interface TestListViewProps {
  testEntries: ProjectTestEntry[];
  projectId: string;
  projectPath: string;
  onAddEntries: (entries: ProjectTestEntry[]) => void;
  onRemoveEntry: (entry: ProjectTestEntry) => void;
  onRenameEntry: (entry: ProjectTestEntry, name: string) => void;
  onPlay: (entry: ProjectTestEntry) => void;
  onStop: (entry: ProjectTestEntry) => void;
}

function TestListViewComponent({
  testEntries,
  projectId,
  projectPath,
  onAddEntries,
  onRemoveEntry,
  onRenameEntry,
  onPlay,
  onStop,
}: TestListViewProps) {
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null);
  const [discoveryKind, setDiscoveryKind] = useState<TestRunnerKind | null>(null);
  const [activeTab, setActiveTab] = useState<TestTabFilter>('all');

  const visibleTabs = useMemo(() => {
    const tabs: TestTabFilter[] = [];

    if (testEntries.length > 0) {
      tabs.push('all');
    }

    for (const kind of TEST_RUNNER_KINDS) {
      if (testEntries.some((entry) => entry.kind === kind)) {
        tabs.push(kind);
      }
    }

    if (discoveryKind && !tabs.includes(discoveryKind)) {
      tabs.push(discoveryKind);
    }

    return tabs;
  }, [discoveryKind, testEntries]);

  const filteredEntries = useMemo(() => {
    if (activeTab === 'all') {
      return testEntries;
    }

    return testEntries.filter((entry) => entry.kind === activeTab);
  }, [activeTab, testEntries]);

  const handleOpenPicker = useCallback(() => {
    const rect = addButtonRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setPickerAnchor(rect);
  }, []);

  const handleClosePicker = useCallback(() => {
    setPickerAnchor(null);
  }, []);

  const handleSelectKind = useCallback((kind: TestRunnerKind) => {
    setPickerAnchor(null);
    setDiscoveryKind(kind);
    setActiveTab(kind);
  }, []);

  const handleCloseDiscovery = useCallback(() => {
    setDiscoveryKind(null);
  }, []);

  const handleConfirmDiscovery = useCallback(
    (entries: ProjectTestEntry[]) => {
      onAddEntries(entries);
      setDiscoveryKind(null);
    },
    [onAddEntries],
  );

  return (
    <aside className='project-explorer-drawer tests-drawer'>
      <div className='project-explorer__header'>
        <span className='project-explorer__title'>Testes</span>
        <button
          ref={addButtonRef}
          type='button'
          className='project-explorer__header-btn app-button app-button--enter'
          aria-label='Adicionar teste'
          onClick={handleOpenPicker}
        >
          <Plus size={14} strokeWidth={2} />
        </button>
      </div>

      {visibleTabs.length > 0 ? (
        <div className='tests-drawer__tabs' role='tablist' aria-label='Tipos de teste'>
          {visibleTabs.map((tab) => (
            <button
              key={tab}
              type='button'
              role='tab'
              aria-selected={activeTab === tab}
              className={`tests-drawer__tab app-button app-button--enter${activeTab === tab ? ' tests-drawer__tab--active app-button--enter' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {getTestTabLabel(tab)}
            </button>
          ))}
        </div>
      ) : null}

      <div className='tests-drawer__list'>
        {filteredEntries.length === 0 ? (
          <EmptyState
            icon={FlaskConical}
            message='Nenhum teste adicionado'
            compact
            className='tests-drawer__empty'
          />
        ) : (
          filteredEntries.map((entry) => (
            <TestListItem
              key={entry.id}
              entry={entry}
              showRunnerKind={activeTab === 'all'}
              onPlay={onPlay}
              onStop={onStop}
              onRename={onRenameEntry}
              onRemove={onRemoveEntry}
            />
          ))
        )}
      </div>

      {pickerAnchor ? (
        <TestTypePickerPopup
          anchorRect={pickerAnchor}
          onClose={handleClosePicker}
          onSelect={handleSelectKind}
        />
      ) : null}

      {discoveryKind ? (
        <TestDiscoveryModal
          kind={discoveryKind}
          projectPath={projectPath}
          existingEntries={testEntries}
          onClose={handleCloseDiscovery}
          onConfirm={handleConfirmDiscovery}
        />
      ) : null}
    </aside>
  );
}

export const TestListView = memo(TestListViewComponent);
