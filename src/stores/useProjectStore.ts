import { create } from 'zustand';
import type { AppState, MailMailboxRef, Project, ProjectUpdatePayload, Tab, TabBarItem, Workspace } from '@/types';
import { migrateLegacyProjectTabs } from '@/utils/migrateTabs';
import { hydrateTerminalSessionFromProjects, restoreActiveAgentsFromProjects } from '@/utils/hydrateTerminalSession';
import { useAgentGitChangeStore } from '@/stores/useAgentGitChangeStore';
import { useAutomationExecutionStore } from '@/stores/useAutomationExecutionStore';
import { useProjectNotificationStore } from '@/stores/useProjectNotificationStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { flushTerminalSessionsNow } from '@/utils/persistTerminalSession';
import {
  flushAgentGitGroupsNow,
  hydrateAgentGitGroupsFromProjects,
} from '@/utils/persistAgentGitGroups';
import {
  countBusyAgentPanes,
  beginProjectSwitch,
  endProjectSwitch,
  persistLeavingProjectState,
} from '@/utils/projectSwitch';
import { updatePaneInTabs } from '@/utils/tabGroups';
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

export type SidePanel = 'explorer' | 'passwords' | 'automations' | 'tasks' | null;

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
  initialize: () => Promise<void>;
  addProject: () => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  stopProject: (id: string) => Promise<void>;
  selectProject: (id: string, options?: { syncWorkspace?: boolean }) => Promise<void>;
  leaveActiveProject: () => Promise<void>;
  updateProject: (id: string, data: ProjectUpdatePayload) => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  selectWorkspace: (id: string | null) => Promise<void>;
  removeWorkspace: (id: string) => Promise<void>;
  moveProjectToWorkspace: (projectId: string, workspaceId: string) => Promise<void>;
  toggleSidebar: () => Promise<void>;
  toggleExplorer: () => void;
  toggleExplorerGit: () => void;
  openExplorerGit: () => void;
  togglePasswords: () => void;
  toggleAutomations: () => void;
  toggleTasks: () => void;
  setSidePanel: (panel: SidePanel | 'git') => void;
  startSidebarVideoSession: (session: SidebarVideoSession) => Promise<void>;
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

function migrateAppState(appState: AppState): AppState {
  const workspaces =
    appState.workspaces.length > 0
      ? appState.workspaces
      : [{ id: crypto.randomUUID(), name: 'Padrão' }];

  const fallbackWorkspaceId = workspaces[0]?.id ?? crypto.randomUUID();

  return migrateLegacyGlobalWhatsAppLink({
    ...appState,
    workspaces,
    activeWorkspaceId: appState.activeWorkspaceId ?? null,
    projects: appState.projects.map((project) => {
      const legacyProject = project as Project & { layout?: unknown };
      const migrated = migrateLegacyProjectTabs(
        legacyProject.tabs,
        legacyProject.layout as never,
        legacyProject.activeTabId,
      );

      return {
        ...legacyProject,
        workspaceId: legacyProject.workspaceId ?? fallbackWorkspaceId,
        iconCustomized: legacyProject.iconCustomized ?? legacyProject.icon.startsWith('preset:'),
        tabs: migrated.tabs,
        activeTabId: migrated.activeTabId,
        activePaneId: migrated.activePaneId,
        automations: legacyProject.automations ?? [],
        whatsappLink: legacyProject.whatsappLink ?? null,
        mailInbox: legacyProject.mailInbox ?? null,
        agentGitGroups: legacyProject.agentGitGroups ?? [],
        agentResponseSkills: legacyProject.agentResponseSkills ?? [],
        flag: legacyProject.flag ?? null,
      };
    }),
  });
}

function applyState(set: (state: Partial<ProjectStoreState>) => void, appState: AppState) {
  set({
    projects: appState.projects,
    workspaces: appState.workspaces,
    activeProjectId: appState.activeProjectId,
    activeWorkspaceId: appState.activeWorkspaceId,
  });
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

function preserveRuntimePtyIds(next: AppState, prev: AppState): AppState {
  const prevMap = buildTerminalPtyIdMap(prev.projects);

  if (prevMap.size === 0) {
    return next;
  }

  return {
    ...next,
    projects: next.projects.map((project) => {
      const paneMap = prevMap.get(project.id);

      if (!paneMap) {
        return project;
      }

      return {
        ...project,
        tabs: mergePtyIdsIntoTabs(project.tabs, paneMap),
      };
    }),
  };
}

function applyStatePreservingRuntime(
  set: (state: Partial<ProjectStoreState>) => void,
  appState: AppState,
  prev: AppState,
) {
  applyState(set, preserveRuntimePtyIds(appState, prev));
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

    console.info('[project-switch] start', {
      leavingProjectId,
      newProjectId: id,
      agentPanesBusy: countBusyAgentPanes(),
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
  initialize: async () => {
    if (get().initialized) {
      return;
    }

    const rawState = await window.nexus.projects.list();
    const shouldPersistBadgeColors = rawState.projects.some((project) =>
      hasMissingBadgeColorIndex(project.tabs),
    );
    const appState = migrateAppState(rawState);
    const activeProject = appState.projects.find(
      (project) => project.id === appState.activeProjectId,
    );

    applyState(set, appState);
    hydrateTerminalSessionFromProjects(appState.projects);
    hydrateAgentGitGroupsFromProjects(appState.projects);
    const restoredVideoSession = appState.sidebarVideoSession
      ? restoreSidebarVideoSession(appState.sidebarVideoSession)
      : null;
    set({
      initialized: true,
      sidebarCollapsed: activeProject?.sidebarCollapsed ?? false,
      sidebarVideoSession: restoredVideoSession,
      sidebarVideoLastLink:
        appState.sidebarVideoLastLink ?? appState.sidebarVideoSession?.sourceUrl ?? null,
    });

    if (shouldPersistBadgeColors) {
      await Promise.all(
        appState.projects.map((project) =>
          window.nexus.projects.update(project.id, { tabs: project.tabs }),
        ),
      );
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
    applyStatePreservingRuntime(set, appState, prevState);
  },
  removeProject: async (id) => {
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
    useAgentGitChangeStore.getState().clearProject(id);
    await flushAgentGitGroupsNow();
    await window.nexus.projects.remove(id);
    const appState = migrateAppState(await window.nexus.projects.list());
    applyStatePreservingRuntime(set, appState, prevState);
  },
  stopProject: async (id) => {
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
    await window.nexus.projects.update(id, data);
    const appState = migrateAppState(await window.nexus.projects.list());
    applyStatePreservingRuntime(set, appState, prevState);

    if (data.agentGitGroups !== undefined) {
      hydrateAgentGitGroupsFromProjects(appState.projects);
    }
  },
  createWorkspace: async (name) => {
    const prevState = get();
    await window.nexus.projects.createWorkspace(name);
    const appState = migrateAppState(await window.nexus.projects.list());
    applyStatePreservingRuntime(set, appState, prevState);
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
    applyStatePreservingRuntime(set, appState, prevState);
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
  startSidebarVideoSession: async (session) => {
    await window.nexus.projects.setSidebarVideoSession(toPersistedSidebarVideoSession(session));
    set({ sidebarVideoSession: session, sidebarVideoLastLink: session.sourceUrl });
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
    if (ptyId) {
      useTerminalSessionStore.getState().takePendingLaunchCommand(tabId);
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
