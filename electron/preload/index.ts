import { contextBridge, ipcRenderer } from 'electron';
import type { AppState, Project, ProjectUpdatePayload, TerminalAgent, Workspace } from '../types';

function toLocalFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean).map(encodeURIComponent);

  return `nexus-file:///${segments.join('/')}`;
}

const nexusApi = {
  projects: {
    list: (): Promise<AppState> => ipcRenderer.invoke('projects:list'),
    createWorkspace: (name: string): Promise<Workspace> =>
      ipcRenderer.invoke('projects:createWorkspace', name),
    removeWorkspace: (id: string): Promise<void> => ipcRenderer.invoke('projects:removeWorkspace', id),
    selectWorkspace: (id: string | null): Promise<void> =>
      ipcRenderer.invoke('projects:selectWorkspace', id),
    add: (projectPath: string, workspaceId?: string | null): Promise<Project> =>
      ipcRenderer.invoke('projects:add', projectPath, workspaceId),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('projects:remove', id),
    select: (id: string): Promise<void> => ipcRenderer.invoke('projects:select', id),
    update: (id: string, data: ProjectUpdatePayload): Promise<Project | null> =>
      ipcRenderer.invoke('projects:update', id, data),
    saveLogo: (projectId: string, sourcePath: string): Promise<string> =>
      ipcRenderer.invoke('projects:saveLogo', projectId, sourcePath),
    saveLogoFromDataUrl: (projectId: string, dataUrl: string): Promise<string> =>
      ipcRenderer.invoke('projects:saveLogoFromDataUrl', projectId, dataUrl),
    removeLogo: (logoPath: string | null): Promise<void> =>
      ipcRenderer.invoke('projects:removeLogo', logoPath),
  },
  terminal: {
    create: (cwd: string, agent: TerminalAgent): Promise<string> =>
      ipcRenderer.invoke('terminal:create', cwd, agent),
    has: (ptyId: string): Promise<boolean> => ipcRenderer.invoke('terminal:has', ptyId),
    getScrollback: (ptyId: string): Promise<string> =>
      ipcRenderer.invoke('terminal:getScrollback', ptyId),
    write: (ptyId: string, data: string): void => {
      ipcRenderer.send('terminal:write', ptyId, data);
    },
    resize: (ptyId: string, cols: number, rows: number): void => {
      ipcRenderer.send('terminal:resize', ptyId, cols, rows);
    },
    kill: (ptyId: string): void => {
      ipcRenderer.send('terminal:kill', ptyId);
    },
    onData: (callback: (ptyId: string, data: string) => void): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, payload: { ptyId: string; data: string }) => {
        callback(payload.ptyId, payload.data);
      };

      ipcRenderer.on('terminal:data', listener);
      return () => ipcRenderer.off('terminal:data', listener);
    },
    onExit: (callback: (ptyId: string, code: number) => void): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, payload: { ptyId: string; code: number }) => {
        callback(payload.ptyId, payload.code);
      };

      ipcRenderer.on('terminal:exit', listener);
      return () => ipcRenderer.off('terminal:exit', listener);
    },
  },
  dialog: {
    openDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDirectory'),
    openImage: (): Promise<string | null> => ipcRenderer.invoke('dialog:openImage'),
  },
  files: {
    toLocalUrl: (filePath: string): string => toLocalFileUrl(filePath),
    readImageAsDataUrl: (filePath: string): Promise<string | null> =>
      ipcRenderer.invoke('files:readImageAsDataUrl', filePath),
    listChildDirectories: (dirPath: string): Promise<string[]> =>
      ipcRenderer.invoke('files:listChildDirectories', dirPath),
    listDirectoryEntries: (dirPath: string) =>
      ipcRenderer.invoke('files:listDirectoryEntries', dirPath),
    resolveCdPath: (cwd: string, target: string): Promise<string> =>
      ipcRenderer.invoke('files:resolveCdPath', cwd, target),
    getTerminalHints: (cwd: string) => ipcRenderer.invoke('files:getTerminalHints', cwd),
    getAgentSkillHints: (cwd: string) => ipcRenderer.invoke('files:getAgentSkillHints', cwd),
    getGitBranch: (dirPath: string): Promise<string | null> =>
      ipcRenderer.invoke('files:getGitBranch', dirPath),
    detectProjectKinds: (dirPaths: string[]) =>
      ipcRenderer.invoke('files:detectProjectKinds', dirPaths),
    readTextFile: (filePath: string) => ipcRenderer.invoke('files:readTextFile', filePath),
    writeTextFile: (filePath: string, content: string) =>
      ipcRenderer.invoke('files:writeTextFile', filePath, content),
    searchProjectTree: (
      dirPath: string,
      query: string,
      options: {
        matchCase: boolean;
        matchWholeWord: boolean;
        useRegex: boolean;
      },
    ) => ipcRenderer.invoke('files:searchProjectTree', dirPath, query, options),
  },
  git: {
    getStatus: (dirPath: string) => ipcRenderer.invoke('git:getStatus', dirPath),
    discoverRepos: (dirPath: string) => ipcRenderer.invoke('git:discoverRepos', dirPath),
    stage: (dirPath: string, paths: string[]) => ipcRenderer.invoke('git:stage', dirPath, paths),
    unstage: (dirPath: string, paths: string[]) =>
      ipcRenderer.invoke('git:unstage', dirPath, paths),
    discard: (dirPath: string, paths: string[]) =>
      ipcRenderer.invoke('git:discard', dirPath, paths),
    commit: (dirPath: string, message: string) =>
      ipcRenderer.invoke('git:commit', dirPath, message),
    diff: (dirPath: string, filePath: string, staged: boolean) =>
      ipcRenderer.invoke('git:diff', dirPath, filePath, staged),
    pull: (dirPath: string) => ipcRenderer.invoke('git:pull', dirPath),
    push: (dirPath: string) => ipcRenderer.invoke('git:push', dirPath),
    listBranches: (dirPath: string) => ipcRenderer.invoke('git:listBranches', dirPath),
    checkout: (dirPath: string, branch: string) =>
      ipcRenderer.invoke('git:checkout', dirPath, branch),
    createBranch: (dirPath: string, branch: string) =>
      ipcRenderer.invoke('git:createBranch', dirPath, branch),
    stash: (dirPath: string, message?: string) =>
      ipcRenderer.invoke('git:stash', dirPath, message),
    stashPop: (dirPath: string) => ipcRenderer.invoke('git:stashPop', dirPath),
    stashList: (dirPath: string) => ipcRenderer.invoke('git:stashList', dirPath),
    watch: (dirPath: string) => ipcRenderer.invoke('git:watch', dirPath),
    unwatch: (dirPath: string) => ipcRenderer.invoke('git:unwatch', dirPath),
    onRepoChange: (callback: (repoPath: string) => void): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, payload: { repoPath: string }) => {
        callback(payload.repoPath);
      };

      ipcRenderer.on('git:repo-changed', listener);
      return () => ipcRenderer.off('git:repo-changed', listener);
    },
  },
  browser: {
    probeUrl: (url: string): Promise<boolean> => ipcRenderer.invoke('browser:probeUrl', url),
    openDevTools: (guestWebContentsId: number, devtoolsWebContentsId: number): Promise<void> =>
      ipcRenderer.invoke('browser:openDevTools', guestWebContentsId, devtoolsWebContentsId),
    closeDevTools: (guestWebContentsId: number): Promise<void> =>
      ipcRenderer.invoke('browser:closeDevTools', guestWebContentsId),
  },
  session: {
    getScrollback: (paneId: string): Promise<string> =>
      ipcRenderer.invoke('session:getScrollback', paneId),
    saveScrollbacks: (entries: Record<string, string>): Promise<void> =>
      ipcRenderer.invoke('session:saveScrollbacks', entries),
    removePane: (paneId: string): Promise<void> =>
      ipcRenderer.invoke('session:removePane', paneId),
    flushComplete: (): Promise<void> => ipcRenderer.invoke('session:flush-complete'),
  },
  onToggleSidebar: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on('app:toggle-sidebar', listener);
    return () => ipcRenderer.off('app:toggle-sidebar', listener);
  },
  onOpenTabAddMenu: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on('app:open-tab-add-menu', listener);
    return () => ipcRenderer.off('app:open-tab-add-menu', listener);
  },
  onFlushSession: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on('app:flush-session', listener);
    return () => ipcRenderer.off('app:flush-session', listener);
  },
  music: {
    getNowPlaying: () => ipcRenderer.invoke('music:getNowPlaying'),
    togglePlayback: () => ipcRenderer.invoke('music:togglePlayback'),
    next: () => ipcRenderer.invoke('music:next'),
    previous: () => ipcRenderer.invoke('music:previous'),
  },
};

contextBridge.exposeInMainWorld('nexus', nexusApi);

export type NexusAPI = typeof nexusApi;
