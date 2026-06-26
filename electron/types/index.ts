import type { AgentGitChangeGroup } from './agentGit';

export type TerminalAgent = 'cursor' | 'claude' | 'composer' | 'shell';

export type TabType = 'terminal' | 'browser' | 'emulator' | 'api';

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
} from './api';

export type {
  ProjectTask,
  TaskAttachment,
  TaskCredentialsPayload,
  TaskIntegrationConfig,
  TaskIntegrationPlatform,
  TaskSource,
} from './task';

export type { AgentGitChangeFile, AgentGitChangeGroup } from './agentGit';

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

export type Tab = TerminalTab | BrowserTab | FileTab | EmulatorTab | ApiTab;

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

export type AutomationStepType = 'terminal' | 'agent' | 'browser' | 'emulator' | 'api';
export type AutomationTrigger = 'manual' | 'interval';
export type AutomationStepOpenMode = 'separate' | 'split-with-previous';

export type AutomationHttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

export interface AutomationStep {
  id: string;
  type: AutomationStepType;
  title?: string;
  tabTitle?: string;
  pinned?: boolean;
  cwd?: string;
  command?: string;
  agentMode?: 'agent' | 'plan' | 'debug' | 'multitask' | 'ask';
  agentModel?: string;
  url?: string;
  platform?: 'android' | 'ios';
  deviceId?: string;
  autoStartEmulator?: boolean;
  method?: AutomationHttpMethod;
  headers?: string;
  body?: string;
  openMode?: AutomationStepOpenMode;
}

export interface Automation {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  intervalMinutes?: number;
  closeOpenTabsBeforeRun: boolean;
  defaultActiveStepId: string | null;
  steps: AutomationStep[];
}

export type PasswordFieldAction = 'none' | 'tab' | 'enter';

export interface PasswordField {
  id: string;
  label: string;
  action?: PasswordFieldAction;
}

export interface PasswordCollection {
  id: string;
  name: string;
  fields: PasswordField[];
  browserAutofillEnabled?: boolean;
  browserUrl?: string | null;
}

export interface Workspace {
  id: string;
  name: string;
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
  flag?: ProjectFlag | null;
}

export interface TerminalPasteImageSaved {
  absolutePath: string;
  relativePath: string;
  fileName: string;
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
