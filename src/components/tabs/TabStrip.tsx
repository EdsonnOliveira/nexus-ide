import { Fragment, memo, useCallback, useMemo, useState } from 'react';
import { TAB_DRAG_MIME } from '@/constants/tabDrag';
import { useTabCloseShortcut } from '@/hooks/useTabCloseShortcut';
import { useTabIndexShortcuts } from '@/hooks/useTabIndexShortcuts';
import { useProjectStore } from '@/stores/useProjectStore';
import { useAutomationExecutionStore } from '@/stores/useAutomationExecutionStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { useTabActions } from '@/stores/useTabStore';
import { ProjectPromptDialog } from '@/components/sidebar/ProjectPromptDialog';
import { TabContextMenu } from '@/components/tabs/TabContextMenu';
import { TabItem } from '@/components/tabs/TabItem';
import { TabToolbar } from '@/components/tabs/TabToolbar';
import type { TabBarItem } from '@/types';
import { getPanesFromItem, resolveActiveTabBarItem } from '@/utils/tabGroups';
import { isPaneAgentLoading } from '@/utils/projectAgentStatus';
import { countPinnedTabs } from '@/utils/tabOrder';

interface TabContextMenuState {
  tabId: string;
  x: number;
  y: number;
}

interface TabStripProps {
  onTabDragStart: (tabId: string) => void;
  onTabDragEnd: () => void;
}

function TabStripComponent({ onTabDragStart, onTabDragEnd }: TabStripProps) {
  useTabCloseShortcut();
  useTabIndexShortcuts();
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const projects = useProjectStore((state) => state.projects);
  const { selectTab, closeTab, closeAllTabs, renameTab, unsplitTab, reorderTab, togglePinTab } =
    useTabActions();
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null);
  const [renameTabId, setRenameTabId] = useState<string | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );

  const tabs = useMemo(() => activeProject?.tabs ?? [], [activeProject?.tabs]);
  const pinnedCount = useMemo(() => countPinnedTabs(tabs), [tabs]);
  const canCloseAllTabs = tabs.length > pinnedCount;
  const activeTabItem = useMemo(
    () => resolveActiveTabBarItem(tabs, activeProject?.activeTabId ?? null),
    [activeProject?.activeTabId, tabs],
  );
  const restartingPaneIds = useTerminalSessionStore((state) => state.restartingPaneIds);
  const executingPaneIds = useAutomationExecutionStore((state) => state.executingPaneIds);
  const pendingLaunchCommands = useTerminalSessionStore((state) => state.pendingLaunchCommands);
  const agentBusyByPane = useTerminalSessionStore((state) => state.agentBusyByPane);
  const awaitingResponseByPane = useTerminalSessionStore((state) => state.awaitingResponseByPane);
  const activeAgentByPane = useTerminalSessionStore((state) => state.activeAgentByPane);

  const tabRestartingMap = useMemo(() => {
    const map = new Map<string, boolean>();

    for (const tab of tabs) {
      const agentPanes = getPanesFromItem(tab).filter(
        (pane) => pane.type === 'terminal' || pane.type === 'agent',
      );
      map.set(
        tab.id,
        agentPanes.some((pane) => {
          if (pane.type === 'agent') {
            const hasRunningTurn = (pane.turns ?? []).some((turn) => turn.running);
            const isBootstrapping = !pane.ptyId && Boolean(pendingLaunchCommands[pane.id]);

            return hasRunningTurn || isBootstrapping;
          }

          const hasPendingLaunch =
            Boolean(pendingLaunchCommands[pane.id]) &&
            pane.type === 'terminal' &&
            !pane.ptyId;

          return (
            Boolean(restartingPaneIds[pane.id]) ||
            Boolean(executingPaneIds[pane.id]) ||
            hasPendingLaunch ||
            isPaneAgentLoading(pane, awaitingResponseByPane, activeAgentByPane, agentBusyByPane)
          );
        }),
      );
    }

    return map;
  }, [
    activeAgentByPane,
    agentBusyByPane,
    awaitingResponseByPane,
    executingPaneIds,
    pendingLaunchCommands,
    restartingPaneIds,
    tabs,
  ]);

  const contextTab = useMemo(
    () => tabs.find((tab) => tab.id === contextMenu?.tabId) ?? null,
    [contextMenu?.tabId, tabs],
  );

  const renameTargetTab = useMemo(
    () => tabs.find((tab) => tab.id === renameTabId) ?? null,
    [renameTabId, tabs],
  );

  const handleSelectTab = useCallback(
    (tabId: string) => {
      void selectTab(tabId);
    },
    [selectTab],
  );

  const handleCloseTab = useCallback(
    (tabId: string) => {
      void closeTab(tabId);
    },
    [closeTab],
  );

  const handleContextMenu = useCallback((tab: TabBarItem, x: number, y: number) => {
    setContextMenu({ tabId: tab.id, x, y });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleRenameRequest = useCallback((tabId: string) => {
    setRenameTabId(tabId);
  }, []);

  const handleUnsplit = useCallback(
    (tabId: string) => {
      void unsplitTab(tabId);
    },
    [unsplitTab],
  );

  const handleRenameClose = useCallback(() => {
    setRenameTabId(null);
  }, []);

  const handleRenameConfirm = useCallback(
    (value: string) => {
      if (!renameTabId) {
        return;
      }

      void renameTab(renameTabId, value);
    },
    [renameTab, renameTabId],
  );

  const handleDragOverTab = useCallback((index: number) => {
    setDropTargetIndex(index);
  }, []);

  const handleDropTab = useCallback(
    (sourceTabId: string, targetIndex: number) => {
      void reorderTab(sourceTabId, targetIndex);
      setDropTargetIndex(null);
    },
    [reorderTab],
  );

  const handleTabDragEnd = useCallback(() => {
    setDropTargetIndex(null);
    onTabDragEnd();
  }, [onTabDragEnd]);

  const handleTogglePin = useCallback(
    (tabId: string) => {
      void togglePinTab(tabId);
    },
    [togglePinTab],
  );

  const handleCloseAllTabs = useCallback(() => {
    void closeAllTabs();
  }, [closeAllTabs]);

  const handleTabsDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setDropTargetIndex(null);
    }
  }, []);

  const handleTailDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (tabs.length === 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      setDropTargetIndex(tabs.length - 1);
    },
    [tabs.length],
  );

  const handleTailDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const sourceTabId = event.dataTransfer.getData(TAB_DRAG_MIME);

      if (sourceTabId && tabs.length > 0) {
        void reorderTab(sourceTabId, tabs.length - 1);
      }

      setDropTargetIndex(null);
      onTabDragEnd();
    },
    [onTabDragEnd, reorderTab, tabs.length],
  );

  if (!activeProject) {
    return null;
  }

  return (
    <>
      <div className='tab-bar'>
        <div className='tab-bar__tabs' onDragLeave={handleTabsDragLeave}>
          {tabs.map((tab, index) => (
            <Fragment key={tab.id}>
              {pinnedCount > 0 && index === pinnedCount ? (
                <div className='tab-bar__pin-divider' aria-hidden='true' />
              ) : null}
              <TabItem
                tab={tab}
                index={index}
                isFocused={tab.id === activeTabItem?.id}
                isRestarting={tabRestartingMap.get(tab.id) ?? false}
                isDropTarget={dropTargetIndex === index}
                onSelect={handleSelectTab}
                onClose={handleCloseTab}
                onDragStart={onTabDragStart}
                onDragEnd={handleTabDragEnd}
                onDragOverTab={handleDragOverTab}
                onDropTab={handleDropTab}
                onContextMenu={handleContextMenu}
              />
            </Fragment>
          ))}
          {tabs.length > 0 ? (
            <div
              className={`tab-bar__drop-tail${dropTargetIndex === tabs.length - 1 ? ' tab-bar__drop-tail--active' : ''}`}
              onDragOver={handleTailDragOver}
              onDrop={handleTailDrop}
              aria-hidden='true'
            />
          ) : null}
        </div>
        <TabToolbar />
      </div>

      {contextMenu && contextTab ? (
        <TabContextMenu
          tab={contextTab}
          project={activeProject}
          x={contextMenu.x}
          y={contextMenu.y}
          pinnedCount={pinnedCount}
          canCloseAllTabs={canCloseAllTabs}
          onClose={handleCloseContextMenu}
          onRename={handleRenameRequest}
          onUnsplit={handleUnsplit}
          onTogglePin={handleTogglePin}
          onCloseAllTabs={handleCloseAllTabs}
        />
      ) : null}

      {renameTargetTab ? (
        <ProjectPromptDialog
          mode='rename'
          initialValue={renameTargetTab.title}
          dialogTitle='Renomear aba'
          dialogLabel='Nome da aba'
          onConfirm={handleRenameConfirm}
          onClose={handleRenameClose}
        />
      ) : null}
    </>
  );
}

export const TabStrip = memo(TabStripComponent);
