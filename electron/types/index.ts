export type TerminalAgent = 'cursor' | 'claude' | 'composer' | 'shell';

export type TabType = 'terminal' | 'browser';

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

export type FileViewMode = 'code' | 'image' | 'pdf';

export interface FileTab {
  id: string;
  title: string;
  type: 'file';
  filePath: string;
  viewMode: FileViewMode;
  pinned?: boolean;
  badgeColorIndex?: number;
}

export type Tab = TerminalTab | BrowserTab | FileTab;

export type SplitLayoutNode =
  | { type: 'tab'; tabId: string }
  | {
      type: 'split';
      orientation: 'horizontal';
      left: SplitLayoutNode;
      right: SplitLayoutNode;
      ratio: number;
    };

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
