import Store from 'electron-store';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { AppState, Project, ProjectUpdatePayload, Tab, TabBarItem, Workspace } from '../../types';

const PROJECT_COLORS = [
  '#7c3aed',
  '#2563eb',
  '#059669',
  '#d97706',
  '#dc2626',
  '#db2777',
  '#0891b2',
  '#4f46e5',
];

const DEFAULT_WORKSPACE_NAME = 'Padrão';

const defaultState: AppState = {
  projects: [],
  workspaces: [],
  activeProjectId: null,
  activeWorkspaceId: null,
};

function normalizePane(tab: Tab): Tab {
  const shared = {
    ...(tab.pinned !== undefined ? { pinned: tab.pinned } : {}),
    ...(tab.badgeColorIndex !== undefined ? { badgeColorIndex: tab.badgeColorIndex } : {}),
  };

  if (tab.type === 'browser') {
    return {
      id: tab.id,
      title: tab.title,
      type: 'browser',
      url: tab.url ?? 'https://www.google.com',
      ...shared,
    };
  }

  if (tab.type === 'file') {
    return {
      id: tab.id,
      title: tab.title,
      type: 'file',
      filePath: tab.filePath,
      viewMode: tab.viewMode ?? 'code',
      ...shared,
    };
  }

  return {
    id: tab.id,
    title: tab.title,
    type: 'terminal',
    ptyId: null,
    agent: tab.agent ?? 'cursor',
    ...(tab.lastCommand !== undefined ? { lastCommand: tab.lastCommand } : {}),
    ...(tab.restoreCommand !== undefined ? { restoreCommand: tab.restoreCommand } : {}),
    ...(tab.terminalCwd !== undefined ? { terminalCwd: tab.terminalCwd } : {}),
    ...shared,
  };
}

function normalizeTabBarItem(tab: TabBarItem): TabBarItem {
  if (tab.type === 'split') {
    return {
      id: tab.id,
      title: tab.title,
      type: 'split',
      layout: tab.layout,
      activePaneId: tab.activePaneId ?? tab.panes[0]?.id ?? null,
      panes: tab.panes.map((pane) => normalizePane(pane)),
      ...(tab.pinned !== undefined ? { pinned: tab.pinned } : {}),
      ...(tab.badgeColorIndex !== undefined ? { badgeColorIndex: tab.badgeColorIndex } : {}),
    };
  }

  return normalizePane(tab);
}

function stripRuntimeFieldsFromTabs(tabs: TabBarItem[]): TabBarItem[] {
  return tabs.map((tab) => {
    if (tab.type === 'split') {
      return {
        ...tab,
        panes: tab.panes.map((pane) =>
          pane.type === 'browser' ? pane : { ...pane, ptyId: null },
        ),
      };
    }

    return tab.type === 'browser' ? tab : { ...tab, ptyId: null };
  });
}

function normalizeProject(project: Project & { layout?: unknown }, fallbackWorkspaceId: string): Project {
  return {
    ...project,
    workspaceId: project.workspaceId ?? fallbackWorkspaceId,
    iconCustomized: project.iconCustomized ?? project.icon.startsWith('preset:'),
    logo: project.logo ?? null,
    activePaneId: project.activePaneId ?? null,
    tabs: (project.tabs ?? []).map((tab) => normalizeTabBarItem(tab as TabBarItem)),
  };
}

function ensureWorkspaces(state: AppState): AppState {
  const workspaces =
    state.workspaces.length > 0
      ? state.workspaces
      : [{ id: randomUUID(), name: DEFAULT_WORKSPACE_NAME }];

  const fallbackWorkspaceId = workspaces[0]?.id ?? randomUUID();

  return {
    projects: state.projects.map((project) => normalizeProject(project, fallbackWorkspaceId)),
    workspaces,
    activeProjectId: state.activeProjectId,
    activeWorkspaceId: state.activeWorkspaceId ?? null,
  };
}

function normalizeState(state: AppState): AppState {
  return ensureWorkspaces(state);
}

class ProjectStoreService {
  private store = new Store<AppState>({
    name: 'projects',
    defaults: defaultState,
  });

  private readState(): AppState {
    return normalizeState({
      projects: this.store.get('projects'),
      workspaces: this.store.get('workspaces') ?? [],
      activeProjectId: this.store.get('activeProjectId'),
      activeWorkspaceId: this.store.get('activeWorkspaceId') ?? null,
    });
  }

  private writeState(state: AppState): AppState {
    const normalized = normalizeState(state);
    this.store.set('projects', normalized.projects);
    this.store.set('workspaces', normalized.workspaces);
    this.store.set('activeProjectId', normalized.activeProjectId);
    this.store.set('activeWorkspaceId', normalized.activeWorkspaceId);
    return normalized;
  }

  list(): AppState {
    const state = this.readState();
    this.writeState(state);
    return state;
  }

  add(projectPath: string, workspaceId?: string | null): Project {
    const state = this.readState();
    const projects = state.projects;
    const existing = projects.find((project) => project.path === projectPath);

    if (existing) {
      this.store.set('activeProjectId', existing.id);
      return existing;
    }

    const targetWorkspaceId =
      workspaceId && state.workspaces.some((workspace) => workspace.id === workspaceId)
        ? workspaceId
        : state.workspaces[0]?.id;

    if (!targetWorkspaceId) {
      throw new Error('Workspace not found');
    }

    const color = PROJECT_COLORS[projects.length % PROJECT_COLORS.length];
    const project: Project = {
      id: randomUUID(),
      name: basename(projectPath),
      path: projectPath,
      workspaceId: targetWorkspaceId,
      color,
      icon: basename(projectPath).charAt(0).toUpperCase(),
      iconCustomized: false,
      logo: null,
      tabs: [],
      activeTabId: null,
      activePaneId: null,
      sidebarCollapsed: false,
    };

    this.writeState({
      ...state,
      projects: [...projects, project],
      activeProjectId: project.id,
    });

    return project;
  }

  remove(id: string): void {
    const state = this.readState();
    const projects = state.projects.filter((project) => project.id !== id);
    const activeProjectId = state.activeProjectId;

    this.writeState({
      ...state,
      projects,
      activeProjectId: activeProjectId === id ? (projects[0]?.id ?? null) : activeProjectId,
    });
  }

  select(id: string): void {
    const state = this.readState();
    const project = state.projects.find((item) => item.id === id);

    if (!project) {
      return;
    }

    this.writeState({
      ...state,
      activeProjectId: id,
    });
  }

  selectWorkspace(id: string | null): void {
    const state = this.readState();

    if (id !== null && !state.workspaces.some((workspace) => workspace.id === id)) {
      return;
    }

    this.writeState({
      ...state,
      activeWorkspaceId: id,
    });
  }

  createWorkspace(name: string): Workspace {
    const trimmed = name.trim();

    if (!trimmed) {
      throw new Error('Workspace name is required');
    }

    const state = this.readState();
    const workspace: Workspace = {
      id: randomUUID(),
      name: trimmed,
    };

    this.writeState({
      ...state,
      workspaces: [...state.workspaces, workspace],
      activeWorkspaceId: workspace.id,
    });

    return workspace;
  }

  removeWorkspace(id: string): void {
    const state = this.readState();

    if (state.workspaces.length <= 1) {
      return;
    }

    const workspaceIndex = state.workspaces.findIndex((workspace) => workspace.id === id);

    if (workspaceIndex === -1) {
      return;
    }

    const fallbackWorkspace =
      state.workspaces.find((workspace) => workspace.id !== id) ?? state.workspaces[0];

    if (!fallbackWorkspace) {
      return;
    }

    const projects = state.projects.map((project) =>
      project.workspaceId === id ? { ...project, workspaceId: fallbackWorkspace.id } : project,
    );

    const workspaces = state.workspaces.filter((workspace) => workspace.id !== id);
    const activeWorkspaceId =
      state.activeWorkspaceId === id ? null : state.activeWorkspaceId;

    this.writeState({
      ...state,
      projects,
      workspaces,
      activeWorkspaceId,
    });
  }

  update(id: string, data: ProjectUpdatePayload): Project | null {
    const state = this.readState();
    const index = state.projects.findIndex((project) => project.id === id);

    if (index === -1) {
      return null;
    }

    const sanitizedData: ProjectUpdatePayload = { ...data };

    if (sanitizedData.workspaceId) {
      const workspaceExists = state.workspaces.some(
        (workspace) => workspace.id === sanitizedData.workspaceId,
      );

      if (!workspaceExists) {
        delete sanitizedData.workspaceId;
      }
    }

    if (sanitizedData.tabs) {
      sanitizedData.tabs = stripRuntimeFieldsFromTabs(sanitizedData.tabs);
    }

    const fallbackWorkspaceId = state.workspaces[0]?.id ?? randomUUID();
    const updatedProject: Project = normalizeProject(
      {
        ...state.projects[index],
        ...sanitizedData,
      },
      fallbackWorkspaceId,
    );

    const nextProjects = [...state.projects];
    nextProjects[index] = updatedProject;

    this.writeState({
      ...state,
      projects: nextProjects,
    });

    return updatedProject;
  }
}

export const projectStore = new ProjectStoreService();
