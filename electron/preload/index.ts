import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AppState,
  JarvisIntent,
  JarvisPhase,
  Project,
  ProjectUpdatePayload,
  TerminalAgent,
  TerminalPasteImageSaved,
  Workspace,
  WorkspaceUpdatePayload,
} from '../types';

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
    updateWorkspace: (id: string, data: WorkspaceUpdatePayload): Promise<Workspace | null> =>
      ipcRenderer.invoke('projects:updateWorkspace', id, data),
    removeWorkspace: (id: string): Promise<void> =>
      ipcRenderer.invoke('projects:removeWorkspace', id),
    selectWorkspace: (id: string | null): Promise<void> =>
      ipcRenderer.invoke('projects:selectWorkspace', id),
    add: (projectPath: string, workspaceId?: string | null): Promise<Project> =>
      ipcRenderer.invoke('projects:add', projectPath, workspaceId),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('projects:remove', id),
    select: (id: string): Promise<void> => ipcRenderer.invoke('projects:select', id),
    clearActiveProject: (): Promise<void> => ipcRenderer.invoke('projects:clearActiveProject'),
    update: (id: string, data: ProjectUpdatePayload): Promise<Project | null> =>
      ipcRenderer.invoke('projects:update', id, data),
    saveLogo: (projectId: string, sourcePath: string): Promise<string> =>
      ipcRenderer.invoke('projects:saveLogo', projectId, sourcePath),
    saveLogoFromDataUrl: (projectId: string, dataUrl: string): Promise<string> =>
      ipcRenderer.invoke('projects:saveLogoFromDataUrl', projectId, dataUrl),
    saveWorkspaceLogoFromDataUrl: (workspaceId: string, dataUrl: string): Promise<string> =>
      ipcRenderer.invoke('projects:saveWorkspaceLogoFromDataUrl', workspaceId, dataUrl),
    removeLogo: (logoPath: string | null): Promise<void> =>
      ipcRenderer.invoke('projects:removeLogo', logoPath),
    setSidebarVideoSession: (session: AppState['sidebarVideoSession']): Promise<void> =>
      ipcRenderer.invoke('projects:setSidebarVideoSession', session),
    setSidebarVideoLastLink: (link: string | null): Promise<void> =>
      ipcRenderer.invoke('projects:setSidebarVideoLastLink', link),
  },
  terminal: {
    create: (cwd: string, agent: TerminalAgent): Promise<string> =>
      ipcRenderer.invoke('terminal:create', cwd, agent),
    has: (ptyId: string): Promise<boolean> => ipcRenderer.invoke('terminal:has', ptyId),
    getScrollback: (ptyId: string): Promise<string> =>
      ipcRenderer.invoke('terminal:getScrollback', ptyId),
    getScrollbackTail: (ptyId: string, maxBytes: number): Promise<string> =>
      ipcRenderer.invoke('terminal:getScrollbackTail', ptyId, maxBytes),
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
  agentPrint: {
    start: (options: {
      paneId: string;
      cwd: string;
      prompt: string;
      cliAgent?: string;
      model?: string | null;
      mode?: 'plan' | 'ask';
      continueSession?: boolean;
      resumeChatId?: string | null;
      attachmentPaths?: string[];
      runToken: string;
      preserveChildren?: boolean;
    }): Promise<void> => ipcRenderer.invoke('agent:printStart', options),
    stop: (paneId: string, options?: { preserveChildren?: boolean }): void => {
      ipcRenderer.send('agent:printStop', paneId, options);
    },
    isRunning: (paneId: string): Promise<boolean> =>
      ipcRenderer.invoke('agent:printIsRunning', paneId),
    adopt: (
      paneId: string,
    ): Promise<{
      running: boolean;
      runToken: string | null;
      exit: { code: number; error?: string; runToken: string } | null;
    }> => ipcRenderer.invoke('agent:printAdopt', paneId),
    warm: (): Promise<void> => ipcRenderer.invoke('agent:printWarm'),
    onData: (callback: (paneId: string, data: string, runToken: string) => void): (() => void) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        payload: { paneId: string; data: string; runToken: string },
      ) => {
        callback(payload.paneId, payload.data, payload.runToken);
      };

      ipcRenderer.on('agent:printData', listener);
      return () => ipcRenderer.off('agent:printData', listener);
    },
    onDone: (
      callback: (
        paneId: string,
        payload: { code: number; error?: string; runToken: string },
      ) => void,
    ): (() => void) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        payload: { paneId: string; code: number; error?: string; runToken: string },
      ) => {
        callback(payload.paneId, payload);
      };

      ipcRenderer.on('agent:printDone', listener);
      return () => ipcRenderer.off('agent:printDone', listener);
    },
  },
  dialog: {
    openDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDirectory'),
    openImage: (): Promise<string | null> => ipcRenderer.invoke('dialog:openImage'),
    openImages: (): Promise<string[] | null> => ipcRenderer.invoke('dialog:openImages'),
    openVideo: (): Promise<string | null> => ipcRenderer.invoke('dialog:openVideo'),
    openVideos: (): Promise<string[] | null> => ipcRenderer.invoke('dialog:openVideos'),
    openFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFile'),
    openFiles: (): Promise<string[] | null> => ipcRenderer.invoke('dialog:openFiles'),
  },
  files: {
    toLocalUrl: (filePath: string): string => toLocalFileUrl(filePath),
    readImageAsDataUrl: (filePath: string): Promise<string | null> =>
      ipcRenderer.invoke('files:readImageAsDataUrl', filePath),
    resolveProjectImageAsDataUrl: (
      projectPath: string | null,
      imageRef: string,
    ): Promise<string | null> =>
      ipcRenderer.invoke('files:resolveProjectImageAsDataUrl', projectPath, imageRef),
    saveTerminalPasteImage: (
      projectPath: string,
      paneId: string,
      imageIndex: number,
      dataUrl: string,
    ): Promise<TerminalPasteImageSaved> =>
      ipcRenderer.invoke('files:saveTerminalPasteImage', projectPath, paneId, imageIndex, dataUrl),
    listChildDirectories: (dirPath: string): Promise<string[]> =>
      ipcRenderer.invoke('files:listChildDirectories', dirPath),
    listDirectoryEntries: (dirPath: string) =>
      ipcRenderer.invoke('files:listDirectoryEntries', dirPath),
    statPath: (entryPath: string): Promise<'file' | 'directory' | null> =>
      ipcRenderer.invoke('files:statPath', entryPath),
    resolveCdPath: (cwd: string, target: string): Promise<string> =>
      ipcRenderer.invoke('files:resolveCdPath', cwd, target),
    getTerminalHints: (cwd: string) => ipcRenderer.invoke('files:getTerminalHints', cwd),
    getAgentSkillHints: (cwd: string) => ipcRenderer.invoke('files:getAgentSkillHints', cwd),
    getAgentModels: (provider: string) => ipcRenderer.invoke('files:getAgentModels', provider),
    listCursorAgentHistory: (cwd: string) =>
      ipcRenderer.invoke('files:listCursorAgentHistory', cwd),
    loadCursorAgentSessionTranscript: (cwd: string, sessionId: string) =>
      ipcRenderer.invoke('files:loadCursorAgentSessionTranscript', cwd, sessionId),
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
    createEmptyFile: (dirPath: string, name: string) =>
      ipcRenderer.invoke('files:createEmptyFile', dirPath, name),
    createDirectory: (dirPath: string, name: string) =>
      ipcRenderer.invoke('files:createDirectory', dirPath, name),
    moveEntry: (sourcePath: string, destinationDirPath: string) =>
      ipcRenderer.invoke('files:moveEntry', sourcePath, destinationDirPath),
    getPathForFile: (file: File): string => webUtils.getPathForFile(file),
    importEntries: (destinationDirPath: string, sourcePaths: string[]) =>
      ipcRenderer.invoke('files:importEntries', destinationDirPath, sourcePaths),
    renameEntry: (entryPath: string, nextName: string) =>
      ipcRenderer.invoke('files:renameEntry', entryPath, nextName),
    deleteEntry: (entryPath: string) => ipcRenderer.invoke('files:deleteEntry', entryPath),
    revealInFolder: (entryPath: string) => ipcRenderer.invoke('files:revealInFolder', entryPath),
    watchProject: (dirPath: string) => ipcRenderer.invoke('files:watchProject', dirPath),
    unwatchProject: (dirPath: string) => ipcRenderer.invoke('files:unwatchProject', dirPath),
    onProjectChange: (
      callback: (payload: {
        projectPath: string;
        changedPath?: string;
        structural?: boolean;
      }) => void,
    ): (() => void) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        payload: { projectPath: string; changedPath?: string; structural?: boolean },
      ) => {
        callback(payload);
      };

      ipcRenderer.on('files:project-changed', listener);
      return () => ipcRenderer.off('files:project-changed', listener);
    },
  },
  git: {
    getStatus: (dirPath: string) => ipcRenderer.invoke('git:getStatus', dirPath),
    getChangeCounts: (dirPath: string) =>
      ipcRenderer.invoke('git:getChangeCounts', dirPath) as Promise<{
        total: number;
        byRepo: Record<string, number>;
      }>,
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
    getFileDiffSides: (
      dirPath: string,
      filePath: string,
      options: { staged: boolean; untracked?: boolean },
    ) => ipcRenderer.invoke('git:getFileDiffSides', dirPath, filePath, options),
    getFileDiffImageSides: (
      dirPath: string,
      filePath: string,
      options: { staged: boolean; untracked?: boolean },
    ) => ipcRenderer.invoke('git:getFileDiffImageSides', dirPath, filePath, options),
    pull: (dirPath: string) => ipcRenderer.invoke('git:pull', dirPath),
    push: (dirPath: string) => ipcRenderer.invoke('git:push', dirPath),
    listBranches: (dirPath: string) => ipcRenderer.invoke('git:listBranches', dirPath),
    checkout: (dirPath: string, branch: string) =>
      ipcRenderer.invoke('git:checkout', dirPath, branch),
    createBranch: (dirPath: string, branch: string) =>
      ipcRenderer.invoke('git:createBranch', dirPath, branch),
    stash: (dirPath: string, message?: string) => ipcRenderer.invoke('git:stash', dirPath, message),
    stashPop: (dirPath: string) => ipcRenderer.invoke('git:stashPop', dirPath),
    stashList: (dirPath: string) => ipcRenderer.invoke('git:stashList', dirPath),
    watch: (dirPath: string) => ipcRenderer.invoke('git:watch', dirPath),
    unwatch: (dirPath: string) => ipcRenderer.invoke('git:unwatch', dirPath),
    invalidateCache: (dirPath: string) => ipcRenderer.invoke('git:invalidateCache', dirPath),
    listWorktrees: (dirPath: string) => ipcRenderer.invoke('git:listWorktrees', dirPath),
    addWorktree: (dirPath: string, worktreePath: string, branch: string) =>
      ipcRenderer.invoke('git:addWorktree', dirPath, worktreePath, branch),
    removeWorktree: (dirPath: string, worktreePath: string, force?: boolean) =>
      ipcRenderer.invoke('git:removeWorktree', dirPath, worktreePath, force),
    onRepoChange: (callback: (repoPath: string) => void): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, payload: { repoPath: string }) => {
        callback(payload.repoPath);
      };

      ipcRenderer.on('git:repo-changed', listener);
      return () => ipcRenderer.off('git:repo-changed', listener);
    },
  },
  homeDashboard: {
    getStats: (
      projectPaths: string[],
      provider?: 'cursor' | 'claude' | 'codex' | 'opencode' | 'antigravity',
    ) => ipcRenderer.invoke('homeDashboard:getStats', projectPaths, provider),
    recordActivity: (kind: 'prompts' | 'agentExecutions') =>
      ipcRenderer.invoke('homeDashboard:recordActivity', kind),
  },
  browser: {
    probeUrl: (url: string): Promise<boolean> => ipcRenderer.invoke('browser:probeUrl', url),
    openDevTools: (guestWebContentsId: number, devtoolsWebContentsId: number): Promise<void> =>
      ipcRenderer.invoke('browser:openDevTools', guestWebContentsId, devtoolsWebContentsId),
    closeDevTools: (guestWebContentsId: number): Promise<void> =>
      ipcRenderer.invoke('browser:closeDevTools', guestWebContentsId),
    captureScreenshot: (guestWebContentsId: number): Promise<boolean> =>
      ipcRenderer.invoke('browser:captureScreenshot', guestWebContentsId),
    onOpenInTab: (callback: (url: string) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, url: string) => {
        if (typeof url === 'string' && url.length > 0) {
          callback(url);
        }
      };
      ipcRenderer.on('browser:open-in-tab', listener);
      return () => ipcRenderer.off('browser:open-in-tab', listener);
    },
  },
  session: {
    getScrollback: (paneId: string): Promise<string> =>
      ipcRenderer.invoke('session:getScrollback', paneId),
    saveScrollbacks: (entries: Record<string, string>, pruneToPaneIds?: string[]): Promise<void> =>
      ipcRenderer.invoke('session:saveScrollbacks', entries, pruneToPaneIds),
    removePane: (paneId: string): Promise<void> => ipcRenderer.invoke('session:removePane', paneId),
    flushComplete: (): Promise<void> => ipcRenderer.invoke('session:flush-complete'),
  },
  onToggleExplorer: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on('app:toggle-explorer', listener);
    return () => ipcRenderer.off('app:toggle-explorer', listener);
  },
  onOpenTabAddMenu: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on('app:open-tab-add-menu', listener);
    return () => ipcRenderer.off('app:open-tab-add-menu', listener);
  },
  onOpenGlobalSearch: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on('app:open-global-search', listener);
    return () => ipcRenderer.off('app:open-global-search', listener);
  },
  onBrowserReload: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on('app:browser-reload', listener);
    return () => ipcRenderer.off('app:browser-reload', listener);
  },
  onBrowserFocusUrl: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on('app:browser-focus-url', listener);
    return () => ipcRenderer.off('app:browser-focus-url', listener);
  },
  onFlushSession: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on('app:flush-session', listener);
    return () => ipcRenderer.off('app:flush-session', listener);
  },
  onRendererRecovered: (callback: (message: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => {
      if (typeof message === 'string' && message.length > 0) {
        callback(message);
      }
    };
    ipcRenderer.on('app:renderer-recovered', listener);
    return () => ipcRenderer.off('app:renderer-recovered', listener);
  },
  onWindowFocusChange: (callback: (focused: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, focused: boolean) => {
      callback(focused === true);
    };
    ipcRenderer.on('app:window-focus', listener);
    return () => ipcRenderer.off('app:window-focus', listener);
  },
  onPowerSaveChange: (callback: (enabled: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, enabled: boolean) => {
      callback(enabled === true);
    };
    ipcRenderer.on('app:power-save', listener);
    return () => ipcRenderer.off('app:power-save', listener);
  },
  systemNotifications: {
    list: (limit?: number) => ipcRenderer.invoke('systemNotifications:list', limit),
    getAppIcon: (appId: string, appLabel?: string) =>
      ipcRenderer.invoke('systemNotifications:getAppIcon', appId, appLabel),
    delete: (id: string) => ipcRenderer.invoke('systemNotifications:delete', id),
    deleteAll: (limit?: number) => ipcRenderer.invoke('systemNotifications:deleteAll', limit),
    openApp: (appId: string) => ipcRenderer.invoke('systemNotifications:openApp', appId),
    openFullDiskAccessSettings: () =>
      ipcRenderer.invoke('systemNotifications:openFullDiskAccessSettings'),
    revealFullDiskAccessApp: () =>
      ipcRenderer.invoke('systemNotifications:revealFullDiskAccessApp'),
  },
  systemStatus: {
    getSnapshot: () => ipcRenderer.invoke('systemStatus:getSnapshot'),
    setVolume: (volume: number) => ipcRenderer.invoke('systemStatus:setVolume', volume),
    setMuted: (muted: boolean) => ipcRenderer.invoke('systemStatus:setMuted', muted),
    listAudioOutputDevices: () => ipcRenderer.invoke('systemStatus:listAudioOutputDevices'),
    setAudioOutputDevice: (deviceId: string) =>
      ipcRenderer.invoke('systemStatus:setAudioOutputDevice', deviceId),
    getWifiPower: () => ipcRenderer.invoke('systemStatus:getWifiPower'),
    setWifiPower: (enabled: boolean) => ipcRenderer.invoke('systemStatus:setWifiPower', enabled),
    listWifiNetworks: () => ipcRenderer.invoke('systemStatus:listWifiNetworks'),
    getWifiPopupState: () => ipcRenderer.invoke('systemStatus:getWifiPopupState'),
    getConnectedWifiNetwork: () => ipcRenderer.invoke('systemStatus:getConnectedWifiNetwork'),
    disconnectWifiNetwork: () => ipcRenderer.invoke('systemStatus:disconnectWifiNetwork'),
    connectWifiNetwork: (ssid: string, password?: string) =>
      ipcRenderer.invoke('systemStatus:connectWifiNetwork', ssid, password),
  },
  music: {
    getNowPlaying: () => ipcRenderer.invoke('music:getNowPlaying'),
    getPlaylists: () => ipcRenderer.invoke('music:getPlaylists'),
    togglePlayback: () => ipcRenderer.invoke('music:togglePlayback'),
    next: () => ipcRenderer.invoke('music:next'),
    previous: () => ipcRenderer.invoke('music:previous'),
    seek: (seconds: number) => ipcRenderer.invoke('music:seek', seconds),
    cycleRepeat: () => ipcRenderer.invoke('music:cycleRepeat'),
    toggleShuffle: () => ipcRenderer.invoke('music:toggleShuffle'),
    playQueueTrack: (playlistIndex: number) =>
      ipcRenderer.invoke('music:playQueueTrack', playlistIndex),
    playPlaylist: (playlistId: string) => ipcRenderer.invoke('music:playPlaylist', playlistId),
  },
  whatsapp: {
    isDesktopInstalled: () => ipcRenderer.invoke('whatsapp:isDesktopInstalled'),
    openLink: (url: string) => ipcRenderer.invoke('whatsapp:openLink', url),
  },
  mail: {
    getMailboxes: () => ipcRenderer.invoke('mail:getMailboxes'),
    getInboxMessages: (mailbox) => ipcRenderer.invoke('mail:getInboxMessages', mailbox),
    openMessage: (mailbox, messageId) => ipcRenderer.invoke('mail:openMessage', mailbox, messageId),
  },
  calendar: {
    getTodayEvents: () => ipcRenderer.invoke('calendar:getTodayEvents'),
    requestAccess: () => ipcRenderer.invoke('calendar:requestAccess'),
    getCalendars: () => ipcRenderer.invoke('calendar:getCalendars'),
    getEventsInRange: (startAt, endAt) =>
      ipcRenderer.invoke('calendar:getEventsInRange', startAt, endAt),
    createEvent: (input) => ipcRenderer.invoke('calendar:createEvent', input),
    updateEvent: (input) => ipcRenderer.invoke('calendar:updateEvent', input),
    deleteEvent: (input) => ipcRenderer.invoke('calendar:deleteEvent', input),
    openEvent: (startAt) => ipcRenderer.invoke('calendar:openEvent', startAt),
    openPrivacySettings: () => ipcRenderer.invoke('calendar:openPrivacySettings'),
  },
  macParakeet: {
    getTranscriptions: (sourceType, forceRefresh) =>
      ipcRenderer.invoke('macParakeet:getTranscriptions', sourceType, forceRefresh),
    getTranscriptionDetail: (id) => ipcRenderer.invoke('macParakeet:getTranscriptionDetail', id),
    translateConclusion: (id) => ipcRenderer.invoke('macParakeet:translateConclusion', id),
    openApp: () => ipcRenderer.invoke('macParakeet:openApp'),
    startCallFromEvent: (title) => ipcRenderer.invoke('macParakeet:startCallFromEvent', title),
    renameTranscriptionTitle: (id, title) =>
      ipcRenderer.invoke('macParakeet:renameTranscriptionTitle', id, title),
  },
  jarvis: {
    status: () => ipcRenderer.invoke('jarvis:status'),
    start: () => ipcRenderer.invoke('jarvis:start'),
    stop: () => ipcRenderer.invoke('jarvis:stop'),
    processUtterance: (wavBase64, projectNames) =>
      ipcRenderer.invoke('jarvis:processUtterance', wavBase64, projectNames ?? []),
    processTranscript: (transcript, projectNames) =>
      ipcRenderer.invoke('jarvis:processTranscript', transcript, projectNames ?? []),
    transcribe: (wavBase64) => ipcRenderer.invoke('jarvis:transcribe', wavBase64),
    speakSummary: (text) => ipcRenderer.invoke('jarvis:speakSummary', text),
    speak: (text) => ipcRenderer.invoke('jarvis:speak', text),
    notifyFinished: (ok, error) => ipcRenderer.invoke('jarvis:notifyFinished', ok, error),
    setOllamaModel: (model) => ipcRenderer.invoke('jarvis:setOllamaModel', model),
    onPhase: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { phase: JarvisPhase }) => {
        callback(payload.phase);
      };
      ipcRenderer.on('jarvis:phase', listener);
      return () => ipcRenderer.off('jarvis:phase', listener);
    },
    onListening: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { listening: boolean }) => {
        callback(Boolean(payload.listening));
      };
      ipcRenderer.on('jarvis:listening', listener);
      return () => ipcRenderer.off('jarvis:listening', listener);
    },
    onHeard: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { transcript: string }) => {
        callback(payload.transcript);
      };
      ipcRenderer.on('jarvis:heard', listener);
      return () => ipcRenderer.off('jarvis:heard', listener);
    },
    onStarted: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { transcript: string }) => {
        callback(payload.transcript);
      };
      ipcRenderer.on('jarvis:started', listener);
      return () => ipcRenderer.off('jarvis:started', listener);
    },
    onIntent: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { intent: JarvisIntent }) => {
        callback(payload.intent);
      };
      ipcRenderer.on('jarvis:intent', listener);
      return () => ipcRenderer.off('jarvis:intent', listener);
    },
    onFinished: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { ok: boolean; error: string | null },
      ) => {
        callback(Boolean(payload.ok), payload.error ?? null);
      };
      ipcRenderer.on('jarvis:finished', listener);
      return () => ipcRenderer.off('jarvis:finished', listener);
    },
    onError: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { message: string }) => {
        callback(payload.message);
      };
      ipcRenderer.on('jarvis:error', listener);
      return () => ipcRenderer.off('jarvis:error', listener);
    },
  },
  vercel: {
    getTokenConfigured: () => ipcRenderer.invoke('vercel:getTokenConfigured'),
    getToken: (): Promise<string | null> => ipcRenderer.invoke('vercel:getToken'),
    listKeys: () => ipcRenderer.invoke('vercel:listKeys'),
    getKeyToken: (id) => ipcRenderer.invoke('vercel:getKeyToken', id),
    addKey: (token) => ipcRenderer.invoke('vercel:addKey', token),
    saveToken: (token) => ipcRenderer.invoke('vercel:saveToken', token),
    removeKey: (id) => ipcRenderer.invoke('vercel:removeKey', id),
    clearToken: () => ipcRenderer.invoke('vercel:clearToken'),
    validateToken: (token) => ipcRenderer.invoke('vercel:validateToken', token),
    getActiveDeployment: () => ipcRenderer.invoke('vercel:getActiveDeployment'),
    listDeployments: () => ipcRenderer.invoke('vercel:listDeployments'),
    getDeploymentLogs: (deploymentUid, credentialId) =>
      ipcRenderer.invoke('vercel:getDeploymentLogs', deploymentUid, credentialId),
  },
  render: {
    getKeysConfigured: () => ipcRenderer.invoke('render:getKeysConfigured'),
    listKeys: () => ipcRenderer.invoke('render:listKeys'),
    getKeyToken: (id) => ipcRenderer.invoke('render:getKeyToken', id),
    addKey: (token) => ipcRenderer.invoke('render:addKey', token),
    removeKey: (id) => ipcRenderer.invoke('render:removeKey', id),
    getActiveDeployment: () => ipcRenderer.invoke('render:getActiveDeployment'),
    listDeployments: () => ipcRenderer.invoke('render:listDeployments'),
    getDeploymentLogs: (query) => ipcRenderer.invoke('render:getDeploymentLogs', query),
  },
  cursorUsage: {
    getCurrentPeriod: (force) => ipcRenderer.invoke('cursorUsage:getCurrentPeriod', force),
  },
  emulator: {
    getSetupStatus: () => ipcRenderer.invoke('emulator:getSetupStatus'),
    listDevices: (platform) => ipcRenderer.invoke('emulator:listDevices', platform),
    recordDeviceUsage: (platform, deviceId) =>
      ipcRenderer.invoke('emulator:recordDeviceUsage', platform, deviceId),
    start: (tabId, platform, deviceId) =>
      ipcRenderer.invoke('emulator:start', tabId, platform, deviceId),
    stop: (sessionId) => ipcRenderer.invoke('emulator:stop', sessionId),
    stopByTabId: (tabId) => ipcRenderer.invoke('emulator:stopByTabId', tabId),
    attachTab: (tabId) => ipcRenderer.invoke('emulator:attachTab', tabId),
    setCapturePaused: (sessionId, paused) =>
      ipcRenderer.invoke('emulator:setCapturePaused', sessionId, paused),
    tap: (sessionId, x, y) => ipcRenderer.invoke('emulator:tap', sessionId, x, y),
    swipe: (sessionId, x1, y1, x2, y2, durationMs) =>
      ipcRenderer.invoke('emulator:swipe', sessionId, x1, y1, x2, y2, durationMs),
    pressHome: (sessionId) => ipcRenderer.invoke('emulator:pressHome', sessionId),
    pressAppSwitcher: (sessionId) => ipcRenderer.invoke('emulator:pressAppSwitcher', sessionId),
    pressBack: (sessionId) => ipcRenderer.invoke('emulator:pressBack', sessionId),
    rotate: (sessionId) => ipcRenderer.invoke('emulator:rotate', sessionId),
    typeText: (sessionId, text) => ipcRenderer.invoke('emulator:typeText', sessionId, text),
    sendInput: (sessionId, line) => ipcRenderer.invoke('emulator:sendInput', sessionId, line),
    screenshot: (sessionId) => ipcRenderer.invoke('emulator:screenshot', sessionId),
    listApps: (sessionId) => ipcRenderer.invoke('emulator:listApps', sessionId),
    launchApp: (sessionId, appId) => ipcRenderer.invoke('emulator:launchApp', sessionId, appId),
    terminateApp: (sessionId, appId) =>
      ipcRenderer.invoke('emulator:terminateApp', sessionId, appId),
    openNativeWindow: (sessionId) => ipcRenderer.invoke('emulator:openNativeWindow', sessionId),
    onVideoChunk: (callback) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        payload: {
          sessionId: string;
          codec: 'h264' | 'jpeg' | 'png';
          chunk: Uint8Array | ArrayBuffer | number[];
          width?: number;
          height?: number;
          orientation?: 'portrait' | 'landscapeLeft' | 'portraitUpsideDown' | 'landscapeRight';
        },
      ) => {
        const chunk =
          payload.chunk instanceof Uint8Array
            ? payload.chunk
            : new Uint8Array(
                payload.chunk instanceof ArrayBuffer ? payload.chunk : (payload.chunk as number[]),
              );

        callback({
          sessionId: payload.sessionId,
          codec: payload.codec,
          chunk,
          width: payload.width,
          height: payload.height,
          orientation: payload.orientation,
        });
      };

      ipcRenderer.on('emulator:video-chunk', listener);
      return () => ipcRenderer.off('emulator:video-chunk', listener);
    },
    onSessionState: (callback) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        payload: {
          sessionId: string;
          tabId: string;
          state: 'booting' | 'running' | 'stopped' | 'error';
          message?: string;
          captureBackend?: 'simulator-server' | 'idb' | 'simctl' | 'adb';
          targetFps?: number;
          streamFps?: number;
          fallbackReason?: string;
          streamUrl?: string;
        },
      ) => {
        callback(payload);
      };

      ipcRenderer.on('emulator:session-state', listener);
      return () => ipcRenderer.off('emulator:session-state', listener);
    },
    onStreamStats: (callback) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        payload: {
          sessionId: string;
          tabId: string;
          captureBackend: 'simulator-server' | 'idb' | 'simctl' | 'adb';
          targetFps: number;
          streamFps: number;
          fallbackReason?: string;
          streamUrl?: string;
        },
      ) => {
        callback(payload);
      };

      ipcRenderer.on('emulator:stream-stats', listener);
      return () => ipcRenderer.off('emulator:stream-stats', listener);
    },
    onFrameSize: (callback) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        payload: {
          sessionId: string;
          width: number;
          height: number;
          orientation?: 'portrait' | 'landscapeLeft' | 'portraitUpsideDown' | 'landscapeRight';
        },
      ) => {
        callback(payload);
      };

      ipcRenderer.on('emulator:frame-size', listener);
      return () => ipcRenderer.off('emulator:frame-size', listener);
    },
    onSessionCreated: (callback) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        payload: { sessionId: string; tabId: string },
      ) => {
        callback(payload);
      };

      ipcRenderer.on('emulator:session-created', listener);
      return () => ipcRenderer.off('emulator:session-created', listener);
    },
    onEnsureRemoteTab: (callback) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        payload: {
          tabId: string;
          platform: 'android' | 'ios';
          deviceId: string;
          sessionId?: string | null;
          localProjectId?: string | null;
        },
      ) => {
        callback(payload);
      };

      ipcRenderer.on('emulator:ensure-remote-tab', listener);
      return () => ipcRenderer.off('emulator:ensure-remote-tab', listener);
    },
  },
  api: {
    loadProjectData: (projectId) => ipcRenderer.invoke('api:loadProjectData', projectId),
    saveProjectData: (projectId, data) =>
      ipcRenderer.invoke('api:saveProjectData', projectId, data),
    sendRequest: (payload) => ipcRenderer.invoke('api:sendRequest', payload),
  },
  tasks: {
    saveCredentials: (projectId, credentials) =>
      ipcRenderer.invoke('tasks:saveCredentials', projectId, credentials),
    getCredentials: (projectId) => ipcRenderer.invoke('tasks:getCredentials', projectId),
    getCredentialStatus: (projectId) => ipcRenderer.invoke('tasks:getCredentialStatus', projectId),
    clearCredentials: (projectId) => ipcRenderer.invoke('tasks:clearCredentials', projectId),
    openExternalUrl: (url) => ipcRenderer.invoke('tasks:openExternalUrl', url),
    testConnection: (projectId, config, credentials) =>
      ipcRenderer.invoke('tasks:testConnection', projectId, config, credentials),
    listJiraProjects: (projectId, config) =>
      ipcRenderer.invoke('tasks:listJiraProjects', projectId, config),
    listTrelloBoards: (projectId) => ipcRenderer.invoke('tasks:listTrelloBoards', projectId),
    listDeepcrmPipelines: (projectId) =>
      ipcRenderer.invoke('tasks:listDeepcrmPipelines', projectId),
    sync: (projectId) => ipcRenderer.invoke('tasks:sync', projectId),
    saveAttachment: (projectId, taskId, sourcePath) =>
      ipcRenderer.invoke('tasks:saveAttachment', projectId, taskId, sourcePath),
    saveAttachmentFromDataUrl: (projectId, taskId, dataUrl, fileName) =>
      ipcRenderer.invoke('tasks:saveAttachmentFromDataUrl', projectId, taskId, dataUrl, fileName),
    generateAiDraft: (input) => ipcRenderer.invoke('tasks:generateAiDraft', input),
    readAttachment: (filePath) => ipcRenderer.invoke('tasks:readAttachment', filePath),
    getDetail: (projectId, externalId) =>
      ipcRenderer.invoke('tasks:getDetail', projectId, externalId),
    addComment: (projectId, externalId, body) =>
      ipcRenderer.invoke('tasks:addComment', projectId, externalId, body),
    listBoardColumns: (projectId, externalId) =>
      ipcRenderer.invoke('tasks:listBoardColumns', projectId, externalId),
    moveBoardColumn: (projectId, externalId, columnId) =>
      ipcRenderer.invoke('tasks:moveBoardColumn', projectId, externalId, columnId),
    completeExternal: (projectId, externalId) =>
      ipcRenderer.invoke('tasks:completeExternal', projectId, externalId),
    startExternal: (projectId, externalId) =>
      ipcRenderer.invoke('tasks:startExternal', projectId, externalId),
  },
  tests: {
    discover: (projectPath, kind) => ipcRenderer.invoke('tests:discover', projectPath, kind),
    resolveSteps: (projectPath, entry) =>
      ipcRenderer.invoke('tests:resolveSteps', projectPath, entry),
    run: (projectPath, projectId, entry, steps = []) =>
      ipcRenderer.invoke('tests:run', projectPath, projectId, entry, steps),
    stop: (runId) => ipcRenderer.invoke('tests:stop', runId),
    isRunning: (runId) => ipcRenderer.invoke('tests:isRunning', runId),
    prepareMaestroRun: (steps) => ipcRenderer.invoke('tests:prepareMaestroRun', steps),
    resolveHighlight: (runId, source) =>
      ipcRenderer.invoke('tests:resolveHighlight', runId, source),
    onOutput: (callback) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        payload: { runId: string; entryId: string; projectId: string; chunk: string },
      ) => {
        callback(payload);
      };

      ipcRenderer.on('tests:output', listener);
      return () => ipcRenderer.off('tests:output', listener);
    },
    onExit: (callback) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        payload: { runId: string; entryId: string; projectId: string; code: number },
      ) => {
        callback(payload);
      };

      ipcRenderer.on('tests:exit', listener);
      return () => ipcRenderer.off('tests:exit', listener);
    },
    onHighlight: (callback) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        payload: import('../../types/test').MaestroTestHighlightEvent,
      ) => {
        callback(payload);
      };

      ipcRenderer.on('tests:highlight', listener);
      return () => ipcRenderer.off('tests:highlight', listener);
    },
  },
  passwords: {
    getValues: (projectId: string, collectionId: string): Promise<Record<string, string>> =>
      ipcRenderer.invoke('passwords:getValues', projectId, collectionId),
    saveValues: (
      projectId: string,
      collectionId: string,
      values: Record<string, string>,
    ): Promise<void> => ipcRenderer.invoke('passwords:saveValues', projectId, collectionId, values),
    deleteValues: (projectId: string, collectionId: string): Promise<void> =>
      ipcRenderer.invoke('passwords:deleteValues', projectId, collectionId),
    getGuestPreloadPath: (): Promise<string> => ipcRenderer.invoke('passwords:getGuestPreloadPath'),
  },
  debug: {
    sessionLog: (payload: {
      location: string;
      message: string;
      data?: Record<string, unknown>;
      hypothesisId?: string;
      runId?: string;
    }): void => {
      ipcRenderer.send('debug:sessionLog', payload);
    },
  },
  cloud: {
    getLocalRuntimeStatus: (): Promise<{
      online: boolean;
      deviceId: string | null;
      workspaceId: string | null;
      hostname: string | null;
      name: string | null;
      lastSeenAt: string | null;
      capabilities: Record<string, boolean>;
      activeAgents: number;
      activeTerminals: number;
    }> => ipcRenderer.invoke('cloud:getLocalRuntimeStatus'),
    pingRuntime: (): Promise<boolean> => ipcRenderer.invoke('cloud:pingRuntime'),
    listOpenAgentSessions: (): Promise<
      Array<{
        session: Record<string, unknown>;
        project: Record<string, unknown> | null;
        executions: Array<Record<string, unknown>>;
        messages: Array<Record<string, unknown>>;
      }>
    > => ipcRenderer.invoke('cloud:listOpenAgentSessions'),
    writeMobileReleaseSnapshot: (payload: unknown): Promise<{ ok: boolean; path: string }> =>
      ipcRenderer.invoke('cloud:writeMobileReleaseSnapshot', payload),
  },
  missions: {
    list: (): Promise<import('../types/mission').Mission[]> => ipcRenderer.invoke('missions:list'),
    get: (id: string): Promise<import('../types/mission').Mission | null> =>
      ipcRenderer.invoke('missions:get', id),
    create: (
      input: import('../types/mission').CreateMissionInput,
    ): Promise<import('../types/mission').Mission> => ipcRenderer.invoke('missions:create', input),
    update: (
      id: string,
      patch: Partial<import('../types/mission').Mission>,
    ): Promise<import('../types/mission').Mission | null> =>
      ipcRenderer.invoke('missions:update', id, patch),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke('missions:remove', id),
    saveAttachment: (
      missionId: string,
      sourcePath: string,
    ): Promise<import('../types/mission').MissionAttachment | null> =>
      ipcRenderer.invoke('missions:saveAttachment', missionId, sourcePath),
    savePendingAttachmentFromDataUrl: (
      dataUrl: string,
      fileName?: string,
    ): Promise<{ id: string; name: string; sourcePath: string } | null> =>
      ipcRenderer.invoke('missions:savePendingAttachmentFromDataUrl', dataUrl, fileName),
    upsertNode: (
      missionId: string,
      node: import('../types/mission').MissionAgentNode,
    ): Promise<import('../types/mission').Mission | null> =>
      ipcRenderer.invoke('missions:upsertNode', missionId, node),
    removeNode: (
      missionId: string,
      nodeId: string,
    ): Promise<import('../types/mission').Mission | null> =>
      ipcRenderer.invoke('missions:removeNode', missionId, nodeId),
    upsertEdge: (
      missionId: string,
      edge: import('../types/mission').MissionEdge,
    ): Promise<import('../types/mission').Mission | null> =>
      ipcRenderer.invoke('missions:upsertEdge', missionId, edge),
    removeEdge: (
      missionId: string,
      edgeId: string,
    ): Promise<import('../types/mission').Mission | null> =>
      ipcRenderer.invoke('missions:removeEdge', missionId, edgeId),
    upsertInboxItem: (
      missionId: string,
      item: import('../types/mission').MissionInboxItem,
    ): Promise<import('../types/mission').Mission | null> =>
      ipcRenderer.invoke('missions:upsertInboxItem', missionId, item),
    listInbox: (): Promise<import('../types/mission').MissionInboxItem[]> =>
      ipcRenderer.invoke('missions:listInbox'),
    listCustomRoles: (): Promise<import('../types/mission').AgentRole[]> =>
      ipcRenderer.invoke('missions:listCustomRoles'),
    listCustomTemplates: (): Promise<import('../types/mission').AgentTemplate[]> =>
      ipcRenderer.invoke('missions:listCustomTemplates'),
    listFlowTemplates: (): Promise<import('../types/mission').MissionFlowTemplate[]> =>
      ipcRenderer.invoke('missions:listFlowTemplates'),
    saveCustomRole: (
      role: import('../types/mission').AgentRole,
    ): Promise<import('../types/mission').AgentRole | null> =>
      ipcRenderer.invoke('missions:saveCustomRole', role),
    saveCustomTemplate: (
      template: import('../types/mission').AgentTemplate,
    ): Promise<import('../types/mission').AgentTemplate | null> =>
      ipcRenderer.invoke('missions:saveCustomTemplate', template),
    saveFlowTemplate: (
      template: import('../types/mission').MissionFlowTemplate,
    ): Promise<import('../types/mission').MissionFlowTemplate | null> =>
      ipcRenderer.invoke('missions:saveFlowTemplate', template),
    removeFlowTemplate: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('missions:removeFlowTemplate', id),
    runShell: (payload: {
      command: string;
      cwd: string;
    }): Promise<{
      ok: boolean;
      stdout: string;
      stderr: string;
      exitCode: number | null;
      error?: string;
    }> => ipcRenderer.invoke('missions:runShell', payload),
    writeNoteFile: (
      missionId: string,
      nodeId: string,
      content: string,
    ): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke('missions:writeNoteFile', missionId, nodeId, content),
    ensureLiveSkill: (projectPath: string): Promise<boolean> =>
      ipcRenderer.invoke('missions:ensureLiveSkill', projectPath),
    onLiveRequest: (
      callback: (request: {
        id: string;
        type: string;
        missionId?: string;
        fromNodeId?: string;
        to?: string;
        message?: string;
        note?: string;
        content?: string;
        append?: boolean;
      }) => void,
    ): (() => void) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        payload: {
          id: string;
          type: string;
          missionId?: string;
          fromNodeId?: string;
          to?: string;
          message?: string;
          note?: string;
          content?: string;
          append?: boolean;
        },
      ) => {
        callback(payload);
      };
      ipcRenderer.on('mission-live:request', listener);
      return () => ipcRenderer.off('mission-live:request', listener);
    },
    respondLiveRequest: (payload: {
      id: string;
      ok: boolean;
      result?: unknown;
      error?: string;
    }): Promise<boolean> => ipcRenderer.invoke('mission-live:respond', payload),
    getLiveBridgeStatus: (): Promise<{
      port: number;
      url: string | null;
      cliDir: string;
    }> => ipcRenderer.invoke('mission-live:status'),
    onUpdated: (
      callback: (mission: import('../types/mission').Mission) => void,
    ): (() => void) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        payload: import('../types/mission').Mission,
      ) => {
        callback(payload);
      };

      ipcRenderer.on('mission:updated', listener);
      return () => ipcRenderer.off('mission:updated', listener);
    },
    onInbox: (
      callback: (items: import('../types/mission').MissionInboxItem[]) => void,
    ): (() => void) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        payload: import('../types/mission').MissionInboxItem[],
      ) => {
        callback(payload);
      };

      ipcRenderer.on('mission:inbox', listener);
      return () => ipcRenderer.off('mission:inbox', listener);
    },
  },
  agentPip: {
    pin: (snapshot: import('../types/agentPip').AgentPipSnapshot): Promise<void> =>
      ipcRenderer.invoke('agentPip:pin', snapshot),
    update: (snapshot: import('../types/agentPip').AgentPipSnapshot): Promise<boolean> =>
      ipcRenderer.invoke('agentPip:update', snapshot),
    unpin: (): Promise<void> => ipcRenderer.invoke('agentPip:unpin'),
    getSnapshot: (): Promise<import('../types/agentPip').AgentPipSnapshot | null> =>
      ipcRenderer.invoke('agentPip:getSnapshot'),
    focusMain: (): Promise<void> => ipcRenderer.invoke('agentPip:focusMain'),
    command: (payload: import('../types/agentPip').AgentPipCommand): Promise<boolean> =>
      ipcRenderer.invoke('agentPip:command', payload),
    onSnapshot: (
      callback: (snapshot: import('../types/agentPip').AgentPipSnapshot) => void,
    ): (() => void) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        payload: import('../types/agentPip').AgentPipSnapshot,
      ) => {
        callback(payload);
      };

      ipcRenderer.on('agentPip:snapshot', listener);
      return () => ipcRenderer.off('agentPip:snapshot', listener);
    },
    onUnpinned: (callback: () => void): (() => void) => {
      const listener = () => {
        callback();
      };

      ipcRenderer.on('agentPip:unpinned', listener);
      return () => ipcRenderer.off('agentPip:unpinned', listener);
    },
    onHostCommand: (
      callback: (request: import('../types/agentPip').AgentPipHostRequest) => void,
    ): (() => void) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        payload: import('../types/agentPip').AgentPipHostRequest,
      ) => {
        callback(payload);
      };

      ipcRenderer.on('agentPip:hostCommand', listener);
      return () => ipcRenderer.off('agentPip:hostCommand', listener);
    },
    replyHostCommand: (requestId: string, ok: boolean): void => {
      ipcRenderer.send('agentPip:hostResult', { requestId, ok });
    },
  },
};

contextBridge.exposeInMainWorld('nexus', nexusApi);

export type NexusAPI = typeof nexusApi;
