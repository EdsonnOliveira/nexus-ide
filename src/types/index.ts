import type {
  ApiHttpResponse,
  ApiProjectData,
  ApiSendRequestPayload,
  ApiTab,
} from '@/types/api';
import type { Automation } from '@/types/automation';
import type { PasswordCollection } from '@/types/password';
import type { AgentGitChangeGroup } from '@/types/agentGit';
import type { ProjectTask, TaskAttachment, TaskComment, TaskCredentialsPayload, TaskDetailData, TaskIntegrationConfig, TaskSyncResult } from '@/types/task';
import type {
  GitBranchInfo,
  GitCommandResult,
  GitDiffResult,
  GitFileDiffImageSidesResult,
  GitFileDiffSidesResult,
  GitRepoDiscovery,
  GitStatusResult,
  GitStashEntry,
} from '@/types/git';

export type {
  ProjectTask,
  TaskAttachment,
  TaskComment,
  TaskCredentialsPayload,
  TaskDetailData,
  TaskIntegrationConfig,
  TaskIntegrationPlatform,
  TaskSource,
  TaskSyncResult,
} from '@/types/task';

export type {
  GitBranchInfo,
  GitChangeEntry,
  GitChangeStatus,
  GitCommandResult,
  GitDiffResult,
  GitFileDiffImageSidesResult,
  GitFileDiffSidesResult,
  GitRepoDiscovery,
  GitRepoInfo,
  GitStatusResult,
  GitStashEntry,
} from '@/types/git';

export type { AgentGitChangeFile, AgentGitChangeGroup } from '@/types/agentGit';

export type {
  ApiAuthType,
  ApiBodyType,
  ApiCollectionFolder,
  ApiCollectionItem,
  ApiEnvironment,
  ApiHistoryEntry,
  ApiHttpResponse,
  ApiKeyValue,
  ApiProjectData,
  ApiRequest,
  ApiSendRequestPayload,
  ApiTab,
  HttpMethod,
} from '@/types/api';

export type TerminalAgent = 'cursor' | 'claude' | 'composer' | 'shell';

export type TabType = 'terminal' | 'agent' | 'browser' | 'emulator' | 'api';

export type AgentMessageRole = 'user' | 'assistant';

export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  content: string;
  createdAt: number;
  streaming?: boolean;
}

export interface AgentPromptAttachment {
  id: string;
  label: string;
  dataUrl: string;
  relativePath?: string;
}

export interface AgentUserMessage {
  id: string;
  role: 'user';
  content: string;
  createdAt: number;
  attachments?: AgentPromptAttachment[];
  mode?: 'agent' | 'plan' | 'debug' | 'multitask' | 'ask';
  agentPrompt?: string;
  skillLabel?: string;
}

export interface AgentPromptSubmitOptions {
  displayContent?: string;
  skillLabel?: string;
  forceNewTurn?: boolean;
}

export type AgentActivityKind =
  | 'thought'
  | 'status'
  | 'section'
  | 'file_edit'
  | 'file_read'
  | 'live_status'
  | 'response'
  | 'question'
  | 'plan';

export interface AgentPlanTodo {
  id: string;
  content: string;
  status?: 'pending' | 'done';
}

export type AgentPlanStatus = 'pending' | 'accepted' | 'rejected' | 'building';

export interface AgentQuestionOption {
  id: string;
  label: string;
}

export interface AgentQuestionItem {
  id: string;
  prompt: string;
  allowMultiple?: boolean;
  options?: AgentQuestionOption[];
}

export type AgentQuestionStatus = 'pending' | 'answered' | 'skipped';

export type AgentQuestionAnswers = Record<string, string | string[]>;

export interface AgentActivity {
  id: string;
  kind: AgentActivityKind;
  label: string;
  filePath?: string;
  additions?: number;
  deletions?: number;
  durationMs?: number;
  createdAt: number;
  collapsed?: boolean;
  streaming?: boolean;
  questionTitle?: string;
  questions?: AgentQuestionItem[];
  questionStatus?: AgentQuestionStatus;
  questionAnswers?: AgentQuestionAnswers;
  planName?: string;
  planOverview?: string;
  planBody?: string;
  planTodos?: AgentPlanTodo[];
  planStatus?: AgentPlanStatus;
  planUri?: string;
}

export interface AgentFollowUp {
  id: string;
  content: string;
  attachments: AgentPromptAttachment[];
  createdAt: number;
  mode?: 'agent' | 'plan' | 'debug' | 'multitask' | 'ask';
  skillLabel?: string;
  agentPrompt?: string;
}

export interface AgentTurnSummaryFileRef {
  path: string;
}

export interface AgentTurnSummaryCommandRef {
  command: string;
}

export interface AgentTurnSummary {
  editedFileCount: number;
  exploredFileCount: number;
  commandCount: number;
  additions: number;
  deletions: number;
  responseLead?: string;
  exploredFiles?: AgentTurnSummaryFileRef[];
  editedFiles?: AgentTurnSummaryFileRef[];
  commands?: AgentTurnSummaryCommandRef[];
}

export interface AgentTurn {
  id: string;
  user: AgentUserMessage;
  activities: AgentActivity[];
  running: boolean;
  startedAt: number;
  completedAt?: number;
  pendingFollowUp?: boolean;
  summary?: AgentTurnSummary;
}

export interface AgentTab {
  id: string;
  title: string;
  type: 'agent';
  cliAgent: string;
  ptyId: string | null;
  turns: AgentTurn[];
  messages?: AgentMessage[];
  restoreCommand?: string | null;
  workingDirectory?: string | null;
  pinned?: boolean;
  badgeColorIndex?: number;
}

export type EmulatorPlatform = 'android' | 'ios';

export type EmulatorSessionState = 'booting' | 'running' | 'stopped' | 'error';

export type EmulatorCaptureBackend = 'idb' | 'simctl' | 'adb';

export type EmulatorVideoCodec = 'h264' | 'jpeg' | 'png';

export interface EmulatorStreamStats {
  captureBackend: EmulatorCaptureBackend;
  targetFps: number;
  streamFps: number;
  fallbackReason?: string;
}

export interface EmulatorDevice {
  id: string;
  name: string;
  platform: EmulatorPlatform;
  subtitle: string | null;
  state: 'available' | 'booted' | 'offline';
}

export interface EmulatorPlatformSetup {
  available: boolean;
  missingTools: string[];
  installHint: string | null;
  installCommand: string | null;
}

export interface EmulatorSetupStatus {
  android: EmulatorPlatformSetup;
  ios: EmulatorPlatformSetup;
}

export interface EmulatorTab {
  id: string;
  title: string;
  type: 'emulator';
  platform: EmulatorPlatform;
  deviceId: string | null;
  sessionId: string | null;
  pinned?: boolean;
  badgeColorIndex?: number;
}

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

export type FileViewMode = 'code' | 'image' | 'pdf' | 'diff' | 'preview';

export interface FileTab {
  id: string;
  title: string;
  type: 'file';
  filePath: string;
  viewMode: FileViewMode;
  diffBefore?: string;
  diffAfter?: string;
  diffStaged?: boolean;
  diffUntracked?: boolean;
  diffRepoPath?: string;
  diffAgentPrompt?: string;
  pinned?: boolean;
  badgeColorIndex?: number;
}

export type Tab = TerminalTab | AgentTab | BrowserTab | FileTab | EmulatorTab | ApiTab;

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

export type {
  Automation,
  AutomationStep,
  AutomationStepType,
  AutomationStepOpenMode,
  AutomationTrigger,
} from '@/types/automation';

export interface Workspace {
  id: string;
  name: string;
}

export interface ProjectAgentResponseSkill {
  id: string;
  hintId: string;
  label: string;
  command: string;
}

export interface ProjectFlag {
  reason: string;
  createdAt: number;
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
  automations?: Automation[];
  passwordCollections?: PasswordCollection[];
  whatsappLink?: string | null;
  mailInbox?: MailMailboxRef | null;
  tasks?: ProjectTask[];
  taskIntegration?: TaskIntegrationConfig | null;
  agentGitGroups?: AgentGitChangeGroup[];
  agentResponseSkills?: ProjectAgentResponseSkill[];
  flag?: ProjectFlag | null;
}

export interface AppState {
  projects: Project[];
  workspaces: Workspace[];
  activeProjectId: string | null;
  activeWorkspaceId: string | null;
  sidebarVideoSession?: PersistedSidebarVideoSession | null;
  sidebarVideoLastLink?: string | null;
}

export interface PersistedSidebarVideoSession {
  sourceUrl: string;
  title: string;
  isLive?: boolean;
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
  automations?: Automation[];
  passwordCollections?: PasswordCollection[];
  whatsappLink?: string | null;
  mailInbox?: MailMailboxRef | null;
  tasks?: ProjectTask[];
  taskIntegration?: TaskIntegrationConfig | null;
  agentGitGroups?: AgentGitChangeGroup[];
  agentResponseSkills?: ProjectAgentResponseSkill[];
  flag?: ProjectFlag | null;
}

export type ProjectKind = 'web' | 'mobile' | 'api';

export interface ProjectDirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

export interface CursorAgentHistoryEntry {
  id: string;
  title: string;
  updatedAtMs: number;
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

export interface AppleMusicUpcomingTrack {
  title: string;
  artist: string;
  playlistIndex: number;
  trackId: string;
  artworkUrl: string | null;
}

export interface AppleMusicPlaylist {
  id: string;
  name: string;
  artworkUrl: string | null;
}

export interface AppleMusicNowPlaying {
  platformSupported: boolean;
  musicReady: boolean;
  available: boolean;
  title: string;
  artist: string;
  state: 'playing' | 'paused' | 'stopped';
  artworkUrl: string | null;
  positionSeconds: number;
  durationSeconds: number;
  repeatMode: 'off' | 'one' | 'all';
  shuffleEnabled: boolean;
  upcoming: AppleMusicUpcomingTrack[];
}

export interface SystemNotificationItem {
  id: string;
  appId: string;
  appLabel: string;
  title: string;
  body: string;
  deliveredAt: number;
  iconUrl: string | null;
}

export interface SystemNotificationsSnapshot {
  platformSupported: boolean;
  accessGranted: boolean;
  fullDiskAccessAppName: string | null;
  fullDiskAccessAppPath: string | null;
  items: SystemNotificationItem[];
}

export interface SystemStatusSnapshot {
  platformSupported: boolean;
  volume: number;
  muted: boolean;
  batteryLevel: number | null;
  batteryCharging: boolean;
  batteryPresent: boolean;
  batteryTimeRemaining: string | null;
  wifiConnected: boolean;
  wifiNetwork: string | null;
}

export interface WifiNetworkItem {
  ssid: string;
  connected: boolean;
  secured: boolean;
}

export interface WifiConnectResult {
  ok: boolean;
  error?: string;
  needsPassword?: boolean;
}

export interface AudioOutputDeviceItem {
  id: string;
  name: string;
  active: boolean;
  kind: 'builtin' | 'headphones' | 'tv' | 'virtual' | 'other';
}

export interface WifiPopupState {
  wifiEnabled: boolean;
  connectedNetwork: string | null;
  networks: WifiNetworkItem[];
}

export interface MailMailboxRef {
  accountName: string;
  mailboxName: string;
}

export interface MailMailboxOption {
  id: string;
  accountName: string;
  mailboxName: string;
  label: string;
}

export interface MailMessageItem {
  id: string;
  subject: string;
  sender: string;
  dateReceived: number;
  unread: boolean;
}

export interface MailInboxSnapshot {
  platformSupported: boolean;
  mailReady: boolean;
  available: boolean;
  mailboxLabel: string;
  messages: MailMessageItem[];
}

export interface CalendarEventItem {
  id: string;
  title: string;
  startAt: number;
  endAt: number;
  location: string;
  calendarName: string;
  colorHex: string;
  allDay: boolean;
  notes: string;
  url: string;
}

export interface CalendarEventsSnapshot {
  platformSupported: boolean;
  accessGranted: boolean;
  available: boolean;
  permissionDenied: boolean;
  events: CalendarEventItem[];
}

export type VercelDeploymentState =
  | 'READY'
  | 'ERROR'
  | 'BUILDING'
  | 'QUEUED'
  | 'INITIALIZING'
  | 'CANCELED'
  | 'BLOCKED';

export interface VercelActiveDeployment {
  uid: string;
  projectId: string;
  projectName: string;
  branch: string;
  commitSha: string;
  commitMessage: string;
  state: VercelDeploymentState;
  url: string | null;
  framework: string | null;
  createdAt: number;
  buildingAt: number | null;
  readyAt: number | null;
  commitUrl: string | null;
  projectAvatarUrl: string | null;
}

export interface CursorPeriodUsageSnapshot {
  available: boolean;
  percent: number;
  autoPercentUsed: number;
  apiPercentUsed: number;
  totalPercentUsed: number;
  displayMessage: string | null;
  autoModelSelectedDisplayMessage: string | null;
  namedModelSelectedDisplayMessage: string | null;
  billingCycleStartMs: number | null;
  billingCycleEndMs: number | null;
  membershipType: string | null;
  updatedAt: number;
  error: string | null;
}

export interface TerminalPasteImageSaved {
  absolutePath: string;
  relativePath: string;
  fileName: string;
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
    clearActiveProject: () => Promise<void>;
    update: (id: string, data: ProjectUpdatePayload) => Promise<Project | null>;
    saveLogo: (projectId: string, sourcePath: string) => Promise<string>;
    saveLogoFromDataUrl: (projectId: string, dataUrl: string) => Promise<string>;
    removeLogo: (logoPath: string | null) => Promise<void>;
    setSidebarVideoSession: (
      session: PersistedSidebarVideoSession | null | undefined,
    ) => Promise<void>;
    setSidebarVideoLastLink: (link: string | null) => Promise<void>;
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
    }) => Promise<void>;
    stop: (paneId: string) => void;
    isRunning: (paneId: string) => Promise<boolean>;
    onData: (
      callback: (paneId: string, data: string, runToken: string) => void,
    ) => () => void;
    onDone: (
      callback: (
        paneId: string,
        payload: { code: number; error?: string; runToken: string },
      ) => void,
    ) => () => void;
  };
  dialog: {
    openDirectory: () => Promise<string | null>;
    openImage: () => Promise<string | null>;
    openFile: () => Promise<string | null>;
  };
  tasks: {
    saveCredentials: (
      projectId: string,
      credentials: TaskCredentialsPayload,
    ) => Promise<void>;
    getCredentials: (projectId: string) => Promise<TaskCredentialsPayload>;
    clearCredentials: (projectId: string) => Promise<void>;
    openExternalUrl: (url: string) => Promise<void>;
    testConnection: (
      projectId: string,
      config: TaskIntegrationConfig,
      credentials: TaskCredentialsPayload,
    ) => Promise<void>;
    listJiraProjects: (
      projectId: string,
      config: TaskIntegrationConfig,
    ) => Promise<Array<{ id: string; key: string; name: string }>>;
    listTrelloBoards: (projectId: string) => Promise<Array<{ id: string; name: string }>>;
    listDeepcrmPipelines: (projectId: string) => Promise<Array<{ id: string; name: string }>>;
    sync: (projectId: string) => Promise<TaskSyncResult>;
    saveAttachment: (
      projectId: string,
      taskId: string,
      sourcePath: string,
    ) => Promise<TaskAttachment>;
    saveAttachmentFromDataUrl: (
      projectId: string,
      taskId: string,
      dataUrl: string,
    ) => Promise<TaskAttachment>;
    readAttachment: (filePath: string) => Promise<string>;
    getDetail: (projectId: string, externalId: string) => Promise<TaskDetailData>;
    addComment: (projectId: string, externalId: string, body: string) => Promise<TaskComment>;
  };
  passwords: {
    getValues: (projectId: string, collectionId: string) => Promise<Record<string, string>>;
    saveValues: (
      projectId: string,
      collectionId: string,
      values: Record<string, string>,
    ) => Promise<void>;
    deleteValues: (projectId: string, collectionId: string) => Promise<void>;
    getGuestPreloadPath: () => Promise<string>;
  };
  files: {
    toLocalUrl: (filePath: string) => string;
    readImageAsDataUrl: (filePath: string) => Promise<string | null>;
    saveTerminalPasteImage: (
      projectPath: string,
      paneId: string,
      imageIndex: number,
      dataUrl: string,
    ) => Promise<TerminalPasteImageSaved>;
    listChildDirectories: (dirPath: string) => Promise<string[]>;
    listDirectoryEntries: (dirPath: string) => Promise<ProjectDirectoryEntry[]>;
    resolveCdPath: (cwd: string, target: string) => Promise<string>;
    getTerminalHints: (cwd: string) => Promise<TerminalCommandHint[]>;
    getAgentSkillHints: (cwd: string) => Promise<TerminalCommandHint[]>;
    listCursorAgentHistory: (cwd: string) => Promise<CursorAgentHistoryEntry[]>;
    loadCursorAgentSessionTranscript: (cwd: string, sessionId: string) => Promise<string | null>;
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
    createEmptyFile: (
      dirPath: string,
      name: string,
    ) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
    createDirectory: (
      dirPath: string,
      name: string,
    ) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
    moveEntry: (
      sourcePath: string,
      destinationDirPath: string,
    ) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
    getPathForFile: (file: File) => string;
    importEntries: (
      destinationDirPath: string,
      sourcePaths: string[],
    ) => Promise<
      Array<
        | { ok: true; path: string; entryType?: 'file' | 'directory' }
        | { ok: false; error: string }
      >
    >;
    renameEntry: (
      entryPath: string,
      nextName: string,
    ) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
    deleteEntry: (entryPath: string) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
    revealInFolder: (entryPath: string) => Promise<void>;
    watchProject: (dirPath: string) => Promise<void>;
    unwatchProject: (dirPath: string) => Promise<void>;
    onProjectChange: (
      callback: (payload: { projectPath: string; changedPath?: string; structural?: boolean }) => void,
    ) => () => void;
  };
  browser: {
    probeUrl: (url: string) => Promise<boolean>;
    openDevTools: (guestWebContentsId: number, devtoolsWebContentsId: number) => Promise<void>;
    closeDevTools: (guestWebContentsId: number) => Promise<void>;
    captureScreenshot: (guestWebContentsId: number) => Promise<boolean>;
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
    getFileDiffSides: (
      dirPath: string,
      filePath: string,
      options: { staged: boolean; untracked?: boolean },
    ) => Promise<GitFileDiffSidesResult>;
    getFileDiffImageSides: (
      dirPath: string,
      filePath: string,
      options: { staged: boolean; untracked?: boolean },
    ) => Promise<GitFileDiffImageSidesResult>;
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
    invalidateCache: (dirPath: string) => Promise<void>;
    onRepoChange: (callback: (repoPath: string) => void) => () => void;
  };
  onToggleExplorer: (callback: () => void) => () => void;
  onOpenTabAddMenu: (callback: () => void) => () => void;
  onOpenGlobalSearch: (callback: () => void) => () => void;
  onBrowserReload: (callback: () => void) => () => void;
  onFlushSession: (callback: () => void) => () => void;
  music: {
    getNowPlaying: () => Promise<AppleMusicNowPlaying>;
    getPlaylists: () => Promise<AppleMusicPlaylist[]>;
    togglePlayback: () => Promise<void>;
    next: () => Promise<void>;
    previous: () => Promise<void>;
    seek: (seconds: number) => Promise<void>;
    cycleRepeat: () => Promise<void>;
    toggleShuffle: () => Promise<void>;
    playQueueTrack: (playlistIndex: number) => Promise<void>;
    playPlaylist: (playlistId: string) => Promise<void>;
  };
  systemNotifications: {
    list: (limit?: number) => Promise<SystemNotificationsSnapshot>;
    getAppIcon: (appId: string, appLabel?: string) => Promise<string | null>;
    delete: (id: string) => Promise<boolean>;
    deleteAll: (limit?: number) => Promise<boolean>;
    openApp: (appId: string) => Promise<void>;
    openFullDiskAccessSettings: () => Promise<void>;
    revealFullDiskAccessApp: () => Promise<void>;
  };
  systemStatus: {
    getSnapshot: () => Promise<SystemStatusSnapshot>;
    setVolume: (volume: number) => Promise<void>;
    setMuted: (muted: boolean) => Promise<void>;
    listAudioOutputDevices: () => Promise<AudioOutputDeviceItem[]>;
    setAudioOutputDevice: (deviceId: string) => Promise<boolean>;
    getWifiPower: () => Promise<boolean>;
    setWifiPower: (enabled: boolean) => Promise<void>;
    listWifiNetworks: () => Promise<WifiNetworkItem[]>;
    getWifiPopupState: () => Promise<WifiPopupState>;
    getConnectedWifiNetwork: () => Promise<string | null>;
    disconnectWifiNetwork: () => Promise<boolean>;
    connectWifiNetwork: (ssid: string, password?: string) => Promise<WifiConnectResult>;
  };
  whatsapp: {
    isDesktopInstalled: () => Promise<boolean>;
    openLink: (url: string) => Promise<void>;
  };
  mail: {
    getMailboxes: () => Promise<MailMailboxOption[]>;
    getInboxMessages: (mailbox: MailMailboxRef) => Promise<MailInboxSnapshot>;
    openMessage: (mailbox: MailMailboxRef, messageId: string) => Promise<void>;
  };
  calendar: {
    getTodayEvents: () => Promise<CalendarEventsSnapshot>;
    requestAccess: () => Promise<CalendarEventsSnapshot>;
    openEvent: (startAt: number) => Promise<void>;
    openPrivacySettings: () => Promise<void>;
  };
  vercel: {
    getTokenConfigured: () => Promise<boolean>;
    saveToken: (token: string) => Promise<boolean>;
    clearToken: () => Promise<void>;
    validateToken: (token: string) => Promise<boolean>;
    getActiveDeployment: () => Promise<VercelActiveDeployment | null>;
    listDeployments: () => Promise<VercelActiveDeployment[]>;
    getDeploymentLogs: (deploymentUid: string) => Promise<string>;
  };
  cursorUsage: {
    getCurrentPeriod: (force?: boolean) => Promise<CursorPeriodUsageSnapshot>;
  };
  emulator: {
    getSetupStatus: () => Promise<EmulatorSetupStatus>;
    listDevices: (platform: EmulatorPlatform) => Promise<EmulatorDevice[]>;
    recordDeviceUsage: (platform: EmulatorPlatform, deviceId: string) => Promise<void>;
    start: (tabId: string, platform: EmulatorPlatform, deviceId: string) => Promise<string>;
    stop: (sessionId: string) => Promise<void>;
    stopByTabId: (tabId: string) => Promise<void>;
    tap: (sessionId: string, x: number, y: number) => Promise<void>;
    swipe: (
      sessionId: string,
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      durationMs: number,
    ) => Promise<void>;
    pressHome: (sessionId: string) => Promise<void>;
    pressBack: (sessionId: string) => Promise<void>;
    rotate: (sessionId: string) => Promise<void>;
    typeText: (sessionId: string, text: string) => Promise<void>;
    screenshot: (sessionId: string) => Promise<boolean>;
    onVideoChunk: (
      callback: (payload: {
        sessionId: string;
        codec: EmulatorVideoCodec;
        chunk: Uint8Array;
        width?: number;
        height?: number;
      }) => void,
    ) => () => void;
    onSessionState: (
      callback: (payload: {
        sessionId: string;
        tabId: string;
        state: EmulatorSessionState;
        message?: string;
        captureBackend?: EmulatorCaptureBackend;
        targetFps?: number;
        streamFps?: number;
        fallbackReason?: string;
      }) => void,
    ) => () => void;
    onStreamStats: (
      callback: (payload: {
        sessionId: string;
        tabId: string;
        captureBackend: EmulatorCaptureBackend;
        targetFps: number;
        streamFps: number;
        fallbackReason?: string;
      }) => void,
    ) => () => void;
    onFrameSize: (
      callback: (payload: { sessionId: string; width: number; height: number }) => void,
    ) => () => void;
    onSessionCreated: (
      callback: (payload: { sessionId: string; tabId: string }) => void,
    ) => () => void;
  };
  api: {
    loadProjectData: (projectId: string) => Promise<ApiProjectData>;
    saveProjectData: (projectId: string, data: ApiProjectData) => Promise<void>;
    sendRequest: (payload: ApiSendRequestPayload) => Promise<ApiHttpResponse>;
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
