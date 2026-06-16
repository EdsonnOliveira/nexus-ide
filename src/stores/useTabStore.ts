import { useProjectStore } from '@/stores/useProjectStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import type { BrowserTab, FileTab, Tab, TabBarItem, TabType, TerminalAgent } from '@/types';
import { normalizeBrowserUrl } from '@/utils/browserUrl';
import { createBadgeColorIndex } from '@/utils/tabBadge';
import {
  findPaneTab,
  findSplitTabByPaneId,
  mergeTabItems,
  renameTabBarItem,
  unsplitTabItems,
  updatePaneInTabs,
  updateSplitTabLayout,
} from '@/utils/tabGroups';
import { findDiffTabByPath, findFileTabByPath } from '@/utils/fileTabs';
import { resolveFileViewMode } from '@/utils/fileViewMode';
import { isTabPinned, reorderTabBarItems, toggleTabPinned } from '@/utils/tabOrder';
import { updateSplitRatioAtPath } from '@/utils/splitLayout';

interface TabStoreActions {
  addTab: (type: TabType) => Promise<void>;
  addAgentTab: (command: string) => Promise<void>;
  openBrowserTab: (url: string) => Promise<void>;
  openFileTab: (filePath: string, fileName: string) => Promise<void>;
  openDiffTab: (filePath: string, staged: boolean) => Promise<void>;
  closeTab: (tabId: string) => Promise<void>;
  selectTab: (tabId: string) => Promise<void>;
  selectPane: (paneId: string) => Promise<void>;
  splitTab: (sourceTabId: string, targetTabId: string, side: 'left' | 'right') => Promise<void>;
  unsplitTab: (tabId: string) => Promise<void>;
  splitWithNeighbor: () => Promise<void>;
  renameTab: (tabId: string, title: string) => Promise<void>;
  reorderTab: (sourceTabId: string, targetIndex: number) => Promise<void>;
  togglePinTab: (tabId: string) => Promise<boolean>;
  setTabPtyId: (tabId: string, ptyId: string | null) => Promise<void>;
  setTabAgent: (tabId: string, agent: TerminalAgent) => Promise<void>;
  updateBrowserUrl: (tabId: string, url: string) => Promise<void>;
  setSplitRatio: (
    splitTabId: string,
    path: readonly number[],
    ratio: number,
  ) => Promise<void>;
  getActiveTab: () => Tab | null;
}

const DEFAULT_BROWSER_URL = 'https://www.google.com';

function countPanesByType(tabs: TabBarItem[], type: TabType): number {
  return tabs.reduce((count, item) => {
    if (item.type === 'split') {
      return count + item.panes.filter((pane) => pane.type === type).length;
    }

    return item.type === type ? count + 1 : count;
  }, 0);
}

function killTabBarItem(item: TabBarItem): void {
  for (const pane of item.type === 'split' ? item.panes : [item]) {
    if (pane.type === 'terminal' && pane.ptyId) {
      window.nexus.terminal.kill(pane.ptyId);
    }

    if (pane.type === 'terminal') {
      void window.nexus.session.removePane(pane.id);
    }
  }
}

export function useTabActions(): TabStoreActions {
  const updateProject = useProjectStore((state) => state.updateProject);
  const setTabPtyId = useProjectStore((state) => state.setTabPtyId);
  const getActiveProject = useProjectStore((state) => state.getActiveProject);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);

  const getProjectSnapshot = () => getActiveProject();

  return {
    addTab: async (type) => {
      const project = getProjectSnapshot();

      if (!project) {
        return;
      }

      const tabId = crypto.randomUUID();
      const badgeColorIndex = createBadgeColorIndex(project.tabs);
      const nextTab: Tab =
        type === 'browser'
          ? {
              id: tabId,
              title: `Navegador ${countPanesByType(project.tabs, 'browser') + 1}`,
              type: 'browser',
              url: DEFAULT_BROWSER_URL,
              badgeColorIndex,
            }
          : {
              id: tabId,
              title: `Terminal ${countPanesByType(project.tabs, 'terminal') + 1}`,
              type: 'terminal',
              ptyId: null,
              agent: 'cursor',
              badgeColorIndex,
            };

      await updateProject(project.id, {
        tabs: [...project.tabs, nextTab],
        activeTabId: tabId,
        activePaneId: null,
      });
    },
    addAgentTab: async (command) => {
      const project = getProjectSnapshot();

      if (!project) {
        return;
      }

      const tabId = crypto.randomUUID();
      const badgeColorIndex = createBadgeColorIndex(project.tabs);
      const nextTab: Tab = {
        id: tabId,
        title: `Terminal ${countPanesByType(project.tabs, 'terminal') + 1}`,
        type: 'terminal',
        ptyId: null,
        agent: 'shell',
        restoreCommand: command,
        badgeColorIndex,
      };

      useTerminalSessionStore.getState().setPendingLaunchCommand(tabId, command);

      await updateProject(project.id, {
        tabs: [...project.tabs, nextTab],
        activeTabId: tabId,
        activePaneId: null,
      });
    },
    openBrowserTab: async (url) => {
      const project = getProjectSnapshot();

      if (!project) {
        return;
      }

      const normalized = normalizeBrowserUrl(url);

      if (!normalized) {
        return;
      }

      const tabId = crypto.randomUUID();
      const nextTab: BrowserTab = {
        id: tabId,
        title: `Navegador ${countPanesByType(project.tabs, 'browser') + 1}`,
        type: 'browser',
        url: normalized,
        badgeColorIndex: createBadgeColorIndex(project.tabs),
      };

      await updateProject(project.id, {
        tabs: [...project.tabs, nextTab],
        activeTabId: tabId,
        activePaneId: null,
      });
    },
    openFileTab: async (filePath, fileName) => {
      const project = getProjectSnapshot();

      if (!project) {
        return;
      }

      const existing = findFileTabByPath(project.tabs, filePath);

      if (existing) {
        const splitTab = findSplitTabByPaneId(project.tabs, existing.id);

        if (splitTab) {
          await updateProject(project.id, {
            activeTabId: splitTab.id,
            activePaneId: existing.id,
            tabs: project.tabs.map((item) =>
              item.id === splitTab.id && item.type === 'split'
                ? { ...item, activePaneId: existing.id }
                : item,
            ),
          });
          return;
        }

        await updateProject(project.id, {
          activeTabId: existing.id,
          activePaneId: null,
        });
        return;
      }

      const tabId = crypto.randomUUID();
      const nextTab: FileTab = {
        id: tabId,
        title: fileName,
        type: 'file',
        filePath,
        viewMode: resolveFileViewMode(fileName),
        badgeColorIndex: createBadgeColorIndex(project.tabs),
      };

      await updateProject(project.id, {
        tabs: [...project.tabs, nextTab],
        activeTabId: tabId,
        activePaneId: null,
      });
    },
    openDiffTab: async (filePath, staged) => {
      const project = getProjectSnapshot();

      if (!project) {
        return;
      }

      const existing = findDiffTabByPath(project.tabs, filePath, staged);

      if (existing) {
        const splitTab = findSplitTabByPaneId(project.tabs, existing.id);

        if (splitTab) {
          await updateProject(project.id, {
            activeTabId: splitTab.id,
            activePaneId: existing.id,
            tabs: project.tabs.map((item) =>
              item.id === splitTab.id && item.type === 'split'
                ? { ...item, activePaneId: existing.id }
                : item,
            ),
          });
          return;
        }

        await updateProject(project.id, {
          activeTabId: existing.id,
          activePaneId: null,
        });
        return;
      }

      const diff = await window.nexus.git.diff(project.path, filePath, staged);
      const fileName = filePath.split('/').pop() ?? filePath;
      const tabId = crypto.randomUUID();
      const nextTab: FileTab = {
        id: tabId,
        title: `${fileName} (diff)`,
        type: 'file',
        filePath,
        viewMode: 'diff',
        diffPatch: diff.patch,
        diffStaged: staged,
        badgeColorIndex: createBadgeColorIndex(project.tabs),
      };

      await updateProject(project.id, {
        tabs: [...project.tabs, nextTab],
        activeTabId: tabId,
        activePaneId: null,
      });
    },
    closeTab: async (tabId) => {
      const project = getProjectSnapshot();

      if (!project) {
        return;
      }

      const closingTab = project.tabs.find((item) => item.id === tabId);

      if (!closingTab || isTabPinned(closingTab)) {
        return;
      }

      killTabBarItem(closingTab);

      const nextTabs = project.tabs.filter((item) => item.id !== tabId);
      const activeTabId =
        project.activeTabId === tabId ? (nextTabs[0]?.id ?? null) : project.activeTabId;

      await updateProject(project.id, {
        tabs: nextTabs,
        activeTabId,
        activePaneId: null,
      });
    },
    selectTab: async (tabId) => {
      const project = getProjectSnapshot();

      if (!project) {
        return;
      }

      const selectedTab = project.tabs.find((item) => item.id === tabId);
      const activePaneId =
        selectedTab?.type === 'split'
          ? (selectedTab.activePaneId ?? selectedTab.panes[0]?.id ?? null)
          : null;

      await updateProject(project.id, {
        activeTabId: tabId,
        activePaneId,
      });
    },
    selectPane: async (paneId) => {
      const project = getProjectSnapshot();

      if (!project) {
        return;
      }

      const splitTab = project.tabs.find(
        (item) => item.type === 'split' && item.panes.some((pane) => pane.id === paneId),
      );

      if (splitTab?.type === 'split') {
        await updateProject(project.id, {
          activeTabId: splitTab.id,
          activePaneId: paneId,
          tabs: project.tabs.map((item) =>
            item.id === splitTab.id && item.type === 'split'
              ? { ...item, activePaneId: paneId }
              : item,
          ),
        });
        return;
      }

      await updateProject(project.id, {
        activeTabId: paneId,
        activePaneId: null,
      });
    },
    splitTab: async (sourceTabId, targetTabId, side) => {
      const project = getProjectSnapshot();

      if (!project || sourceTabId === targetTabId) {
        return;
      }

      const merged = mergeTabItems(project.tabs, sourceTabId, targetTabId, side);

      await updateProject(project.id, {
        tabs: merged.nextTabs,
        activeTabId: merged.activeTabId,
        activePaneId: merged.activePaneId,
      });
    },
    unsplitTab: async (tabId) => {
      const project = getProjectSnapshot();

      if (!project) {
        return;
      }

      const result = unsplitTabItems(project.tabs, tabId);

      await updateProject(project.id, {
        tabs: result.nextTabs,
        activeTabId: result.activeTabId,
        activePaneId: result.activePaneId,
      });
    },
    splitWithNeighbor: async () => {
      const project = getProjectSnapshot();

      if (!project?.activeTabId || project.tabs.length < 2) {
        return;
      }

      const activeIndex = project.tabs.findIndex((tab) => tab.id === project.activeTabId);
      const neighbor = project.tabs[activeIndex + 1] ?? project.tabs[activeIndex - 1];

      if (!neighbor) {
        return;
      }

      const side = activeIndex + 1 < project.tabs.length ? 'right' : 'left';

      const merged = mergeTabItems(project.tabs, project.activeTabId, neighbor.id, side);

      await updateProject(project.id, {
        tabs: merged.nextTabs,
        activeTabId: merged.activeTabId,
        activePaneId: merged.activePaneId,
      });
    },
    renameTab: async (tabId, title) => {
      const project = getProjectSnapshot();

      if (!project) {
        return;
      }

      await updateProject(project.id, {
        tabs: renameTabBarItem(project.tabs, tabId, title),
      });
    },
    reorderTab: async (sourceTabId, targetIndex) => {
      const project = getProjectSnapshot();

      if (!project) {
        return;
      }

      await updateProject(project.id, {
        tabs: reorderTabBarItems(project.tabs, sourceTabId, targetIndex),
      });
    },
    togglePinTab: async (tabId) => {
      const project = getProjectSnapshot();

      if (!project) {
        return false;
      }

      const result = toggleTabPinned(project.tabs, tabId);

      if (!result.ok) {
        return false;
      }

      await updateProject(project.id, {
        tabs: result.tabs,
      });

      return true;
    },
    setTabPtyId: async (tabId, ptyId) => {
      if (!activeProjectId) {
        return;
      }

      setTabPtyId(activeProjectId, tabId, ptyId);
    },
    setTabAgent: async (tabId, agent) => {
      const project = getProjectSnapshot();

      if (!project) {
        return;
      }

      const pane = findPaneTab(project.tabs, tabId);

      if (pane?.type === 'terminal' && pane.ptyId) {
        window.nexus.terminal.kill(pane.ptyId);
      }

      if (activeProjectId) {
        setTabPtyId(activeProjectId, tabId, null);
      }

      await updateProject(project.id, {
        tabs: updatePaneInTabs(project.tabs, tabId, (entry) =>
          entry.type === 'terminal' ? { ...entry, agent, ptyId: null } : entry,
        ),
      });
    },
    updateBrowserUrl: async (tabId, url) => {
      const project = getProjectSnapshot();

      if (!project) {
        return;
      }

      await updateProject(project.id, {
        tabs: updatePaneInTabs(project.tabs, tabId, (entry) =>
          entry.type === 'browser' ? { ...entry, url } : entry,
        ),
      });
    },
    setSplitRatio: async (splitTabId, path, ratio) => {
      const project = getProjectSnapshot();

      if (!project) {
        return;
      }

      const splitTab = project.tabs.find((item) => item.id === splitTabId);

      if (!splitTab || splitTab.type !== 'split') {
        return;
      }

      const nextLayout = updateSplitRatioAtPath(splitTab.layout, path, ratio);
      const nextTabs = updateSplitTabLayout(project.tabs, splitTabId, nextLayout);

      useProjectStore.setState((state) => ({
        projects: state.projects.map((entry) =>
          entry.id === project.id ? { ...entry, tabs: nextTabs } : entry,
        ),
      }));

      await updateProject(project.id, {
        tabs: nextTabs,
      });
    },
    getActiveTab: () => {
      const project = getProjectSnapshot();

      if (!project?.activeTabId) {
        return null;
      }

      const activeItem = project.tabs.find((item) => item.id === project.activeTabId);

      if (!activeItem) {
        return null;
      }

      if (activeItem.type === 'split') {
        const paneId = project.activePaneId ?? activeItem.activePaneId ?? activeItem.panes[0]?.id;

        return activeItem.panes.find((pane) => pane.id === paneId) ?? activeItem.panes[0] ?? null;
      }

      return activeItem;
    },
  };
}
