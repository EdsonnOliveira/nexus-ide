import type {
  GitBranchInfo,
  GitCommandResult,
  GitDiffResult,
  GitRepoDiscovery,
  GitStatusResult,
  GitStashEntry,
} from '@/types/git';

export type {
  GitBranchInfo,
  GitChangeEntry,
  GitChangeStatus,
  GitCommandResult,
  GitDiffResult,
  GitRepoDiscovery,
  GitRepoInfo,
  GitStatusResult,
  GitStashEntry,
} from '@/types/git';

export type TerminalAgent = 'cursor' | 'claude' | 'composer' | 'shell';

export type TabType = 'terminal' | 'browser';

export interface TerminalAgentConfig {
  label: string;
  cursorColor: string;
  selectionBackground: string;
  promptPrefix: string;
  promptColor: string;
  inputPlaceholder: string;
  launchCommand: string | null;
}

export interface TerminalTab {
  id: string;
  title: string;
  type: 'terminal';
  ptyId: string | null;
  agent: TerminalAgent;
  lastCommand?: string | null;
  restoreCommand?: string | null;
  terminalCwd?: string | null;
  pinned?: boolean;
  badgeColorIndex?: number;
}

export interface BrowserTab {
  id: string;
  title: string;
  type: 'browser';
  url: string;
  pinned?: boolean;
  badgeColorIndex?: number;
}

export type FileViewMode = 'code' | 'image' | 'pdf' | 'diff';

export interface FileTab {
  id: string;
  title: string;
  type: 'file';
  filePath: string;
  viewMode: FileViewMode;
  diffPatch?: string;
  diffStaged?: boolean;
  pinned?: boolean;
  badgeColorIndex?: number;
}

export type Tab = TerminalTab | BrowserTab | FileTab;

export interface SplitTab {
  id: string;
  title: string;
  type: 'split';
  layout: SplitLayoutNode;
  activePaneId: string | null;
  panes: Tab[];
  pinned?: boolean;
  badgeColorIndex?: number;
}

export type TabBarItem = Tab | SplitTab;

export type SplitLayoutNode =
  | { type: 'tab'; tabId: string }
  | {
      type: 'split';
      orientation: 'horizontal';
      left: SplitLayoutNode;
      right: SplitLayoutNode;
      ratio: number;
    };

export interface Workspace {
  id: string;
  name: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  workspaceId: string;
  color: string;
  icon: string;
  iconCustomized: boolean;
  logo: string | null;
  tabs: TabBarItem[];
  activeTabId: string | null;
  activePaneId: string | null;
  sidebarCollapsed: boolean;
}

export interface AppState {
  projects: Project[];
  workspaces: Workspace[];
  activeProjectId: string | null;
  activeWorkspaceId: string | null;
}

export interface ProjectUpdatePayload {
  tabs?: TabBarItem[];
  activeTabId?: string | null;
  activePaneId?: string | null;
  sidebarCollapsed?: boolean;
  name?: string;
  color?: string;
  icon?: string;
  iconCustomized?: boolean;
  logo?: string | null;
  workspaceId?: string;
}

export type ProjectKind = 'web' | 'mobile' | 'api';

export interface ProjectDirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

export interface TerminalCommandHint {
  id: string;
  badge: string;
  badgeIcon?:
    | 'expo'
    | 'apple'
    | 'android'
    | 'cursor'
    | 'claude'
    | 'codex'
    | 'gemini'
    | 'mode-agent'
    | 'mode-plan'
    | 'mode-ask'
    | 'mode-debug'
    | 'mode-multitask';
  badgeColor?: string;
  label: string;
  command: string;
  hintKind?: 'skill' | 'mode' | 'model';
}

export interface AppleMusicNowPlaying {
  platformSupported: boolean;
  available: boolean;
  title: string;
  artist: string;
  state: 'playing' | 'paused' | 'stopped';
  artworkUrl: string | null;
}

export interface NexusAPI {
  projects: {
    list: () => Promise<AppState>;
    createWorkspace: (name: string) => Promise<Workspace>;
    removeWorkspace: (id: string) => Promise<void>;
    selectWorkspace: (id: string | null) => Promise<void>;
    add: (projectPath: string, workspaceId?: string | null) => Promise<Project>;
    remove: (id: string) => Promise<void>;
    select: (id: string) => Promise<void>;
    update: (id: string, data: ProjectUpdatePayload) => Promise<Project | null>;
    saveLogo: (projectId: string, sourcePath: string) => Promise<string>;
    saveLogoFromDataUrl: (projectId: string, dataUrl: string) => Promise<string>;
    removeLogo: (logoPath: string | null) => Promise<void>;
  };
  terminal: {
    create: (cwd: string, agent: TerminalAgent) => Promise<string>;
    has: (ptyId: string) => Promise<boolean>;
    getScrollback: (ptyId: string) => Promise<string>;
    write: (ptyId: string, data: string) => void;
    resize: (ptyId: string, cols: number, rows: number) => void;
    kill: (ptyId: string) => void;
    onData: (callback: (ptyId: string, data: string) => void) => () => void;
    onExit: (callback: (ptyId: string, code: number) => void) => () => void;
  };
  dialog: {
    openDirectory: () => Promise<string | null>;
    openImage: () => Promise<string | null>;
  };
  files: {
    toLocalUrl: (filePath: string) => string;
    readImageAsDataUrl: (filePath: string) => Promise<string | null>;
    listChildDirectories: (dirPath: string) => Promise<string[]>;
    listDirectoryEntries: (dirPath: string) => Promise<ProjectDirectoryEntry[]>;
    resolveCdPath: (cwd: string, target: string) => Promise<string>;
    getTerminalHints: (cwd: string) => Promise<TerminalCommandHint[]>;
    getAgentSkillHints: (cwd: string) => Promise<TerminalCommandHint[]>;
    getGitBranch: (dirPath: string) => Promise<string | null>;
    detectProjectKinds: (dirPaths: string[]) => Promise<Record<string, ProjectKind | null>>;
    readTextFile: (
      filePath: string,
    ) => Promise<{ ok: true; content: string } | { ok: false; error: string }>;
    writeTextFile: (
      filePath: string,
      content: string,
    ) => Promise<{ ok: true } | { ok: false; error: string }>;
    searchProjectTree: (
      dirPath: string,
      query: string,
      options: {
        matchCase: boolean;
        matchWholeWord: boolean;
        useRegex: boolean;
      },
    ) => Promise<
      {
        name: string;
        path: string;
        type: 'file' | 'directory';
        children?: {
          name: string;
          path: string;
          type: 'file' | 'directory';
          children?: unknown[];
        }[];
      }[]
    >;
  };
  browser: {
    probeUrl: (url: string) => Promise<boolean>;
    openDevTools: (guestWebContentsId: number, devtoolsWebContentsId: number) => Promise<void>;
    closeDevTools: (guestWebContentsId: number) => Promise<void>;
  };
  session: {
    getScrollback: (paneId: string) => Promise<string>;
    saveScrollbacks: (entries: Record<string, string>) => Promise<void>;
    removePane: (paneId: string) => Promise<void>;
    flushComplete: () => Promise<void>;
  };
  git: {
    getStatus: (dirPath: string) => Promise<GitStatusResult>;
    discoverRepos: (dirPath: string) => Promise<GitRepoDiscovery[]>;
    stage: (dirPath: string, paths: string[]) => Promise<GitCommandResult>;
    unstage: (dirPath: string, paths: string[]) => Promise<GitCommandResult>;
    discard: (dirPath: string, paths: string[]) => Promise<GitCommandResult>;
    commit: (dirPath: string, message: string) => Promise<GitCommandResult>;
    diff: (dirPath: string, filePath: string, staged: boolean) => Promise<GitDiffResult>;
    pull: (dirPath: string) => Promise<GitCommandResult>;
    push: (dirPath: string) => Promise<GitCommandResult>;
    listBranches: (dirPath: string) => Promise<GitBranchInfo[]>;
    checkout: (dirPath: string, branch: string) => Promise<GitCommandResult>;
    createBranch: (dirPath: string, branch: string) => Promise<GitCommandResult>;
    stash: (dirPath: string, message?: string) => Promise<GitCommandResult>;
    stashPop: (dirPath: string) => Promise<GitCommandResult>;
    stashList: (dirPath: string) => Promise<GitStashEntry[]>;
    watch: (dirPath: string) => Promise<void>;
    unwatch: (dirPath: string) => Promise<void>;
    onRepoChange: (callback: (repoPath: string) => void) => () => void;
  };
  onToggleSidebar: (callback: () => void) => () => void;
  onOpenTabAddMenu: (callback: () => void) => () => void;
  onFlushSession: (callback: () => void) => () => void;
  music: {
    getNowPlaying: () => Promise<AppleMusicNowPlaying>;
    togglePlayback: () => Promise<void>;
    next: () => Promise<void>;
    previous: () => Promise<void>;
  };
}

declare global {
  interface Window {
    nexus: NexusAPI;
  }
}

export const EXPLORER_ROOT_COLORS = [
  '#c4b5fd',
  '#93c5fd',
  '#6ee7b7',
  '#fcd34d',
  '#fca5a5',
  '#f9a8d4',
  '#67e8f9',
  '#a5b4fc',
  '#fdba74',
  '#bef264',
  '#5eead4',
  '#d8b4fe',
];

export const PROJECT_COLORS = [
  '#7c3aed',
  '#2563eb',
  '#059669',
  '#d97706',
  '#dc2626',
  '#db2777',
  '#0891b2',
  '#4f46e5',
  '#ea580c',
  '#65a30d',
  '#0d9488',
  '#9333ea',
];

export interface ContextMenuState {
  projectId: string;
  x: number;
  y: number;
}

export type ProjectPromptMode = 'rename' | 'icon' | 'workspace';

export {};
