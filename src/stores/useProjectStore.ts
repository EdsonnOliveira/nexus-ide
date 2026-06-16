import { create } from 'zustand';
import type { AppState, Project, ProjectUpdatePayload, Tab, TabBarItem, Workspace } from '@/types';
import { useProjectNotificationStore } from '@/stores/useProjectNotificationStore';
import { migrateLegacyProjectTabs } from '@/utils/migrateTabs';
import { hydrateTerminalSessionFromProjects, restoreActiveAgentsFromProjects } from '@/utils/hydrateTerminalSession';
import { updatePaneInTabs } from '@/utils/tabGroups';

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

export type SidePanel = 'explorer' | 'git' | null;

interface ProjectStoreState {
  projects: Project[];
  workspaces: Workspace[];
  activeProjectId: string | null;
  activeWorkspaceId: string | null;
  sidebarCollapsed: boolean;
  sidePanel: SidePanel;
  initialized: boolean;
  initialize: () => Promise<void>;
  addProject: () => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  selectProject: (id: string) => Promise<void>;
  updateProject: (id: string, data: ProjectUpdatePayload) => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  selectWorkspace: (id: string | null) => Promise<void>;
  removeWorkspace: (id: string) => Promise<void>;
  moveProjectToWorkspace: (projectId: string, workspaceId: string) => Promise<void>;
  toggleSidebar: () => Promise<void>;
  toggleExplorer: () => void;
  toggleGitPanel: () => void;
  setSidePanel: (panel: SidePanel) => void;
  getActiveProject: () => Project | null;
  setTabPtyId: (projectId: string, tabId: string, ptyId: string | null) => void;
}

function migrateAppState(appState: AppState): AppState {
  const workspaces =
    appState.workspaces.length > 0
      ? appState.workspaces
      : [{ id: crypto.randomUUID(), name: 'Padrão' }];

  const fallbackWorkspaceId = workspaces[0]?.id ?? crypto.randomUUID();

  return {
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
      };
    }),
  };
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
        if (pane.type === 'terminal' && pane.ptyId) {
          paneMap.set(pane.id, pane.ptyId);
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

          if (pane.type === 'terminal' && ptyId) {
            return { ...pane, ptyId };
          }

          return pane;
        }),
      };
    }

    const ptyId = paneMap.get(item.id);

    if (item.type === 'terminal' && ptyId) {
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

export const useProjectStore = create<ProjectStoreState>((set, get) => ({
  projects: [],
  workspaces: [],
  activeProjectId: null,
  activeWorkspaceId: null,
  sidebarCollapsed: false,
  sidePanel: null,
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
    set({
      initialized: true,
      sidebarCollapsed: activeProject?.sidebarCollapsed ?? false,
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
      for (const item of project.tabs) {
        const panes: Tab[] = item.type === 'split' ? item.panes : [item];

        for (const pane of panes) {
          if (pane.type === 'terminal' && pane.ptyId) {
            window.nexus.terminal.kill(pane.ptyId);
          }

          if (pane.type === 'terminal') {
            void window.nexus.session.removePane(pane.id);
          }
        }
      }
    }

    const prevState = get();
    await window.nexus.projects.remove(id);
    const appState = migrateAppState(await window.nexus.projects.list());
    applyStatePreservingRuntime(set, appState, prevState);
  },
  selectProject: async (id) => {
    useProjectNotificationStore.getState().clearProjectNotification(id);
    const prevState = get();
    await window.nexus.projects.select(id);
    const appState = migrateAppState(await window.nexus.projects.list());
    applyStatePreservingRuntime(set, appState, prevState);
    restoreActiveAgentsFromProjects(appState.projects);
    set({ sidePanel: null });
  },
  updateProject: async (id, data) => {
    const prevState = get();
    await window.nexus.projects.update(id, data);
    const appState = migrateAppState(await window.nexus.projects.list());
    applyStatePreservingRuntime(set, appState, prevState);
  },
  createWorkspace: async (name) => {
    const prevState = get();
    await window.nexus.projects.createWorkspace(name);
    const appState = migrateAppState(await window.nexus.projects.list());
    applyStatePreservingRuntime(set, appState, prevState);
  },
  selectWorkspace: async (id) => {
    const prevState = get();
    await window.nexus.projects.selectWorkspace(id);
    const appState = migrateAppState(await window.nexus.projects.list());
    applyStatePreservingRuntime(set, appState, prevState);
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
    set({ sidePanel: current === 'explorer' ? null : 'explorer' });
  },
  toggleGitPanel: () => {
    const current = get().sidePanel;
    set({ sidePanel: current === 'git' ? null : 'git' });
  },
  setSidePanel: (panel) => {
    set({ sidePanel: panel });
  },
  getActiveProject: () => {
    const { projects, activeProjectId } = get();
    return projects.find((project) => project.id === activeProjectId) ?? null;
  },
  setTabPtyId: (projectId, tabId, ptyId) => {
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId
          ? {
              ...project,
              tabs: updatePaneInTabs(project.tabs, tabId, (pane) =>
                pane.type === 'terminal' ? { ...pane, ptyId } : pane,
              ),
            }
          : project,
      ),
    }));
  },
}));
