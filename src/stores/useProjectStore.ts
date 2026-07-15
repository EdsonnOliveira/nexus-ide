import { create } from 'zustand';
import type { AgentTurn, AppState, MailMailboxRef, Project, ProjectUpdatePayload, Tab, TabBarItem, Workspace, WorkspaceUpdatePayload } from '@/types';
import { PROJECT_COLORS } from '@/types';
import {
  migrateProjectTestEntry,
} from '@/utils/testLabels';
import { migrateLegacyProjectTabs } from '@/utils/migrateTabs';
import { rawAgentTurnHistoryNeedsTrim, trimAgentTurnsInTabBarItems } from '@/utils/trimAgentTurnHistory';
import { useAutomationExecutionStore } from '@/stores/useAutomationExecutionStore';
import { useProjectNotificationStore } from '@/stores/useProjectNotificationStore';
import {
  countBusyAgentPanes,
  beginProjectSwitch,
  endProjectSwitch,
  persistLeavingProjectState,
  resetProjectSwitchState,
} from '@/utils/projectSwitch';
import { findPaneTab, resolveFallbackActiveTabId, updatePaneInTabs } from '@/utils/tabGroups';
import { shouldPreferLocalAgentTurnHistory } from '@/utils/paneAgentSession';
import { readHomeAgentMap } from '@/utils/homeDashboardAgents';
import {
  restoreSidebarVideoSession,
  toPersistedSidebarVideoSession,
  type SidebarVideoSession,
} from '@/utils/sidebarVideoProviders';

function hasMissingBadgeColorIndex(tabs: TabBarItem[]): boolean {
  for (const tab of tabs) {
    if (tab.badgeColorIndex === undefined) {
      return true;
    }

    if (tab.type === 'split') {
      for (const pane of tab.panes) {
        if (pane.badgeColorIndex === undefined) {
          return true;
        }
      }
    }
  }

  return false;
}

export type ExplorerView = 'tree' | 'git';

export type SidePanel = 'explorer' | 'passwords' | 'automations' | 'tasks' | 'tests' | 'brain' | null;

interface ProjectStoreState {
  projects: Project[];
  workspaces: Workspace[];
  activeProjectId: string | null;
  activeWorkspaceId: string | null;
  selectingProjectId: string | null;
  sidebarCollapsed: boolean;
  sidePanel: SidePanel;
  explorerView: ExplorerView;
  sidebarVideoSession: SidebarVideoSession | null;
  sidebarVideoLastLink: string | null;
  initialized: boolean;
  projectsMigrated: boolean;
  initialize: () => Promise<void>;
  addProject: () => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  stopProject: (id: string) => Promise<void>;
  selectProject: (id: string, options?: { syncWorkspace?: boolean }) => Promise<void>;
  leaveActiveProject: () => Promise<void>;
  updateProject: (id: string, data: ProjectUpdatePayload) => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  updateWorkspace: (id: string, data: WorkspaceUpdatePayload) => Promise<void>;
  selectWorkspace: (id: string | null) => Promise<void>;
  removeWorkspace: (id: string) => Promise<void>;
  moveProjectToWorkspace: (projectId: string, workspaceId: string) => Promise<void>;
  toggleSidebar: () => Promise<void>;
  toggleExplorer: () => void;
  toggleExplorerEntry: (preferGit: boolean) => void;
  toggleExplorerGit: () => void;
  openExplorerGit: () => void;
  togglePasswords: () => void;
  toggleAutomations: () => void;
  toggleTasks: () => void;
  toggleTests: () => void;
  toggleBrain: () => void;
  setSidePanel: (panel: SidePanel | 'git') => void;
  startSidebarVideoSession: (session: SidebarVideoSession, lastLink?: string) => Promise<void>;
  setSidebarVideoLastLink: (link: string | null) => Promise<void>;
  closeSidebarVideoSession: () => Promise<void>;
  setActiveProjectWhatsAppLink: (link: string | null) => Promise<void>;
  setActiveProjectMailInbox: (mailbox: MailMailboxRef | null) => Promise<void>;
  getActiveProject: () => Project | null;
  setTabPtyId: (projectId: string, tabId: string, ptyId: string | null) => void;
}

function migrateLegacyGlobalWhatsAppLink(appState: AppState): AppState {
  const legacyLink = (appState as AppState & { sidebarWhatsAppLink?: string | null })
    .sidebarWhatsAppLink;

  if (!legacyLink || !appState.activeProjectId) {
    return appState;
  }

  return {
    ...appState,
    projects: appState.projects.map((project) =>
      project.id === appState.activeProjectId && !project.whatsappLink
        ? { ...project, whatsappLink: legacyLink }
        : project,
    ),
  };
}

function migrateProject(project: Project, fallbackWorkspaceId: string): Project {
  const legacyProject = project as Project & { layout?: unknown };
  const { layout: legacyLayout, ...projectWithoutLegacyLayout } = legacyProject;
  const migrated = migrateLegacyProjectTabs(
    projectWithoutLegacyLayout.tabs,
    legacyLayout as never,
    projectWithoutLegacyLayout.activeTabId,
    projectWithoutLegacyLayout.path,
  );
  const tabs = trimAgentTurnsInTabBarItems(migrated.tabs);
  const activeTabId = resolveFallbackActiveTabId(tabs, migrated.activeTabId);

  return {
    ...projectWithoutLegacyLayout,
    workspaceId: projectWithoutLegacyLayout.workspaceId ?? fallbackWorkspaceId,
    iconCustomized:
      projectWithoutLegacyLayout.iconCustomized ?? projectWithoutLegacyLayout.icon.startsWith('preset:'),
    tabs,
    activeTabId,
    activePaneId: migrated.activePaneId,
    automations: projectWithoutLegacyLayout.automations ?? [],
    whatsappLink: projectWithoutLegacyLayout.whatsappLink ?? null,
    mailInbox: projectWithoutLegacyLayout.mailInbox ?? null,
    testEntries: (projectWithoutLegacyLayout.testEntries ?? []).map(migrateProjectTestEntry),
    agentGitGroups: projectWithoutLegacyLayout.agentGitGroups ?? [],
    agentResponseSkills: projectWithoutLegacyLayout.agentResponseSkills ?? [],
    terminalQuickCommands: projectWithoutLegacyLayout.terminalQuickCommands ?? [],
    flag: projectWithoutLegacyLayout.flag ?? null,
  };
}

function migrateWorkspace(
  workspace: Pick<Workspace, 'id' | 'name'> & Partial<Workspace>,
  index: number,
): Workspace {
  const color = workspace.color ?? PROJECT_COLORS[index % PROJECT_COLORS.length];
  const icon = workspace.icon ?? workspace.name.charAt(0).toUpperCase() ?? 'W';

  return {
    id: workspace.id,
    name: workspace.name,
    color,
    icon,
    iconCustomized: workspace.iconCustomized ?? icon.startsWith('preset:'),
    logo: workspace.logo ?? null,
    flag: workspace.flag ?? null,
  };
}

function createDefaultWorkspace(): Workspace {
  return migrateWorkspace({ id: crypto.randomUUID(), name: 'Padrão' }, 0);
}

function migrateAppState(appState: AppState): AppState {
  const rawWorkspaces =
    appState.workspaces.length > 0
      ? appState.workspaces
      : [createDefaultWorkspace()];

  const workspaces = rawWorkspaces.map((workspace, index) => migrateWorkspace(workspace, index));
  const fallbackWorkspaceId = workspaces[0]?.id ?? crypto.randomUUID();

  return migrateLegacyGlobalWhatsAppLink({
    ...appState,
    workspaces,
    activeWorkspaceId: appState.activeWorkspaceId ?? null,
    projects: appState.projects.map((project) => migrateProject(project, fallbackWorkspaceId)),
  });
}

function yieldToNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function migrateAppStateChunked(appState: AppState): Promise<AppState> {
  const rawWorkspaces =
    appState.workspaces.length > 0
      ? appState.workspaces
      : [createDefaultWorkspace()];

  const workspaces = rawWorkspaces.map((workspace, index) => migrateWorkspace(workspace, index));
  const fallbackWorkspaceId = workspaces[0]?.id ?? crypto.randomUUID();
  const migratedProjects: Project[] = [];

  for (let index = 0; index < appState.projects.length; index += 1) {
    const project = appState.projects[index];
    migratedProjects.push(migrateProject(project, fallbackWorkspaceId));
    await yieldToNextFrame();
  }

  return migrateLegacyGlobalWhatsAppLink({
    ...appState,
    workspaces,
    activeWorkspaceId: appState.activeWorkspaceId ?? null,
    projects: migratedProjects,
  });
}

function applyState(
  set: (state: Partial<ProjectStoreState>) => void,
  appState: AppState,
  options?: { preserveActiveProjectId?: string | null },
) {
  const projects = appState.projects.map((project) => {
    const activeTabId = resolveFallbackActiveTabId(project.tabs, project.activeTabId);

    if (activeTabId === project.activeTabId) {
      return project;
    }

    return { ...project, activeTabId };
  });

  const hasPreservedActiveProjectId = Boolean(
    options && 'preserveActiveProjectId' in options,
  );
  const preservedActiveProjectId = options?.preserveActiveProjectId;
  let activeProjectId: string | null;

  if (hasPreservedActiveProjectId) {
    if (preservedActiveProjectId === null) {
      activeProjectId = null;
    } else if (
      preservedActiveProjectId &&
      projects.some((project) => project.id === preservedActiveProjectId)
    ) {
      activeProjectId = preservedActiveProjectId;
    } else if (
      appState.activeProjectId &&
      projects.some((project) => project.id === appState.activeProjectId)
    ) {
      activeProjectId = appState.activeProjectId;
    } else {
      activeProjectId = null;
    }
  } else if (
    appState.activeProjectId &&
    projects.some((project) => project.id === appState.activeProjectId)
  ) {
    activeProjectId = appState.activeProjectId;
  } else {
    activeProjectId = appState.activeProjectId;
  }

  set({
    projects,
    workspaces: appState.workspaces,
    activeProjectId,
    activeWorkspaceId: appState.activeWorkspaceId,
  });
}

function scheduleProjectMigration(
  set: (state: Partial<ProjectStoreState>) => void,
  get: () => ProjectStoreState,
  rawState: AppState,
): void {
  void (async () => {
    try {      const shouldPersistBadgeColors = rawState.projects.some((project) =>
        hasMissingBadgeColorIndex(project.tabs),
      );
      const shouldPersistTrimmedAgentHistory = rawState.projects.some((project) =>
        rawAgentTurnHistoryNeedsTrim(project.tabs),
      );
      const appState = await migrateAppStateChunked(rawState);
      const preservedActiveProjectId = get().activeProjectId;
      const activeProject = preservedActiveProjectId
        ? appState.projects.find((project) => project.id === preservedActiveProjectId)
        : null;

      set({
        projects: appState.projects,
        workspaces: appState.workspaces,
        activeWorkspaceId: appState.activeWorkspaceId ?? null,
        activeProjectId: preservedActiveProjectId,
        projectsMigrated: true,
        sidebarCollapsed: activeProject?.sidebarCollapsed ?? false,
      });
      window.setTimeout(() => {
        void Promise.all([
          import('@/utils/hydrateTerminalSession'),
          import('@/utils/persistAgentGitGroups'),
        ]).then(([{ hydrateTerminalSessionFromProjects }, { hydrateAgentGitGroupsFromProjects }]) => {
          hydrateTerminalSessionFromProjects(appState.projects);
          hydrateAgentGitGroupsFromProjects(appState.projects);
        });
      }, 0);

      if (shouldPersistBadgeColors || shouldPersistTrimmedAgentHistory) {
        for (const project of appState.projects) {
          const currentProject = get().projects.find((entry) => entry.id === project.id);
          const rawProject = rawState.projects.find((entry) => entry.id === project.id);

          if (!currentProject) {
            continue;
          }

          if (
            !shouldPersistBadgeColors &&
            (!rawProject || !rawAgentTurnHistoryNeedsTrim(rawProject.tabs))
          ) {
            continue;
          }

          await window.nexus.projects.update(currentProject.id, { tabs: currentProject.tabs });
        }
      }
    } catch (error) {
      console.error('[project-store] migration failed', error);
      set({ projectsMigrated: true });
    }
  })();
}

function buildTerminalPtyIdMap(projects: Project[]): Map<string, Map<string, string | null>> {
  const projectMap = new Map<string, Map<string, string | null>>();

  for (const project of projects) {
    const paneMap = new Map<string, string | null>();

    for (const item of project.tabs) {
      const panes = item.type === 'split' ? item.panes : [item];

      for (const pane of panes) {
        if (pane.type === 'terminal' || pane.type === 'agent') {
          if (pane.ptyId) {
            paneMap.set(pane.id, pane.ptyId);
          }
        }
      }
    }

    if (paneMap.size > 0) {
      projectMap.set(project.id, paneMap);
    }
  }

  return projectMap;
}

function mergePtyIdsIntoTabs(
  tabs: TabBarItem[],
  paneMap: Map<string, string | null>,
): TabBarItem[] {
  return tabs.map((item) => {
    if (item.type === 'split') {
      return {
        ...item,
        panes: item.panes.map((pane) => {
          const ptyId = paneMap.get(pane.id);

          if ((pane.type === 'terminal' || pane.type === 'agent') && ptyId) {
            return { ...pane, ptyId };
          }

          return pane;
        }),
      };
    }

    const ptyId = paneMap.get(item.id);

    if ((item.type === 'terminal' || item.type === 'agent') && ptyId) {
      return { ...item, ptyId };
    }

    return item;
  });
}

function buildAgentTurnsMap(projects: Project[]): Map<string, AgentTurn[]> {
  const turnsByPane = new Map<string, AgentTurn[]>();

  for (const project of projects) {
    for (const item of project.tabs) {
      const panes = item.type === 'split' ? item.panes : [item];

      for (const pane of panes) {
        if (pane.type !== 'agent') {
          continue;
        }

        const turns = pane.turns ?? [];

        if (turns.length > 0) {
          turnsByPane.set(pane.id, turns);
        }
      }
    }
  }

  return turnsByPane;
}

function mergeAgentTurnsIntoTabs(
  tabs: TabBarItem[],
  prevTurnsByPane: Map<string, AgentTurn[]>,
): TabBarItem[] {
  return tabs.map((item) => {
    if (item.type === 'split') {
      return {
        ...item,
        panes: item.panes.map((pane) => {
          if (pane.type !== 'agent') {
            return pane;
          }

          const prevTurns = prevTurnsByPane.get(pane.id);

          if (!prevTurns || prevTurns.length === 0) {
            return pane;
          }

          const nextTurns = pane.turns ?? [];
          const prevRunning = prevTurns.some((turn) => turn.running);

          if (nextTurns.length === 0) {
            return prevRunning ? { ...pane, turns: prevTurns } : pane;
          }

          if (shouldPreferLocalAgentTurnHistory(prevTurns, nextTurns)) {
            return { ...pane, turns: prevTurns };
          }

          return pane;
        }),
      };
    }

    if (item.type !== 'agent') {
      return item;
    }

    const prevTurns = prevTurnsByPane.get(item.id);

    if (!prevTurns || prevTurns.length === 0) {
      return item;
    }

    const nextTurns = item.turns ?? [];
    const prevRunning = prevTurns.some((turn) => turn.running);

    if (nextTurns.length === 0) {
      return prevRunning ? { ...item, turns: prevTurns } : item;
    }

    if (shouldPreferLocalAgentTurnHistory(prevTurns, nextTurns)) {
      return { ...item, turns: prevTurns };
    }

    return item;
  });
}

function mergeMissingHomeBoundAgentTabs(
  nextProjects: Project[],
  prevProjects: Project[],
): Project[] {
  const homeMap = readHomeAgentMap();

  if (Object.keys(homeMap).length === 0) {
    return nextProjects;
  }

  const prevById = new Map(prevProjects.map((project) => [project.id, project]));
  let changed = false;

  const merged = nextProjects.map((project) => {
    const paneIds = homeMap[project.id] ?? [];

    if (paneIds.length === 0) {
      return project;
    }

    const prevProject = prevById.get(project.id);

    if (!prevProject) {
      return project;
    }

    let tabs = project.tabs;
    let projectChanged = false;

    for (const paneId of paneIds) {
      if (findPaneTab(tabs, paneId)) {
        continue;
      }

      const prevTopLevel = prevProject.tabs.find((item) => item.id === paneId);
      const prevPane =
        prevTopLevel?.type === 'agent'
          ? prevTopLevel
          : (() => {
              const found = findPaneTab(prevProject.tabs, paneId);
              return found?.type === 'agent' ? found : null;
            })();

      if (!prevPane) {
        continue;
      }

      tabs = [...tabs, prevPane];
      projectChanged = true;
    }

    if (!projectChanged) {
      return project;
    }

    changed = true;
    return {
      ...project,
      tabs,
    };
  });

  return changed ? merged : nextProjects;
}

function preserveRuntimePtyIds(next: AppState, prev: AppState): AppState {
  const prevMap = buildTerminalPtyIdMap(prev.projects);
  const prevTurnsByPane = buildAgentTurnsMap(prev.projects);
  const withHomeAgents = mergeMissingHomeBoundAgentTabs(next.projects, prev.projects);

  for (const project of withHomeAgents) {
    const original = next.projects.find((entry) => entry.id === project.id);

    if (!original || project.tabs.length <= original.tabs.length) {
      continue;
    }

    void window.nexus.projects.update(project.id, {
      tabs: project.tabs,
      activeTabId: project.activeTabId,
      activePaneId: project.activePaneId,
    });
  }

  if (prevMap.size === 0 && prevTurnsByPane.size === 0 && withHomeAgents === next.projects) {
    return next;
  }

  return {
    ...next,
    projects: withHomeAgents.map((project) => {
      const paneMap = prevMap.get(project.id);
      let tabs = project.tabs;

      if (paneMap) {
        tabs = mergePtyIdsIntoTabs(tabs, paneMap);
      }

      if (prevTurnsByPane.size > 0) {
        tabs = mergeAgentTurnsIntoTabs(tabs, prevTurnsByPane);
      }

      if (tabs === project.tabs) {
        return project;
      }

      return {
        ...project,
        tabs,
      };
    }),
  };
}

function applyStatePreservingRuntime(
  set: (state: Partial<ProjectStoreState>) => void,
  get: () => ProjectStoreState,
  appState: AppState,
  prev: AppState,
) {
  const current = get();

  applyState(set, preserveRuntimePtyIds(appState, prev), {
    preserveActiveProjectId: current.activeProjectId,
  });

  if (current.activeWorkspaceId !== appState.activeWorkspaceId) {
    set({ activeWorkspaceId: current.activeWorkspaceId });
  }
}

function reconcileOptimisticProjectUpdate(
  appState: AppState,
  optimisticProjects: Project[],
  updatedId: string,
): AppState {
  return {
    ...appState,
    projects: appState.projects.map((project) => {
      if (project.id !== updatedId) {
        return project;
      }

      const optimisticProject = optimisticProjects.find((entry) => entry.id === updatedId);

      if (!optimisticProject) {
        return project;
      }

      const backendTabIds = new Set(project.tabs.map((tab) => tab.id));
      const hasMissingOptimisticTab = optimisticProject.tabs.some((tab) => !backendTabIds.has(tab.id));

      if (!hasMissingOptimisticTab && optimisticProject.tabs.length <= project.tabs.length) {
        return project;
      }

      return {
        ...project,
        tabs: optimisticProject.tabs,
        activeTabId: resolveFallbackActiveTabId(
          optimisticProject.tabs,
          optimisticProject.activeTabId,
        ),
        activePaneId: optimisticProject.activePaneId,
      };
    }),
  };
}

function getWorkspaceProjects(projects: Project[], workspaceId: string | null): Project[] {
  if (workspaceId === null) {
    return projects;
  }

  return projects.filter((project) => project.workspaceId === workspaceId);
}

async function performSelectProject(
  set: (state: Partial<ProjectStoreState>) => void,
  get: () => ProjectStoreState,
  id: string,
  options?: { syncWorkspace?: boolean },
): Promise<void> {
  set({ selectingProjectId: id });

  try {
    const prevState = get();
    const leavingProjectId = prevState.activeProjectId;
    const selectedProject = prevState.projects.find((project) => project.id === id);

    void countBusyAgentPanes().then((agentPanesBusy) => {
      console.info('[project-switch] start', {
        leavingProjectId,
        newProjectId: id,
        agentPanesBusy,
      });
    });

    if (
      options?.syncWorkspace !== false &&
      selectedProject?.workspaceId &&
      prevState.activeWorkspaceId !== null &&
      selectedProject.workspaceId !== prevState.activeWorkspaceId
    ) {
      await window.nexus.projects.selectWorkspace(selectedProject.workspaceId);
      set({ activeWorkspaceId: selectedProject.workspaceId });
    }

    await window.nexus.projects.select(id);

    set({
      activeProjectId: id,
      sidePanel: null,
      explorerView: 'tree',
      selectingProjectId: null,
    });

    const { restoreActiveAgentsFromProjects } = await import('@/utils/hydrateTerminalSession');
    restoreActiveAgentsFromProjects(prevState.projects);

    if (leavingProjectId && leavingProjectId !== id) {
      persistLeavingProjectState(prevState.projects, leavingProjectId);
    }

    console.info('[project-switch] complete', {
      leavingProjectId,
      newProjectId: id,
    });
  } catch (error) {
    console.error('[project-switch] failed', {
      newProjectId: id,
      error,
    });
    set({ selectingProjectId: null });
  }
}

export const useProjectStore = create<ProjectStoreState>((set, get) => ({
  projects: [],
  workspaces: [],
  activeProjectId: null,
  activeWorkspaceId: null,
  selectingProjectId: null,
  sidebarCollapsed: false,
  sidePanel: null,
  explorerView: 'tree',
  sidebarVideoSession: null,
  sidebarVideoLastLink: null,
  initialized: false,
  projectsMigrated: false,
  initialize: async () => {
    if (get().initialized) {
      return;
    }

    resetProjectSwitchState();

    try {      const rawState = await window.nexus.projects.list();
      const appState = migrateAppState(rawState);
      await window.nexus.projects.clearActiveProject();
      const workspaces =
        appState.workspaces.length > 0
          ? appState.workspaces
          : [createDefaultWorkspace()];
      const restoredVideoSession = appState.sidebarVideoSession
        ? restoreSidebarVideoSession(appState.sidebarVideoSession)
        : null;

      set({
        projects: appState.projects,
        workspaces,
        activeProjectId: null,
        activeWorkspaceId: appState.activeWorkspaceId ?? null,
        initialized: true,
        projectsMigrated: false,
        sidebarCollapsed: false,
        sidebarVideoSession: restoredVideoSession,
        sidebarVideoLastLink:
          appState.sidebarVideoLastLink ?? appState.sidebarVideoSession?.sourceUrl ?? null,
      });
      scheduleProjectMigration(set, get, rawState);
    } catch (error) {
      console.error('[project-store] initialize failed', error);
      set({ initialized: true, projectsMigrated: true });
    }
  },
  addProject: async () => {
    const projectPath = await window.nexus.dialog.openDirectory();

    if (!projectPath) {
      return;
    }

    const prevState = get();
    const { activeWorkspaceId, workspaces } = prevState;
    const workspaceId = activeWorkspaceId ?? workspaces[0]?.id ?? null;

    await window.nexus.projects.add(projectPath, workspaceId);
    const appState = migrateAppState(await window.nexus.projects.list());
    applyStatePreservingRuntime(set, get, appState, prevState);
  },
  removeProject: async (id) => {
    const { useTerminalSessionStore } = await import('@/stores/useTerminalSessionStore');
    const project = get().projects.find((item) => item.id === id);

    if (project) {
      useProjectNotificationStore.getState().clearProjectNotification(id);

      for (const item of project.tabs) {
        const panes: Tab[] = item.type === 'split' ? item.panes : [item];

        for (const pane of panes) {
          if (pane.type === 'terminal') {
            useProjectNotificationStore.getState().clearNotificationForPane(pane.id);
            useTerminalSessionStore.getState().disposePaneSession(pane.id);

            if (pane.ptyId) {
              window.nexus.terminal.kill(pane.ptyId);
            }

            void window.nexus.session.removePane(pane.id);
            continue;
          }
        }
      }
    }

    const prevState = get();
    const { useAgentGitChangeStore } = await import('@/stores/useAgentGitChangeStore');
    const { flushAgentGitGroupsNow } = await import('@/utils/persistAgentGitGroups');
    useAgentGitChangeStore.getState().clearProject(id);
    await flushAgentGitGroupsNow();
    await window.nexus.projects.remove(id);
    const appState = migrateAppState(await window.nexus.projects.list());
    applyStatePreservingRuntime(set, get, appState, prevState);
  },
  stopProject: async (id) => {
    const { useTerminalSessionStore } = await import('@/stores/useTerminalSessionStore');
    const project = get().projects.find((item) => item.id === id);

    if (!project || project.tabs.length === 0) {
      return;
    }

    useProjectNotificationStore.getState().clearProjectNotification(id);
    useAutomationExecutionStore.getState().clearAutomationRunning(id);

    for (const item of project.tabs) {
      const panes: Tab[] = item.type === 'split' ? item.panes : [item];

      for (const pane of panes) {
        if (pane.type === 'terminal') {
          useProjectNotificationStore.getState().clearNotificationForPane(pane.id);
          useTerminalSessionStore.getState().disposePaneSession(pane.id);

          if (pane.ptyId) {
            window.nexus.terminal.kill(pane.ptyId);
          }

          void window.nexus.session.removePane(pane.id);
          continue;
        }

        if (pane.type === 'emulator') {
          void window.nexus.emulator.stopByTabId(pane.id);
        }
      }
    }

    await get().updateProject(id, {
      tabs: [],
      activeTabId: null,
      activePaneId: null,
    });
  },
  selectProject: async (id, options) => {
    if (id === get().activeProjectId) {
      return;
    }

    if (!beginProjectSwitch()) {
      console.warn('[project-switch] skipped concurrent selectProject', { newProjectId: id });
      return;
    }

    try {
      await performSelectProject(set, get, id, options);
    } finally {
      await endProjectSwitch();
    }
  },
  leaveActiveProject: async () => {
    const prevState = get();
    const leavingProjectId = prevState.activeProjectId;

    if (!leavingProjectId) {
      return;
    }

    if (!beginProjectSwitch()) {
      return;
    }

    set({ selectingProjectId: leavingProjectId });

    try {
      await window.nexus.projects.clearActiveProject();

      set({
        activeProjectId: null,
        sidePanel: null,
        selectingProjectId: null,
      });

      persistLeavingProjectState(prevState.projects, leavingProjectId);
    } catch (error) {
      console.error('[project-switch] leaveActiveProject failed', { error });
      set({ selectingProjectId: null });
    } finally {
      await endProjectSwitch();
    }
  },
  updateProject: async (id, data) => {
    const prevState = get();
    const nextProjects = prevState.projects.map((project) => {
      if (project.id !== id) {
        return project;
      }

      const merged = { ...project, ...data };

      return {
        ...merged,
        activeTabId: resolveFallbackActiveTabId(merged.tabs, merged.activeTabId ?? null),
      };
    });

    set({ projects: nextProjects });

    await window.nexus.projects.update(id, data);
    const appState = migrateAppState(await window.nexus.projects.list());
    const reconciled = reconcileOptimisticProjectUpdate(appState, nextProjects, id);
    applyStatePreservingRuntime(set, get, reconciled, {
      ...prevState,
      projects: nextProjects,
    });

    if (data.agentGitGroups !== undefined) {
      const { hydrateAgentGitGroupsFromProjects } = await import('@/utils/persistAgentGitGroups');
      hydrateAgentGitGroupsFromProjects(reconciled.projects);
    }
  },
  createWorkspace: async (name) => {
    const prevState = get();
    await window.nexus.projects.createWorkspace(name);
    const appState = migrateAppState(await window.nexus.projects.list());
    applyStatePreservingRuntime(set, get, appState, prevState);
  },
  updateWorkspace: async (id, data) => {
    const prevState = get();
    await window.nexus.projects.updateWorkspace(id, data);
    const appState = migrateAppState(await window.nexus.projects.list());
    applyStatePreservingRuntime(set, get, appState, prevState);
  },
  selectWorkspace: async (id) => {
    const prevState = get();

    if (prevState.activeWorkspaceId === id) {
      return;
    }

    if (!beginProjectSwitch()) {
      return;
    }

    try {
      const filteredProjects = getWorkspaceProjects(prevState.projects, id);
      const targetProjectId = filteredProjects[0]?.id ?? null;
      const leavingProjectId = prevState.activeProjectId;

      await window.nexus.projects.selectWorkspace(id);
      set({ activeWorkspaceId: id });

      if (targetProjectId) {
        await performSelectProject(set, get, targetProjectId, { syncWorkspace: false });
        return;
      }

      set({ selectingProjectId: leavingProjectId });

      try {
        await window.nexus.projects.clearActiveProject();

        set({
          activeProjectId: null,
          sidePanel: null,
          selectingProjectId: null,
        });

        if (leavingProjectId) {
          persistLeavingProjectState(prevState.projects, leavingProjectId);
        }
      } catch (error) {
        console.error('[project-switch] selectWorkspace failed', { error });
        set({ selectingProjectId: null });
      }
    } finally {
      await endProjectSwitch();
    }
  },
  removeWorkspace: async (id) => {
    const prevState = get();
    await window.nexus.projects.removeWorkspace(id);
    const appState = migrateAppState(await window.nexus.projects.list());
    applyStatePreservingRuntime(set, get, appState, prevState);
  },
  moveProjectToWorkspace: async (projectId, workspaceId) => {
    await get().updateProject(projectId, { workspaceId });
  },
  toggleSidebar: async () => {
    const activeProject = get().getActiveProject();
    const sidebarCollapsed = !get().sidebarCollapsed;

    set({ sidebarCollapsed });

    if (!activeProject) {
      return;
    }

    await get().updateProject(activeProject.id, {
      sidebarCollapsed,
    });
  },
  toggleExplorer: () => {
    const current = get().sidePanel;

    if (current === 'explorer') {
      set({ sidePanel: null, explorerView: 'tree' });
      return;
    }

    set({ sidePanel: 'explorer', explorerView: 'tree' });
  },
  toggleExplorerEntry: (preferGit) => {
    const { sidePanel, explorerView } = get();

    if (sidePanel === 'explorer') {
      if (preferGit && explorerView === 'tree') {
        set({ explorerView: 'git' });
        return;
      }

      set({ sidePanel: null, explorerView: 'tree' });
      return;
    }

    if (preferGit) {
      set({ sidePanel: 'explorer', explorerView: 'git' });
      return;
    }

    set({ sidePanel: 'explorer', explorerView: 'tree' });
  },
  toggleExplorerGit: () => {
    const { sidePanel, explorerView } = get();

    if (sidePanel === 'explorer' && explorerView === 'git') {
      set({ explorerView: 'tree' });
      return;
    }

    set({ sidePanel: 'explorer', explorerView: 'git' });
  },
  openExplorerGit: () => {
    set({ sidePanel: 'explorer', explorerView: 'git' });
  },
  togglePasswords: () => {
    const current = get().sidePanel;
    set({ sidePanel: current === 'passwords' ? null : 'passwords' });
  },
  toggleAutomations: () => {
    const current = get().sidePanel;
    set({ sidePanel: current === 'automations' ? null : 'automations' });
  },
  toggleTasks: () => {
    const current = get().sidePanel;
    set({ sidePanel: current === 'tasks' ? null : 'tasks' });
  },
  toggleTests: () => {
    const current = get().sidePanel;
    set({ sidePanel: current === 'tests' ? null : 'tests' });
  },
  toggleBrain: () => {
    const current = get().sidePanel;
    set({ sidePanel: current === 'brain' ? null : 'brain' });
  },
  setSidePanel: (panel) => {
    if (panel === 'git') {
      set({ sidePanel: 'explorer', explorerView: 'git' });
      return;
    }

    set({
      sidePanel: panel,
      explorerView: panel === 'explorer' ? get().explorerView : 'tree',
    });
  },
  startSidebarVideoSession: async (session, lastLink) => {
    const rememberedLink = lastLink?.trim() || session.sourceUrl;

    await window.nexus.projects.setSidebarVideoSession(toPersistedSidebarVideoSession(session));
    await window.nexus.projects.setSidebarVideoLastLink(rememberedLink);
    set({ sidebarVideoSession: session, sidebarVideoLastLink: rememberedLink });
  },
  setSidebarVideoLastLink: async (link) => {
    const rememberedLink = link?.trim() || null;

    await window.nexus.projects.setSidebarVideoLastLink(rememberedLink);
    set({ sidebarVideoLastLink: rememberedLink });
  },
  closeSidebarVideoSession: async () => {
    await window.nexus.projects.setSidebarVideoSession(null);
    set({ sidebarVideoSession: null });
  },
  setActiveProjectWhatsAppLink: async (link) => {
    const projectId = get().activeProjectId;

    if (!projectId) {
      return;
    }

    await get().updateProject(projectId, { whatsappLink: link });
  },
  setActiveProjectMailInbox: async (mailbox) => {
    const projectId = get().activeProjectId;

    if (!projectId) {
      return;
    }

    await get().updateProject(projectId, { mailInbox: mailbox });
  },
  getActiveProject: () => {
    const { projects, activeProjectId } = get();
    return projects.find((project) => project.id === activeProjectId) ?? null;
  },
  setTabPtyId: (projectId, tabId, ptyId) => {
    const project = get().projects.find((entry) => entry.id === projectId);
    const existingPane = project ? findPaneTab(project.tabs, tabId) : null;
    const hadExistingPty =
      existingPane &&
      (existingPane.type === 'terminal' || existingPane.type === 'agent') &&
      Boolean(existingPane.ptyId);

    if (ptyId && hadExistingPty) {
      void import('@/stores/useTerminalSessionStore').then(({ useTerminalSessionStore }) => {
        useTerminalSessionStore.getState().takePendingLaunchCommand(tabId);
      });
    }

    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId
          ? {
              ...project,
              tabs: updatePaneInTabs(project.tabs, tabId, (pane) =>
                pane.type === 'terminal' || pane.type === 'agent' ? { ...pane, ptyId } : pane,
              ),
            }
          : project,
      ),
    }));
  },
}));
