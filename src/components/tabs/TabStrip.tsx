import { Fragment, memo, useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { TAB_DRAG_MIME } from '@/constants/tabDrag';
import { useStableLoadingMap } from '@/hooks/useStableLoadingMap';
import { useTabCloseShortcut } from '@/hooks/useTabCloseShortcut';
import { useTabIndexShortcuts } from '@/hooks/useTabIndexShortcuts';
import { useProjectStore } from '@/stores/useProjectStore';
import { useProjectNotificationStore } from '@/stores/useProjectNotificationStore';
import { useAutomationExecutionStore } from '@/stores/useAutomationExecutionStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { useTabActions } from '@/stores/useTabStore';
import { ProjectPromptDialog } from '@/components/sidebar/ProjectPromptDialog';
import { TabContextMenu } from '@/components/tabs/TabContextMenu';
import { TabItem } from '@/components/tabs/TabItem';
import { TabToolbar } from '@/components/tabs/TabToolbar';
import type { TabBarItem } from '@/types';
import { getPanesFromItem, resolveActiveTabBarItem } from '@/utils/tabGroups';
import { isAgentPaneTabLoading, isPaneAgentLoading } from '@/utils/projectAgentStatus';
import { getProjectPingTone } from '@/utils/projectPingTone';
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
  const activeProject = useProjectStore((state) =>
    state.projects.find((project) => project.id === state.activeProjectId) ?? null,
  );
  const { selectTab, closeTab, closeAllTabs, renameTab, unsplitTab, reorderTab, togglePinTab } =
    useTabActions();
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null);
  const [renameTabId, setRenameTabId] = useState<string | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  const tabs = useMemo(() => activeProject?.tabs ?? [], [activeProject?.tabs]);
  const pinnedCount = useMemo(() => countPinnedTabs(tabs), [tabs]);
  const canCloseAllTabs = tabs.length > pinnedCount;
  const activeTabItem = useMemo(
    () => resolveActiveTabBarItem(tabs, activeProject?.activeTabId ?? null),
    [activeProject?.activeTabId, tabs],
  );
  const paneIdsKey = useMemo(
    () =>
      tabs
        .flatMap((tab) => getPanesFromItem(tab).map((pane) => pane.id))
        .sort()
        .join('|'),
    [tabs],
  );
  const sessionFlags = useTerminalSessionStore(
    useShallow((state) => {
      const paneIds = paneIdsKey ? paneIdsKey.split('|').filter(Boolean) : [];
      const flags: Record<string, boolean | string | null> = {};

      for (const paneId of paneIds) {
        flags[`restarting:${paneId}`] = Boolean(state.restartingPaneIds[paneId]);
        flags[`pending:${paneId}`] = state.pendingLaunchCommands[paneId] ?? null;
        flags[`busy:${paneId}`] = Boolean(state.agentBusyByPane[paneId]);
        flags[`awaiting:${paneId}`] = Boolean(state.awaitingResponseByPane[paneId]);
        flags[`print:${paneId}`] = state.agentPrintRunTokenByPane[paneId] ?? null;
        flags[`agent:${paneId}`] = state.activeAgentByPane[paneId] ?? null;
      }

      return flags;
    }),
  );
  const executingPaneIds = useAutomationExecutionStore((state) => state.executingPaneIds);
  const notifiedAgentPaneByProject = useProjectNotificationStore(
    (state) => state.notifiedAgentPaneByProject,
  );

  const notifiedPaneId = useMemo(() => {
    if (!activeProjectId) {
      return null;
    }

    return notifiedAgentPaneByProject[activeProjectId] ?? null;
  }, [activeProjectId, notifiedAgentPaneByProject]);

  const tabNotificationMap = useMemo(() => {
    const map = new Map<string, boolean>();

    if (!notifiedPaneId) {
      return map;
    }

    for (const tab of tabs) {
      map.set(
        tab.id,
        getPanesFromItem(tab).some((pane) => pane.id === notifiedPaneId),
      );
    }

    return map;
  }, [notifiedPaneId, tabs]);

  const pingTone = useMemo(
    () => (activeProject ? getProjectPingTone(activeProject.color) : 'red'),
    [activeProject],
  );

  const tabRestartingMapRaw = useMemo(() => {
    const map = new Map<string, boolean>();
    const pendingLaunchCommands: Record<string, string> = {};
    const agentPrintRunTokenByPane: Record<string, string> = {};
    const awaitingResponseByPane: Record<string, boolean> = {};
    const activeAgentByPane: Record<string, string | null> = {};
    const agentBusyByPane: Record<string, boolean> = {};
    const restartingPaneIds: Record<string, boolean> = {};

    for (const [key, value] of Object.entries(sessionFlags)) {
      const separator = key.indexOf(':');
      const kind = key.slice(0, separator);
      const paneId = key.slice(separator + 1);

      if (kind === 'restarting') {
        restartingPaneIds[paneId] = Boolean(value);
      } else if (kind === 'pending' && typeof value === 'string') {
        pendingLaunchCommands[paneId] = value;
      } else if (kind === 'busy') {
        agentBusyByPane[paneId] = Boolean(value);
      } else if (kind === 'awaiting') {
        awaitingResponseByPane[paneId] = Boolean(value);
      } else if (kind === 'print' && typeof value === 'string') {
        agentPrintRunTokenByPane[paneId] = value;
      } else if (kind === 'agent') {
        activeAgentByPane[paneId] = typeof value === 'string' ? value : null;
      }
    }

    for (const tab of tabs) {
      const agentPanes = getPanesFromItem(tab).filter(
        (pane) => pane.type === 'terminal' || pane.type === 'agent',
      );
      map.set(
        tab.id,
        agentPanes.some((pane) => {
          if (pane.type === 'agent') {
            return isAgentPaneTabLoading(pane, pendingLaunchCommands, agentPrintRunTokenByPane);
          }

          const hasPendingLaunch =
            Boolean(pendingLaunchCommands[pane.id]) &&
            pane.type === 'terminal' &&
            !pane.ptyId;

          return (
            Boolean(restartingPaneIds[pane.id]) ||
            Boolean(executingPaneIds[pane.id]) ||
            hasPendingLaunch ||
            isPaneAgentLoading(
              pane,
              awaitingResponseByPane,
              activeAgentByPane,
              agentBusyByPane,
              agentPrintRunTokenByPane,
              pendingLaunchCommands,
            )
          );
        }),
      );
    }

    return map;
  }, [executingPaneIds, sessionFlags, tabs]);

  const tabRestartingMap = useStableLoadingMap(tabRestartingMapRaw);

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
                hasNotification={tabNotificationMap.get(tab.id) ?? false}
                pingTone={pingTone}
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
