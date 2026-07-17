import type { AgentGitChangeGroup } from './agentGit';
import type { ProjectTestEntry } from './test';

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
  | 'tool_run'
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
  toolCommand?: string;
  toolOutput?: string;
  toolExitCode?: number | null;
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

export type {
  DiscoveredTestTarget,
  ProjectTestEntry,
  TestRunStep,
  TestRunnerKind,
  TestStepStatus,
} from './test';

export type { AgentGitChangeFile, AgentGitChangeGroup } from './agentGit';

export type EmulatorPlatform = 'android' | 'ios';

export type EmulatorSessionState = 'booting' | 'running' | 'stopped' | 'error';

export type EmulatorCaptureBackend = 'simulator-server' | 'idb' | 'simctl' | 'adb';

export type EmulatorVideoCodec = 'h264' | 'jpeg' | 'png';

export type EmulatorDeviceOrientation =
  | 'portrait'
  | 'landscapeLeft'
  | 'portraitUpsideDown'
  | 'landscapeRight';

export interface EmulatorStreamStats {
  captureBackend: EmulatorCaptureBackend;
  targetFps: number;
  streamFps: number;
  fallbackReason?: string;
  streamUrl?: string;
}

export interface EmulatorAttachResult {
  sessionId: string;
  state: EmulatorSessionState;
  message?: string;
  captureBackend?: EmulatorCaptureBackend;
  targetFps?: number;
  streamFps?: number;
  fallbackReason?: string;
  streamUrl?: string;
  frameWidth?: number;
  frameHeight?: number;
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

export type Tab = TerminalTab | AgentTab | BrowserTab | FileTab | EmulatorTab | ApiTab;

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

export interface ProjectFlag {
  reason: string;
  createdAt: number;
}

export interface Workspace {
  id: string;
  name: string;
  color: string;
  icon: string;
  iconCustomized: boolean;
  logo: string | null;
  flag?: ProjectFlag | null;
}

export interface WorkspaceUpdatePayload {
  name?: string;
  color?: string;
  icon?: string;
  iconCustomized?: boolean;
  logo?: string | null;
  flag?: ProjectFlag | null;
}

export interface ProjectAgentResponseSkill {
  id: string;
  hintId: string;
  label: string;
  command: string;
}

export interface ProjectTerminalQuickCommand {
  id: string;
  label: string;
  command: string;
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
  testEntries?: ProjectTestEntry[];
  agentGitGroups?: AgentGitChangeGroup[];
  agentResponseSkills?: ProjectAgentResponseSkill[];
  terminalQuickCommands?: ProjectTerminalQuickCommand[];
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
  testEntries?: ProjectTestEntry[];
  agentGitGroups?: AgentGitChangeGroup[];
  agentResponseSkills?: ProjectAgentResponseSkill[];
  terminalQuickCommands?: ProjectTerminalQuickCommand[];
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

export interface MailMailboxesSnapshot {
  platformSupported: boolean;
  accessGranted: boolean;
  options: MailMailboxOption[];
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
  accessGranted: boolean;
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

export type MacParakeetSourceType = 'interview' | 'regular_call';

export interface MacParakeetTranscriptionItem {
  id: string;
  createdAt: number;
  title: string;
  snippet: string;
  durationMs: number | null;
  sourceType: MacParakeetSourceType;
  channelName: string | null;
  isFavorite: boolean;
  isLive: boolean;
}

export interface MacParakeetTranscriptionsSnapshot {
  platformSupported: boolean;
  installed: boolean;
  available: boolean;
  transcriptions: MacParakeetTranscriptionItem[];
}

export interface MacParakeetTranscriptionDetail extends MacParakeetTranscriptionItem {
  transcript: string;
  conclusion: string | null;
  sourceUrl: string | null;
  segments: MacParakeetTranscriptSegment[];
}

export type MacParakeetTranscriptSegmentKind = 'speech' | 'qa';

export interface MacParakeetTranscriptSegment {
  id: string;
  kind: MacParakeetTranscriptSegmentKind;
  createdAt: number;
  isSelf: boolean;
  speakerLabel: string | null;
  content: string;
  question: string | null;
  answer: string | null;
  isQuestion: boolean;
}

export type MacParakeetStartCallResult =
  | { ok: true; callSessionId: string; title: string }
  | {
      ok: false;
      reason: 'unsupported' | 'not_installed' | 'unauthorized' | 'invalid_title' | 'create_failed';
    };

export type MacParakeetTranslateConclusionResult =
  | { ok: true; conclusion: string }
  | { ok: false; reason: 'not_found' | 'empty' | 'unauthorized' | 'failed' };
