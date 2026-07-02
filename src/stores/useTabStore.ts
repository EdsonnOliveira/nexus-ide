import { useProjectStore } from '@/stores/useProjectStore';
import { useProjectNotificationStore } from '@/stores/useProjectNotificationStore';
import { useAgentComposerDraftStore } from '@/stores/useAgentComposerDraftStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { bumpFileExternalRevision } from '@/utils/fileExternalRevision';
import type { AgentTab, ApiTab, BrowserTab, EmulatorPlatform, EmulatorTab, FileTab, Tab, TabBarItem, TabType, TerminalAgent } from '@/types';
import { extractCliAgentCommand } from '@/constants/cliAgentCommands';
import { isAgentPaneTab, isLegacyAgentTerminalTab, resolveAgentPaneRootPath, resolveAgentTabCli, terminalAgentToCli } from '@/utils/agentTabHelpers';
import { resolveAgentLaunchCommand } from '@/utils/resolveAgentLaunchCommand';
import { buildCursorAgentResumeCommand } from '@/utils/cursorAgentResume';
import { parseCursorAgentHistoryTranscript } from '@/utils/parseCursorAgentHistoryTranscript';
import { hydrateAgentTurns } from '@/utils/agentPromptAttachments';
import { sanitizeAgentTurnHistory } from '@/utils/trimAgentTurnHistory';
import { stopAgentPane } from '@/utils/agentPaneRegistry';
import { normalizeBrowserUrl } from '@/utils/browserUrl';
import { createBadgeColorIndex } from '@/utils/tabBadge';
import {
  findPaneTab,
  findSplitTabByPaneId,
  mergeTabItems,
  renameTabBarItem,
  resolveActiveTabBarItem,
  unsplitTabItems,
  updatePaneInTabs,
  updateSplitTabLayout,
} from '@/utils/tabGroups';
import { findProjectIdByPaneId } from '@/utils/findProjectIdByPaneId';
import { findDiffTabByPath, findFilePreviewTabByPath, findFileTabByPath } from '@/utils/fileTabs';
import { toGitRelativePath, toRepoAbsolutePath } from '@/utils/gitPaths';
import { resolveAgentGitPromptForFile } from '@/utils/resolveAgentGitPromptForFile';
import { resolveFileViewMode } from '@/utils/fileViewMode';
import { isTabPinned, reorderTabBarItems, toggleTabPinned } from '@/utils/tabOrder';
import { updateSplitRatioAtPath } from '@/utils/splitLayout';

export interface TabStoreActions {
  addTab: (type: TabType) => Promise<void>;
  addAgentTab: (command: string) => Promise<void>;
  replaceAgentTab: (tabId: string) => Promise<void>;
  resumeAgentHistorySession: (tabId: string, chatId: string, projectPath: string) => Promise<void>;
  openBrowserTab: (url: string) => Promise<void>;
  openFileTab: (filePath: string, fileName: string) => Promise<void>;
  openFilePreviewTab: (filePath: string, fileName: string) => Promise<void>;
  openFileCodeTab: (filePath: string, fileName: string) => Promise<void>;
  openDiffTab: (
    filePath: string,
    options: { staged: boolean; untracked?: boolean; repoPath?: string; agentPrompt?: string },
  ) => Promise<void>;
  closeTab: (tabId: string) => Promise<void>;
  closeAllTabs: () => Promise<void>;
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
  updateEmulatorTab: (
    tabId: string,
    patch: Partial<Pick<EmulatorTab, 'platform' | 'deviceId' | 'sessionId' | 'title'>>,
  ) => Promise<void>;
  updateApiTab: (
    tabId: string,
    patch: Partial<Pick<ApiTab, 'requestId' | 'collectionId' | 'title'>>,
  ) => Promise<void>;
  updateAgentTab: (
    tabId: string,
    patch: Partial<
      Pick<AgentTab, 'turns' | 'workingDirectory' | 'restoreCommand' | 'cliAgent' | 'title' | 'messages'>
    >,
  ) => Promise<void>;
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
    if (pane.type === 'terminal' || pane.type === 'agent') {
      useProjectNotificationStore.getState().clearNotificationForPane(pane.id);
      useTerminalSessionStore.getState().disposePaneSession(pane.id);

      if (pane.type === 'agent') {
        useAgentComposerDraftStore.getState().clearDraft(pane.id);
      }

      if (pane.ptyId) {
        window.nexus.terminal.kill(pane.ptyId);
      }

      void window.nexus.session.removePane(pane.id);
    }

    if (pane.type === 'emulator') {
      void window.nexus.emulator.stopByTabId(pane.id);
    }
  }
}

async function resolveDefaultEmulatorPlatform(projectPath: string): Promise<EmulatorPlatform> {
  if (typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent)) {
    try {
      const kinds = await window.nexus.files.detectProjectKinds([projectPath]);

      if (kinds[projectPath] === 'mobile') {
        return 'ios';
      }
    } catch {
      return 'android';
    }
  }

  return 'android';
}

export function useTabActions(): TabStoreActions {
  const updateProject = useProjectStore((state) => state.updateProject);
  const setTabPtyId = useProjectStore((state) => state.setTabPtyId);
  const getActiveProject = useProjectStore((state) => state.getActiveProject);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);

  const getProjectSnapshot = () => getActiveProject();

  const focusPane = async (paneId: string) => {
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
      useProjectNotificationStore.getState().clearNotificationForPane(paneId);
      return;
    }

    await updateProject(project.id, {
      activeTabId: paneId,
      activePaneId: null,
    });
    useProjectNotificationStore.getState().clearNotificationForPane(paneId);
  };

  return {
    addTab: async (type) => {
      const project = getProjectSnapshot();

      if (!project) {
        return;
      }

      const tabId = crypto.randomUUID();
      const badgeColorIndex = createBadgeColorIndex(project.tabs);

      if (type === 'emulator') {
        const platform = await resolveDefaultEmulatorPlatform(project.path);
        const nextTab: EmulatorTab = {
          id: tabId,
          title: `Emulador ${countPanesByType(project.tabs, 'emulator') + 1}`,
          type: 'emulator',
          platform,
          deviceId: null,
          sessionId: null,
          badgeColorIndex,
        };

        await updateProject(project.id, {
          tabs: [...project.tabs, nextTab],
          activeTabId: tabId,
          activePaneId: null,
        });
        return;
      }

      if (type === 'api') {
        const nextTab: ApiTab = {
          id: tabId,
          title: `API Client ${countPanesByType(project.tabs, 'api') + 1}`,
          type: 'api',
          requestId: null,
          collectionId: null,
          badgeColorIndex,
        };

        await updateProject(project.id, {
          tabs: [...project.tabs, nextTab],
          activeTabId: tabId,
          activePaneId: null,
        });
        return;
      }

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
              agent: 'shell',
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
      const trimmed = command.trim();
      const cliAgent = extractCliAgentCommand(trimmed) ?? terminalAgentToCli('cursor');
      const nextTab: AgentTab = {
        id: tabId,
        title: `Agent ${countPanesByType(project.tabs, 'agent') + 1}`,
        type: 'agent',
        cliAgent,
        ptyId: null,
        messages: [],
        turns: [],
        restoreCommand: trimmed || cliAgent,
        workingDirectory: resolveAgentPaneRootPath(project.path),
        badgeColorIndex,
      };

      useTerminalSessionStore.getState().setPendingLaunchCommand(tabId, trimmed || cliAgent);

      await updateProject(project.id, {
        tabs: [...project.tabs, nextTab],
        activeTabId: tabId,
        activePaneId: null,
      });
    },
    replaceAgentTab: async (tabId) => {
      const project = getProjectSnapshot();

      if (!project) {
        return;
      }

      const pane = findPaneTab(project.tabs, tabId);

      if (!pane) {
        return;
      }

      const isDedicatedAgent = isAgentPaneTab(pane);
      const isTerminalAgent = isLegacyAgentTerminalTab(pane);

      if (!isDedicatedAgent && !isTerminalAgent) {
        return;
      }

      const rawCommand = await resolveAgentLaunchCommand(project.path);
      let cliAgent = extractCliAgentCommand(rawCommand.trim()) ?? 'cursor-agent';

      if (isDedicatedAgent && pane.type === 'agent') {
        cliAgent = extractCliAgentCommand(rawCommand.trim()) ?? pane.cliAgent;
      } else if (isTerminalAgent && pane.type === 'terminal') {
        cliAgent = extractCliAgentCommand(rawCommand.trim()) ?? terminalAgentToCli(pane.agent);
      }

      const launchCommand = rawCommand.trim() || cliAgent;

      const session = useTerminalSessionStore.getState();

      useProjectNotificationStore.getState().clearNotificationForPane(tabId);
      session.resetAgentWorkload(tabId);
      session.clearResumeChatId(tabId);

      if (isTerminalAgent && pane.type === 'terminal') {
        await session.resumeAgentSession(tabId, launchCommand, focusPane);
        return;
      }

      if (!isDedicatedAgent || pane.type !== 'agent') {
        return;
      }

      window.nexus.agentPrint.stop(tabId);

      if (pane.ptyId) {
        window.nexus.terminal.kill(pane.ptyId);
      }

      const nextTabs = updatePaneInTabs(project.tabs, tabId, (entry) =>
        entry.type === 'agent'
          ? {
              ...entry,
              turns: [],
              messages: [],
              restoreCommand: launchCommand,
              cliAgent,
              ptyId: null,
              workingDirectory: resolveAgentPaneRootPath(project.path),
            }
          : entry,
      );

      useProjectStore.setState((state) => ({
        projects: state.projects.map((entry) =>
          entry.id === project.id ? { ...entry, tabs: nextTabs } : entry,
        ),
      }));

      await updateProject(project.id, {
        tabs: nextTabs,
      });

      session.setPendingLaunchCommand(tabId, launchCommand);
      await focusPane(tabId);
    },
    resumeAgentHistorySession: async (tabId, chatId, projectPath) => {
      const project = getProjectSnapshot();

      if (!project) {
        return;
      }

      const pane = findPaneTab(project.tabs, tabId);

      if (!pane) {
        return;
      }

      const isDedicatedAgent = isAgentPaneTab(pane);
      const isTerminalAgent = isLegacyAgentTerminalTab(pane);

      if (!isDedicatedAgent && !isTerminalAgent) {
        return;
      }

      const resumeCommand = buildCursorAgentResumeCommand(chatId, projectPath);
      const session = useTerminalSessionStore.getState();

      useProjectNotificationStore.getState().clearNotificationForPane(tabId);
      session.resetAgentWorkload(tabId);

      if (isTerminalAgent && pane.type === 'terminal') {
        await session.resumeAgentSession(tabId, resumeCommand, focusPane);
        return;
      }

      if (!isDedicatedAgent || pane.type !== 'agent') {
        return;
      }

      window.nexus.agentPrint.stop(tabId);
      stopAgentPane(tabId);

      session.setRestarting(tabId, true);

      try {
        const workspacePath = resolveAgentPaneRootPath(project.path);
        let transcriptRaw: string | null = null;

        try {
          transcriptRaw = await window.nexus.files.loadCursorAgentSessionTranscript(
            workspacePath,
            chatId,
          );
        } catch {
          transcriptRaw = null;
        }

        const turns = transcriptRaw ? parseCursorAgentHistoryTranscript(transcriptRaw) : [];
        const hydratedTurns = sanitizeAgentTurnHistory(
          await hydrateAgentTurns(workspacePath, turns),
        );

        session.setResumeChatId(tabId, chatId);
        session.setActiveAgent(tabId, 'cursor-agent');
        session.takePendingLaunchCommand(tabId);

        const nextTabs = updatePaneInTabs(project.tabs, tabId, (entry) =>
          entry.type === 'agent'
            ? {
                ...entry,
                turns: hydratedTurns,
                messages: [],
                restoreCommand: null,
                cliAgent: 'cursor-agent',
                workingDirectory: workspacePath,
              }
            : entry,
        );

        useProjectStore.setState((state) => ({
          projects: state.projects.map((entry) =>
            entry.id === project.id ? { ...entry, tabs: nextTabs } : entry,
          ),
        }));

        await updateProject(project.id, {
          tabs: nextTabs,
        });

        await focusPane(tabId);
      } finally {
        session.setRestarting(tabId, false);
      }
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
        bumpFileExternalRevision(filePath);
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
    openFilePreviewTab: async (filePath, fileName) => {
      const project = getProjectSnapshot();

      if (!project) {
        return;
      }

      const existing = findFilePreviewTabByPath(project.tabs, filePath);

      if (existing) {
        bumpFileExternalRevision(filePath);
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
        viewMode: 'preview',
        badgeColorIndex: createBadgeColorIndex(project.tabs),
      };

      await updateProject(project.id, {
        tabs: [...project.tabs, nextTab],
        activeTabId: tabId,
        activePaneId: null,
      });
    },
    openFileCodeTab: async (filePath, fileName) => {
      const project = getProjectSnapshot();

      if (!project) {
        return;
      }

      const previewTab = findFilePreviewTabByPath(project.tabs, filePath);

      if (previewTab) {
        bumpFileExternalRevision(filePath);
        const updatedTabs = updatePaneInTabs(project.tabs, previewTab.id, (entry) =>
          entry.type === 'file' ? { ...entry, viewMode: 'code' } : entry,
        );
        const splitTab = findSplitTabByPaneId(updatedTabs, previewTab.id);

        if (splitTab) {
          await updateProject(project.id, {
            activeTabId: splitTab.id,
            activePaneId: previewTab.id,
            tabs: updatedTabs.map((item) =>
              item.id === splitTab.id && item.type === 'split'
                ? { ...item, activePaneId: previewTab.id }
                : item,
            ),
          });
          return;
        }

        await updateProject(project.id, {
          activeTabId: previewTab.id,
          activePaneId: null,
          tabs: updatedTabs,
        });
        return;
      }

      const existing = findFileTabByPath(project.tabs, filePath);

      if (existing) {
        bumpFileExternalRevision(filePath);
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
        viewMode: 'code',
        badgeColorIndex: createBadgeColorIndex(project.tabs),
      };

      await updateProject(project.id, {
        tabs: [...project.tabs, nextTab],
        activeTabId: tabId,
        activePaneId: null,
      });
    },
    openDiffTab: async (filePath, options) => {
      const project = getProjectSnapshot();

      if (!project) {
        return;
      }

      const staged = options.staged;
      const untracked = options.untracked ?? false;
      const repoPath = options.repoPath ?? project.path;
      const gitRelativePath = toGitRelativePath(repoPath, filePath);
      const absoluteFilePath = toRepoAbsolutePath(repoPath, gitRelativePath);
      const agentPrompt =
        options.agentPrompt ??
        resolveAgentGitPromptForFile(project.id, absoluteFilePath, repoPath) ??
        undefined;
      const sides = await window.nexus.git.getFileDiffSides(repoPath, gitRelativePath, {
        staged,
        untracked,
      });
      const existing = findDiffTabByPath(project.tabs, absoluteFilePath, { staged, untracked });

      if (existing) {
        const refreshedTabs = updatePaneInTabs(project.tabs, existing.id, (entry) =>
          entry.type === 'file' && entry.viewMode === 'diff'
            ? {
                ...entry,
                diffBefore: sides.before,
                diffAfter: sides.after,
                diffRepoPath: repoPath,
                diffAgentPrompt: agentPrompt,
              }
            : entry,
        );
        const splitTab = findSplitTabByPaneId(refreshedTabs, existing.id);

        if (splitTab) {
          await updateProject(project.id, {
            activeTabId: splitTab.id,
            activePaneId: existing.id,
            tabs: refreshedTabs.map((item) =>
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
          tabs: refreshedTabs,
        });
        return;
      }

      const fileName = gitRelativePath.split('/').pop() ?? gitRelativePath;
      const tabId = crypto.randomUUID();
      const nextTab: FileTab = {
        id: tabId,
        title: `${fileName} (diff)`,
        type: 'file',
        filePath: absoluteFilePath,
        viewMode: 'diff',
        diffBefore: sides.before,
        diffAfter: sides.after,
        diffStaged: staged,
        diffUntracked: untracked,
        diffRepoPath: repoPath,
        diffAgentPrompt: agentPrompt,
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
    closeAllTabs: async () => {
      const project = getProjectSnapshot();

      if (!project) {
        return;
      }

      const tabsToClose = project.tabs.filter((item) => !isTabPinned(item));

      if (tabsToClose.length === 0) {
        return;
      }

      for (const tab of tabsToClose) {
        killTabBarItem(tab);
      }

      const nextTabs = project.tabs.filter((item) => isTabPinned(item));
      const activeTabId = nextTabs.some((item) => item.id === project.activeTabId)
        ? project.activeTabId
        : (nextTabs[0]?.id ?? null);

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

      const activePaneIdForNotification =
        selectedTab?.type === 'split'
          ? activePaneId
          : selectedTab
            ? tabId
            : null;

      if (activePaneIdForNotification) {
        useProjectNotificationStore.getState().clearNotificationForPane(activePaneIdForNotification);
      }
    },
    selectPane: async (paneId) => {
      await focusPane(paneId);
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

      const activeItem = resolveActiveTabBarItem(project.tabs, project.activeTabId);

      if (!activeItem) {
        return;
      }

      const activeIndex = project.tabs.findIndex((tab) => tab.id === activeItem.id);
      const neighbor = project.tabs[activeIndex + 1] ?? project.tabs[activeIndex - 1];

      if (!neighbor) {
        return;
      }

      const side = activeIndex + 1 < project.tabs.length ? 'right' : 'left';

      const merged = mergeTabItems(project.tabs, activeItem.id, neighbor.id, side);

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

      if (pane?.type === 'agent' && pane.ptyId) {
        window.nexus.terminal.kill(pane.ptyId);
      }

      if (activeProjectId) {
        setTabPtyId(activeProjectId, tabId, null);
      }

      await updateProject(project.id, {
        tabs: updatePaneInTabs(project.tabs, tabId, (entry) => {
          if (entry.type === 'terminal') {
            return { ...entry, agent, ptyId: null };
          }

          if (entry.type === 'agent') {
            return {
              ...entry,
              cliAgent: terminalAgentToCli(agent),
              ptyId: null,
            };
          }

          return entry;
        }),
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
    updateEmulatorTab: async (tabId, patch) => {
      const project = getProjectSnapshot();

      if (!project) {
        return;
      }

      await updateProject(project.id, {
        tabs: updatePaneInTabs(project.tabs, tabId, (entry) =>
          entry.type === 'emulator' ? { ...entry, ...patch } : entry,
        ),
      });
    },
    updateApiTab: async (tabId, patch) => {
      const project = getProjectSnapshot();

      if (!project) {
        return;
      }

      await updateProject(project.id, {
        tabs: updatePaneInTabs(project.tabs, tabId, (entry) =>
          entry.type === 'api' ? { ...entry, ...patch } : entry,
        ),
      });
    },
    updateAgentTab: async (tabId, patch) => {
      const projectId = findProjectIdByPaneId(tabId);

      if (!projectId) {
        return;
      }

      const project = useProjectStore.getState().projects.find((entry) => entry.id === projectId);

      if (!project) {
        return;
      }

      const patchWithTrim =
        patch.turns !== undefined
          ? { ...patch, turns: sanitizeAgentTurnHistory(patch.turns) }
          : patch;

      const nextTabs = updatePaneInTabs(project.tabs, tabId, (entry) =>
        entry.type === 'agent' ? { ...entry, ...patchWithTrim } : entry,
      );

      useProjectStore.setState((state) => ({
        projects: state.projects.map((entry) =>
          entry.id === project.id ? { ...entry, tabs: nextTabs } : entry,
        ),
      }));

      await updateProject(project.id, {
        tabs: nextTabs,
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
