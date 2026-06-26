import type { ApiRequest, HttpMethod } from '@/types/api';
import type { AutomationStepType } from '@/types/automation';
import type { EmulatorPlatform } from '@/types';
import type { GitChangeStatus } from '@/types/git';

export const GLOBAL_SEARCH_MAX_RESULTS = 8;

export const GLOBAL_SEARCH_MAX_FILES_PER_PROJECT = 5;

export const GLOBAL_SEARCH_OTHER_PROJECTS_LABEL = 'Outros projetos';

export const GLOBAL_SEARCH_INITIAL_SUGGESTIONS_LABEL = 'Sugestões';

export type GlobalSearchResultKind =
  | 'project'
  | 'tab'
  | 'file'
  | 'git'
  | 'task'
  | 'form'
  | 'automation'
  | 'music-track'
  | 'music-playlist'
  | 'emulator'
  | 'api-route'
  | 'slash-command'
  | 'agent-target'
  | 'terminal-target'
  | 'task-target'
  | 'form-target'
  | 'automation-target'
  | 'file-target'
  | 'agent-session'
  | 'separator';

export type SlashCommandId =
  | 'project'
  | 'tab'
  | 'file'
  | 'git'
  | 'task'
  | 'form'
  | 'automation'
  | 'agent'
  | 'terminal'
  | 'browser'
  | 'emulator'
  | 'api'
  | 'music';

export type SlashCommandPhase = 'none' | 'command' | 'project' | 'entity' | 'payload';

export interface SlashCommandMeta {
  id: SlashCommandId;
  badge: string;
  placeholder: string;
  requiresProject: boolean;
  hasEntityList: boolean;
  isFreeTextPayload: boolean;
}

export interface SlashCommandQuery {
  command: SlashCommandId;
  requiresProject: boolean;
  projectToken: string | null;
  projectId: string | null;
  filterText: string;
  payload: string;
  isCurlPayload: boolean;
  phase: SlashCommandPhase;
}

export interface ParsedGlobalSearchQuery {
  input: string;
  mode: 'free' | 'slash';
  freeText: string;
  slash: SlashCommandQuery | null;
  suggestedCommands: SlashCommandId[];
}

export interface GlobalSearchProjectPayload {
  projectId: string;
  logo: string | null;
  icon: string;
  color: string;
}

export interface GlobalSearchTabPayload {
  projectId: string;
  paneId: string;
  tabBarId: string;
}

export interface GlobalSearchFilePayload {
  projectId: string;
  absolutePath: string;
  relativePath: string;
}

export interface GlobalSearchGitPayload {
  projectId: string;
  path: string;
  repoPath: string;
  staged: boolean;
  untracked: boolean;
  status: GitChangeStatus;
}

export interface GlobalSearchTaskPayload {
  projectId: string;
  taskId: string;
}

export interface GlobalSearchFormPayload {
  projectId: string;
  collectionId: string;
}

export interface GlobalSearchAutomationPayload {
  projectId: string;
  automationId: string;
  stepTypes: AutomationStepType[];
}

export interface GlobalSearchMusicTrackPayload {
  source: 'now-playing' | 'queue';
  trackId: string;
  playlistIndex: number;
}

export interface GlobalSearchMusicPlaylistPayload {
  playlistId: string;
}

export interface GlobalSearchEmulatorPayload {
  projectId: string;
  platform: EmulatorPlatform;
  deviceId: string;
}

export interface GlobalSearchApiRoutePayload {
  projectId: string;
  request: ApiRequest;
  source: 'collection' | 'history';
  collectionId: string | null;
  responseStatus?: number;
}

export interface GlobalSearchSlashCommandPayload {
  command: SlashCommandId;
}

export interface GlobalSearchAgentTargetPayload {
  projectId: string;
  paneId: string | null;
  createNew: boolean;
}

export interface GlobalSearchTerminalTargetPayload {
  projectId: string;
  paneId: string | null;
  createNew: boolean;
}

export interface GlobalSearchTaskTargetPayload {
  projectId: string;
  createNew: boolean;
}

export interface GlobalSearchFormTargetPayload {
  projectId: string;
  createNew: boolean;
}

export interface GlobalSearchAutomationTargetPayload {
  projectId: string;
  createNew: boolean;
}

export interface GlobalSearchFileTargetPayload {
  projectId: string;
  createNew: boolean;
}

export interface GlobalSearchAgentSessionPayload {
  projectId: string;
  paneId: string;
  tabBarId: string;
  lastPrompt: string;
}

export type GlobalSearchResultPayload =
  | GlobalSearchProjectPayload
  | GlobalSearchTabPayload
  | GlobalSearchFilePayload
  | GlobalSearchGitPayload
  | GlobalSearchTaskPayload
  | GlobalSearchFormPayload
  | GlobalSearchAutomationPayload
  | GlobalSearchMusicTrackPayload
  | GlobalSearchMusicPlaylistPayload
  | GlobalSearchEmulatorPayload
  | GlobalSearchApiRoutePayload
  | GlobalSearchSlashCommandPayload
  | GlobalSearchAgentTargetPayload
  | GlobalSearchTerminalTargetPayload
  | GlobalSearchTaskTargetPayload
  | GlobalSearchFormTargetPayload
  | GlobalSearchAutomationTargetPayload
  | GlobalSearchFileTargetPayload
  | GlobalSearchAgentSessionPayload;

export interface GlobalSearchResult {
  id: string;
  kind: GlobalSearchResultKind;
  title: string;
  subtitle?: string;
  projectId?: string;
  badge?: string;
  badgeColor?: string;
  iconUrl?: string | null;
  payload: GlobalSearchResultPayload;
}

export interface GlobalSearchResultGroup {
  id: string;
  kind: 'results' | 'separator';
  label?: string;
  projectId?: string;
  items: GlobalSearchResult[];
}

export interface GlobalSearchGroupedResults {
  groups: GlobalSearchResultGroup[];
}

export interface GlobalSearchApiRouteMatch {
  request: ApiRequest;
  source: 'collection' | 'history';
  collectionLabel: string;
  responseStatus?: number;
  method: HttpMethod;
}
