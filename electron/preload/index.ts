import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AppState,
  Project,
  ProjectUpdatePayload,
  TerminalAgent,
  TerminalPasteImageSaved,
  Workspace,
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
    removeWorkspace: (id: string): Promise<void> => ipcRenderer.invoke('projects:removeWorkspace', id),
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
      model?: string | null;
      mode?: 'plan' | 'ask';
      continueSession?: boolean;
      resumeChatId?: string | null;
      runToken: string;
    }): Promise<void> => ipcRenderer.invoke('agent:printStart', options),
    stop: (paneId: string): void => {
      ipcRenderer.send('agent:printStop', paneId);
    },
    isRunning: (paneId: string): Promise<boolean> =>
      ipcRenderer.invoke('agent:printIsRunning', paneId),
    onData: (
      callback: (paneId: string, data: string, runToken: string) => void,
    ): (() => void) => {
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
    openFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFile'),
  },
  files: {
    toLocalUrl: (filePath: string): string => toLocalFileUrl(filePath),
    readImageAsDataUrl: (filePath: string): Promise<string | null> =>
      ipcRenderer.invoke('files:readImageAsDataUrl', filePath),
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
    resolveCdPath: (cwd: string, target: string): Promise<string> =>
      ipcRenderer.invoke('files:resolveCdPath', cwd, target),
    getTerminalHints: (cwd: string) => ipcRenderer.invoke('files:getTerminalHints', cwd),
    getAgentSkillHints: (cwd: string) => ipcRenderer.invoke('files:getAgentSkillHints', cwd),
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
      callback: (payload: { projectPath: string; changedPath?: string; structural?: boolean }) => void,
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
    stash: (dirPath: string, message?: string) =>
      ipcRenderer.invoke('git:stash', dirPath, message),
    stashPop: (dirPath: string) => ipcRenderer.invoke('git:stashPop', dirPath),
    stashList: (dirPath: string) => ipcRenderer.invoke('git:stashList', dirPath),
    watch: (dirPath: string) => ipcRenderer.invoke('git:watch', dirPath),
    unwatch: (dirPath: string) => ipcRenderer.invoke('git:unwatch', dirPath),
    invalidateCache: (dirPath: string) => ipcRenderer.invoke('git:invalidateCache', dirPath),
    onRepoChange: (callback: (repoPath: string) => void): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, payload: { repoPath: string }) => {
        callback(payload.repoPath);
      };

      ipcRenderer.on('git:repo-changed', listener);
      return () => ipcRenderer.off('git:repo-changed', listener);
    },
  },
  homeDashboard: {
    getStats: (projectPaths: string[]) =>
      ipcRenderer.invoke('homeDashboard:getStats', projectPaths),
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
  onFlushSession: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on('app:flush-session', listener);
    return () => ipcRenderer.off('app:flush-session', listener);
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
    playQueueTrack: (playlistIndex: number) => ipcRenderer.invoke('music:playQueueTrack', playlistIndex),
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
    openEvent: (startAt) => ipcRenderer.invoke('calendar:openEvent', startAt),
    openPrivacySettings: () => ipcRenderer.invoke('calendar:openPrivacySettings'),
  },
  macParakeet: {
    getTranscriptions: (sourceType, forceRefresh) =>
      ipcRenderer.invoke('macParakeet:getTranscriptions', sourceType, forceRefresh),
    getTranscriptionDetail: (id) => ipcRenderer.invoke('macParakeet:getTranscriptionDetail', id),
    openApp: () => ipcRenderer.invoke('macParakeet:openApp'),
    renameTranscriptionTitle: (id, title) =>
      ipcRenderer.invoke('macParakeet:renameTranscriptionTitle', id, title),
  },
  vercel: {
    getTokenConfigured: () => ipcRenderer.invoke('vercel:getTokenConfigured'),
    saveToken: (token) => ipcRenderer.invoke('vercel:saveToken', token),
    clearToken: () => ipcRenderer.invoke('vercel:clearToken'),
    validateToken: (token) => ipcRenderer.invoke('vercel:validateToken', token),
    getActiveDeployment: () => ipcRenderer.invoke('vercel:getActiveDeployment'),
    listDeployments: () => ipcRenderer.invoke('vercel:listDeployments'),
    getDeploymentLogs: (deploymentUid) =>
      ipcRenderer.invoke('vercel:getDeploymentLogs', deploymentUid),
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
    tap: (sessionId, x, y) => ipcRenderer.invoke('emulator:tap', sessionId, x, y),
    swipe: (sessionId, x1, y1, x2, y2, durationMs) =>
      ipcRenderer.invoke('emulator:swipe', sessionId, x1, y1, x2, y2, durationMs),
    pressHome: (sessionId) => ipcRenderer.invoke('emulator:pressHome', sessionId),
    pressBack: (sessionId) => ipcRenderer.invoke('emulator:pressBack', sessionId),
    rotate: (sessionId) => ipcRenderer.invoke('emulator:rotate', sessionId),
    typeText: (sessionId, text) => ipcRenderer.invoke('emulator:typeText', sessionId, text),
    screenshot: (sessionId) => ipcRenderer.invoke('emulator:screenshot', sessionId),
    onVideoChunk: (callback) => {
      const listener = (
        _: Electron.IpcRendererEvent,
        payload: {
          sessionId: string;
          codec: 'h264' | 'jpeg' | 'png';
          chunk: Uint8Array | ArrayBuffer | number[];
          width?: number;
          height?: number;
        },
      ) => {
        const chunk =
          payload.chunk instanceof Uint8Array
            ? payload.chunk
            : new Uint8Array(
                payload.chunk instanceof ArrayBuffer
                  ? payload.chunk
                  : (payload.chunk as number[]),
              );

        callback({
          sessionId: payload.sessionId,
          codec: payload.codec,
          chunk,
          width: payload.width,
          height: payload.height,
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
          captureBackend?: 'idb' | 'simctl' | 'adb';
          targetFps?: number;
          streamFps?: number;
          fallbackReason?: string;
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
          captureBackend: 'idb' | 'simctl' | 'adb';
          targetFps: number;
          streamFps: number;
          fallbackReason?: string;
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
        payload: { sessionId: string; width: number; height: number },
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
  },
  api: {
    loadProjectData: (projectId) => ipcRenderer.invoke('api:loadProjectData', projectId),
    saveProjectData: (projectId, data) => ipcRenderer.invoke('api:saveProjectData', projectId, data),
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
    listDeepcrmPipelines: (projectId) => ipcRenderer.invoke('tasks:listDeepcrmPipelines', projectId),
    sync: (projectId) => ipcRenderer.invoke('tasks:sync', projectId),
    saveAttachment: (projectId, taskId, sourcePath) =>
      ipcRenderer.invoke('tasks:saveAttachment', projectId, taskId, sourcePath),
    saveAttachmentFromDataUrl: (projectId, taskId, dataUrl) =>
      ipcRenderer.invoke('tasks:saveAttachmentFromDataUrl', projectId, taskId, dataUrl),
    readAttachment: (filePath) => ipcRenderer.invoke('tasks:readAttachment', filePath),
    getDetail: (projectId, externalId) =>
      ipcRenderer.invoke('tasks:getDetail', projectId, externalId),
    addComment: (projectId, externalId, body) =>
      ipcRenderer.invoke('tasks:addComment', projectId, externalId, body),
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
    getGuestPreloadPath: (): Promise<string> =>
      ipcRenderer.invoke('passwords:getGuestPreloadPath'),
  },
};

contextBridge.exposeInMainWorld('nexus', nexusApi);

export type NexusAPI = typeof nexusApi;
