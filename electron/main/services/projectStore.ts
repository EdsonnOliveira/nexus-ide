import Store from 'electron-store';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { AppState, Project, ProjectUpdatePayload, Tab, TabBarItem, Workspace, WorkspaceUpdatePayload } from '../../types';
import type { ProjectTask, ProjectTaskLocalMeta } from '../../types/task';
import { agentTurnHistoryChanged, sanitizeAgentTurnHistory } from './trimAgentTurnHistory';
import { ensureNexusGitignore, hasNexusProjectDir } from './nexusProjectGitignore';

import type { ProjectTestEntry } from '../../types/test';

function isTestTargetDirectory(targetPath: string): boolean {
  const last = targetPath.split('/').filter(Boolean).pop() ?? targetPath;
  return !/\.(ya?ml|jsx?|tsx?|mjs)$/i.test(last);
}

function buildTestEntryName(relativePath: string, isDirectory: boolean): string {
  const segments = relativePath.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? relativePath;

  if (isDirectory) {
    return last;
  }

  return last.replace(/\.(ya?ml|jsx?|tsx?|mjs)$/i, '');
}

function migrateTestEntry(entry: ProjectTestEntry): ProjectTestEntry {
  if (entry.sourceName) {
    return entry;
  }

  return {
    ...entry,
    sourceName: buildTestEntryName(entry.targetPath, isTestTargetDirectory(entry.targetPath)),
  };
}

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
  sidebarVideoSession: null,
  sidebarVideoLastLink: null,
};

function resolveAgentPaneRootPath(projectPath: string): string {
  const trimmed = projectPath.trim();

  if (!trimmed) {
    return projectPath;
  }

  return trimmed.replace(/\\/g, '/').replace(/\/+$/, '');
}

function normalizePane(tab: Tab, projectPath?: string): Tab {
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
      ...(tab.diffBefore !== undefined ? { diffBefore: tab.diffBefore } : {}),
      ...(tab.diffAfter !== undefined ? { diffAfter: tab.diffAfter } : {}),
      ...(tab.diffStaged !== undefined ? { diffStaged: tab.diffStaged } : {}),
      ...(tab.diffUntracked !== undefined ? { diffUntracked: tab.diffUntracked } : {}),
      ...(tab.diffRepoPath !== undefined ? { diffRepoPath: tab.diffRepoPath } : {}),
      ...(tab.diffAgentPrompt !== undefined ? { diffAgentPrompt: tab.diffAgentPrompt } : {}),
      ...shared,
    };
  }

  if (tab.type === 'emulator') {
    return {
      id: tab.id,
      title: tab.title,
      type: 'emulator',
      platform: tab.platform ?? 'android',
      deviceId: tab.deviceId ?? null,
      sessionId: null,
      ...shared,
    };
  }

  if (tab.type === 'api') {
    return {
      id: tab.id,
      title: tab.title,
      type: 'api',
      requestId: tab.requestId ?? null,
      collectionId: tab.collectionId ?? null,
      ...shared,
    };
  }

  if (tab.type === 'agent') {
    const turns = sanitizeAgentTurnHistory(Array.isArray(tab.turns) ? tab.turns : []);

    return {
      id: tab.id,
      title: tab.title,
      type: 'agent',
      cliAgent: tab.cliAgent ?? 'cursor-agent',
      ptyId: null,
      turns,
      ...(tab.restoreCommand !== undefined ? { restoreCommand: tab.restoreCommand } : {}),
      workingDirectory: projectPath ? resolveAgentPaneRootPath(projectPath) : tab.workingDirectory,
      ...(Array.isArray(tab.messages) && tab.messages.length > 0 ? { messages: tab.messages } : {}),
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

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length > 0 ? items : undefined;
}

function normalizeLocalTaskMeta(raw: unknown): ProjectTaskLocalMeta | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  const meta: ProjectTaskLocalMeta = {};

  if (typeof record.dueDate === 'string' && record.dueDate.trim()) {
    meta.dueDate = record.dueDate.trim();
  }

  if (typeof record.priority === 'string' && record.priority.trim()) {
    meta.priority = record.priority.trim();
  }

  const labels = normalizeStringArray(record.labels);

  if (labels) {
    meta.labels = labels;
  }

  return Object.keys(meta).length > 0 ? meta : undefined;
}

function normalizeTask(task: ProjectTask): ProjectTask {
  return {
    id: task.id,
    source: task.source ?? 'local',
    ...(task.externalId ? { externalId: task.externalId } : {}),
    title: typeof task.title === 'string' ? task.title : '',
    description: typeof task.description === 'string' ? task.description : '',
    attachments: Array.isArray(task.attachments) ? task.attachments : [],
    ...(task.status ? { status: task.status } : {}),
    ...(task.jira ? { jira: task.jira } : {}),
    ...(task.deepcrm ? { deepcrm: task.deepcrm } : {}),
    local: normalizeLocalTaskMeta(task.local),
    updatedAt: typeof task.updatedAt === 'number' ? task.updatedAt : Date.now(),
  };
}

function normalizeTabBarItem(tab: TabBarItem, projectPath?: string): TabBarItem {
  if (tab.type === 'split') {
    return {
      id: tab.id,
      title: tab.title,
      type: 'split',
      layout: tab.layout,
      activePaneId: tab.activePaneId ?? tab.panes[0]?.id ?? null,
      panes: tab.panes.map((pane) => normalizePane(pane, projectPath)),
      ...(tab.pinned !== undefined ? { pinned: tab.pinned } : {}),
      ...(tab.badgeColorIndex !== undefined ? { badgeColorIndex: tab.badgeColorIndex } : {}),
    };
  }

  return normalizePane(tab, projectPath);
}

function stripRuntimeFieldsFromTabs(tabs: TabBarItem[]): TabBarItem[] {
  return tabs.map((tab) => {
    if (tab.type === 'split') {
      return {
        ...tab,
        panes: tab.panes.map((pane) =>
          pane.type === 'browser' || pane.type === 'emulator' || pane.type === 'api'
            ? pane
            : { ...pane, ptyId: null },
        ),
      };
    }

    if (tab.type === 'browser' || tab.type === 'emulator' || tab.type === 'api') {
      return tab;
    }

    return { ...tab, ptyId: null };
  });
}

function normalizeWorkspace(
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

function normalizeProject(project: Project & { layout?: unknown }, fallbackWorkspaceId: string): Project {
  return {
    ...project,
    workspaceId: project.workspaceId ?? fallbackWorkspaceId,
    iconCustomized: project.iconCustomized ?? project.icon.startsWith('preset:'),
    logo: project.logo ?? null,
    activePaneId: project.activePaneId ?? null,
    automations: project.automations ?? [],
    passwordCollections: project.passwordCollections ?? [],
    whatsappLink: project.whatsappLink ?? null,
    mailInbox: project.mailInbox ?? null,
    tasks: (project.tasks ?? []).map((task) => normalizeTask(task as ProjectTask)),
    taskIntegration: project.taskIntegration ?? null,
    testEntries: (project.testEntries ?? []).map(migrateTestEntry),
    agentGitGroups: project.agentGitGroups ?? [],
    agentResponseSkills: project.agentResponseSkills ?? [],
    flag: project.flag ?? null,
    tabs: (project.tabs ?? []).map((tab) => normalizeTabBarItem(tab as TabBarItem, project.path)),
  };
}

function ensureWorkspaces(state: AppState): AppState {
  const rawWorkspaces =
    state.workspaces.length > 0
      ? state.workspaces
      : [{ id: randomUUID(), name: DEFAULT_WORKSPACE_NAME }];

  const workspaces = rawWorkspaces.map((workspace, index) => normalizeWorkspace(workspace, index));
  const fallbackWorkspaceId = workspaces[0]?.id ?? randomUUID();

  return {
    projects: state.projects.map((project) => normalizeProject(project, fallbackWorkspaceId)),
    workspaces,
    activeProjectId: state.activeProjectId,
    activeWorkspaceId: state.activeWorkspaceId ?? null,
    sidebarVideoSession: state.sidebarVideoSession ?? null,
    sidebarVideoLastLink: state.sidebarVideoLastLink ?? null,
  };
}

function normalizeState(state: AppState): AppState {
  return ensureWorkspaces(state);
}

function migrateLegacyWhatsAppLink(state: AppState, legacyLink: string | null): AppState {
  if (!legacyLink || !state.activeProjectId) {
    return state;
  }

  return {
    ...state,
    projects: state.projects.map((project) =>
      project.id === state.activeProjectId && !project.whatsappLink
        ? { ...project, whatsappLink: legacyLink }
        : project,
    ),
  };
}

class ProjectStoreService {
  private store: Store<AppState> | null = null;
  private nexusGitignoreEnsured = new Set<string>();

  private ensureNexusGitignoreForProject(projectPath: string, force = false): void {
    if (!force && this.nexusGitignoreEnsured.has(projectPath)) {
      return;
    }

    this.nexusGitignoreEnsured.add(projectPath);

    void hasNexusProjectDir(projectPath).then((exists) => {
      if (exists) {
        void ensureNexusGitignore(projectPath);
      }
    });
  }

  private ensureNexusGitignoreForProjects(projects: Project[]): void {
    for (const project of projects) {
      this.ensureNexusGitignoreForProject(project.path);
    }
  }

  private getStore(): Store<AppState> {
    if (!this.store) {
      this.store = new Store<AppState>({
        name: 'projects',
        defaults: defaultState,
      });
    }

    return this.store;
  }

  private readState(): AppState {
    const store = this.getStore();
    const legacyWhatsAppLink =
      (store.get('sidebarWhatsAppLink' as keyof AppState) as string | null | undefined) ?? null;

    const state = migrateLegacyWhatsAppLink(
      normalizeState({
        projects: store.get('projects'),
        workspaces: store.get('workspaces') ?? [],
        activeProjectId: store.get('activeProjectId'),
        activeWorkspaceId: store.get('activeWorkspaceId') ?? null,
        sidebarVideoSession: store.get('sidebarVideoSession') ?? null,
        sidebarVideoLastLink: store.get('sidebarVideoLastLink') ?? null,
      }),
      legacyWhatsAppLink,
    );

    if (legacyWhatsAppLink) {
      store.delete('sidebarWhatsAppLink' as keyof AppState);
    }

    return state;
  }

  private writeState(state: AppState): AppState {
    const store = this.getStore();
    const normalized = normalizeState(state);
    store.set('projects', normalized.projects);
    store.set('workspaces', normalized.workspaces);
    store.set('activeProjectId', normalized.activeProjectId);
    store.set('activeWorkspaceId', normalized.activeWorkspaceId);
    store.set('sidebarVideoSession', normalized.sidebarVideoSession ?? null);
    store.set('sidebarVideoLastLink', normalized.sidebarVideoLastLink ?? null);
    return normalized;
  }

  list(): AppState {
    const store = this.getStore();
    const rawProjects = store.get('projects');
    const state = this.readState();

    if (agentTurnHistoryChanged(rawProjects, state.projects)) {
      this.writeState(state);
    }

    this.ensureNexusGitignoreForProjects(state.projects);

    return state;
  }

  add(projectPath: string, workspaceId?: string | null): Project {
    const state = this.readState();
    const projects = state.projects;
    const existing = projects.find((project) => project.path === projectPath);

    if (existing) {
      this.getStore().set('activeProjectId', existing.id);
      this.ensureNexusGitignoreForProject(projectPath, true);
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
      automations: [],
      passwordCollections: [],
      whatsappLink: null,
      mailInbox: null,
      tasks: [],
      taskIntegration: null,
      testEntries: [],
    };

    this.writeState({
      ...state,
      projects: [...projects, project],
      activeProjectId: project.id,
    });

    void ensureNexusGitignore(projectPath);

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

  clearActiveProject(): void {
    const state = this.readState();

    this.writeState({
      ...state,
      activeProjectId: null,
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
    const workspace = normalizeWorkspace(
      {
        id: randomUUID(),
        name: trimmed,
        color: PROJECT_COLORS[state.workspaces.length % PROJECT_COLORS.length],
        icon: trimmed.charAt(0).toUpperCase(),
        iconCustomized: false,
        logo: null,
        flag: null,
      },
      state.workspaces.length,
    );

    this.writeState({
      ...state,
      workspaces: [...state.workspaces, workspace],
      activeWorkspaceId: workspace.id,
    });

    return workspace;
  }

  updateWorkspace(id: string, data: WorkspaceUpdatePayload): Workspace | null {
    const state = this.readState();
    const index = state.workspaces.findIndex((workspace) => workspace.id === id);

    if (index === -1) {
      return null;
    }

    const updatedWorkspace = normalizeWorkspace(
      {
        ...state.workspaces[index],
        ...data,
      },
      index,
    );

    const nextWorkspaces = [...state.workspaces];
    nextWorkspaces[index] = updatedWorkspace;

    this.writeState({
      ...state,
      workspaces: nextWorkspaces,
    });

    return updatedWorkspace;
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

  setSidebarVideoSession(session: AppState['sidebarVideoSession']): void {
    const state = this.readState();

    this.writeState({
      ...state,
      sidebarVideoSession: session ?? null,
      ...(session ? { sidebarVideoLastLink: session.sourceUrl } : {}),
    });
  }

  setSidebarVideoLastLink(link: string | null): void {
    const state = this.readState();
    const normalizedLink = link?.trim() || null;

    this.writeState({
      ...state,
      sidebarVideoLastLink: normalizedLink,
    });
  }
}

export const projectStore = new ProjectStoreService();
