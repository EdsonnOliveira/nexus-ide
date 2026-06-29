import type {
  ApiCollectionFolder,
  ApiProjectData,
  ApiRequest,
} from '@/types/api';
import type { Automation } from '@/types/automation';
import type { EmulatorDevice, EmulatorPlatform, FileTab, Project, Tab, TerminalTab } from '@/types';
import { extractCliAgentCommand } from '@/constants/cliAgentCommands';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import type { ProjectTask } from '@/types/task';
import { EMPTY_TASK_FILTERS, filterProjectTasks } from '@/utils/taskFilters';
import { buildFlatChanges } from '@/utils/gitFlatChanges';
import { summarizeAutomationSteps, formatAutomationTrigger } from '@/utils/automationLabels';
import {
  collectProjectPanes,
  findSplitTabByPaneId,
} from '@/utils/tabGroups';
import { resolveTabBadgeColor } from '@/utils/tabBadge';
import { toProjectRelativePath } from '@/utils/explorerRelativePath';
import {
  DEFAULT_EXPLORER_SEARCH_OPTIONS,
  type ExplorerSearchNode,
} from '@/utils/explorerSearch';
import { getActiveTerminalCwd, resolveActiveGitRepo } from '@/utils/gitRepoSelection';
import { summarizePasswordCollectionMeta } from '@/utils/passwordLabels';
import type {
  GlobalSearchGroupedResults,
  GlobalSearchResult,
  GlobalSearchResultGroup,
  GlobalSearchApiRouteMatch,
  SlashCommandId,
  SlashCommandQuery,
} from '@/utils/globalSearchTypes';
import { findMatchingSlashCommands, getSlashCommandMeta } from '@/utils/globalSearchQuery';
import { collectOpenAgentPanes, collectOpenTerminalPanes } from '@/utils/collectOpenAgentPanes';
import {
  GLOBAL_SEARCH_MAX_FILES_PER_PROJECT,
  GLOBAL_SEARCH_MAX_RESULTS,
  GLOBAL_SEARCH_OTHER_PROJECTS_LABEL,
} from '@/utils/globalSearchTypes';

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function matchesQuery(values: Array<string | null | undefined>, query: string): boolean {
  const normalizedQuery = normalizeQuery(query);

  if (!normalizedQuery) {
    return true;
  }

  const haystack = values
    .map((value) => value?.trim() ?? '')
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

function limitResults<T>(items: T[], limit = GLOBAL_SEARCH_MAX_RESULTS): T[] {
  return items.slice(0, limit);
}

function resolveTabBarId(project: Project, paneId: string): string {
  const splitTab = findSplitTabByPaneId(project.tabs, paneId);
  return splitTab?.id ?? paneId;
}

function getTabTypeLabel(type: Tab['type']): string {
  if (type === 'terminal') {
    return 'Terminal';
  }

  if (type === 'browser') {
    return 'Navegador';
  }

  if (type === 'file') {
    return 'Arquivo';
  }

  if (type === 'api') {
    return 'API';
  }

  return 'Emulador';
}

function formatGitChangeSubtitle(change: { staged: boolean; status: string }): string {
  if (change.status === 'untracked') {
    return 'Git · untracked';
  }

  if (change.staged) {
    return 'Git · staged';
  }

  return 'Git · unstaged';
}

function formatGitStatusBadge(status: string): string {
  if (status === 'added') {
    return 'A';
  }

  if (status === 'deleted') {
    return 'D';
  }

  if (status === 'untracked') {
    return 'U';
  }

  return 'M';
}

async function resolveDefaultEmulatorPlatform(projectPath: string): Promise<EmulatorPlatform> {
  if (typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent)) {
    try {
      const kinds = await window.nexus.files.detectProjectKinds([projectPath]);

      if (kinds[projectPath] === 'mobile') {
        return 'ios';
      }
    } catch {
      return 'android';
    }
  }

  return 'android';
}

function parseEmulatorFilter(
  filterText: string,
  defaultPlatform: EmulatorPlatform,
): { platform: EmulatorPlatform; query: string } {
  const trimmed = filterText.trim().toLowerCase();

  if (trimmed.startsWith('android')) {
    return {
      platform: 'android',
      query: filterText.trim().slice('android'.length).trim(),
    };
  }

  if (trimmed.startsWith('ios')) {
    return {
      platform: 'ios',
      query: filterText.trim().slice('ios'.length).trim(),
    };
  }

  return {
    platform: defaultPlatform,
    query: filterText.trim(),
  };
}

function flattenFileSearchNodes(nodes: ExplorerSearchNode[], limit: number): ExplorerSearchNode[] {
  const results: ExplorerSearchNode[] = [];

  const walk = (entries: ExplorerSearchNode[]) => {
    for (const entry of entries) {
      if (results.length >= limit) {
        return;
      }

      if (entry.type === 'file') {
        results.push(entry);
      }

      if (entry.children) {
        walk(entry.children);
      }
    }
  };

  walk(nodes);
  return results;
}

function flattenApiCollectionRoutes(
  folders: ApiCollectionFolder[],
  parentPath: string[] = [],
): GlobalSearchApiRouteMatch[] {
  const routes: GlobalSearchApiRouteMatch[] = [];

  for (const folder of folders) {
    const folderPath = [...parentPath, folder.name];

    for (const item of folder.items) {
      routes.push({
        request: item.request,
        source: 'collection',
        collectionLabel: folderPath.join(' · '),
        method: item.request.method,
      });
    }

    routes.push(...flattenApiCollectionRoutes(folder.folders, folderPath));
  }

  return routes;
}

function flattenApiProjectRoutes(data: ApiProjectData): GlobalSearchApiRouteMatch[] {
  const routes = flattenApiCollectionRoutes(data.collections);

  for (const entry of data.history.slice(0, 50)) {
    routes.push({
      request: entry.request,
      source: 'history',
      collectionLabel: 'Histórico',
      responseStatus: entry.response.status,
      method: entry.request.method,
    });
  }

  return routes;
}

function buildApiRouteTitle(route: GlobalSearchApiRouteMatch): string {
  const url = route.request.url.trim() || route.request.name.trim() || 'Request';
  return `${route.method} ${url}`;
}

function buildApiRouteSubtitle(route: GlobalSearchApiRouteMatch): string {
  if (route.source === 'history') {
    return `Histórico · ${route.responseStatus ?? '—'}`;
  }

  return route.collectionLabel;
}

function buildTaskSubtitle(task: ProjectTask): string {
  const externalId = task.externalId?.trim();

  if (externalId) {
    return `Task · ${externalId}`;
  }

  return 'Task';
}

function buildAutomationSubtitle(automation: Automation): string {
  return `${formatAutomationTrigger(automation.trigger, automation.intervalMinutes)} · Automation`;
}

export function searchProjects(
  projects: Project[],
  query: string,
  activeProjectId: string | null = null,
): GlobalSearchResult[] {
  const filtered = projects.filter((project) => matchesQuery([project.name], query));

  filtered.sort((left, right) => {
    if (left.id === activeProjectId) {
      return -1;
    }

    if (right.id === activeProjectId) {
      return 1;
    }

    return left.name.localeCompare(right.name, 'pt-BR');
  });

  return limitResults(
    filtered.map((project) => ({
      id: `project:${project.id}`,
      kind: 'project' as const,
      title: project.name,
      subtitle: project.path,
      projectId: project.id,
      badgeColor: project.color,
      payload: {
        projectId: project.id,
        logo: project.logo,
        icon: project.icon,
        color: project.color,
      },
    })),
  );
}

export function searchTabs(project: Project, query: string): GlobalSearchResult[] {
  const panes = collectProjectPanes(project.tabs);

  const filtered = panes.filter((pane) =>
    matchesQuery([pane.title, pane.type, getTabTypeLabel(pane.type)], query),
  );

  return limitResults(
    filtered.map((pane, index) => ({
      id: `tab:${project.id}:${pane.id}`,
      kind: 'tab' as const,
      title: pane.title,
      subtitle: getTabTypeLabel(pane.type),
      projectId: project.id,
      badge: String(index + 1),
      badgeColor: resolveTabBadgeColor(pane, index),
      payload: {
        projectId: project.id,
        paneId: pane.id,
        tabBarId: resolveTabBarId(project, pane.id),
      },
    })),
  );
}

export async function searchFiles(
  project: Project,
  query: string,
  signal?: AbortSignal,
): Promise<GlobalSearchResult[]> {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return [];
  }

  if (signal?.aborted) {
    return [];
  }

  const nodes = await window.nexus.files.searchProjectTree(
    project.path,
    normalizedQuery,
    DEFAULT_EXPLORER_SEARCH_OPTIONS,
  );

  if (signal?.aborted) {
    return [];
  }

  const files = flattenFileSearchNodes(
    nodes as ExplorerSearchNode[],
    GLOBAL_SEARCH_MAX_FILES_PER_PROJECT,
  );

  return files.map((file) => {
    const relativePath = toProjectRelativePath(project.path, file.path);

    return {
      id: `file:${project.id}:${file.path}`,
      kind: 'file' as const,
      title: relativePath,
      subtitle: 'Arquivo',
      projectId: project.id,
      payload: {
        projectId: project.id,
        absolutePath: file.path,
        relativePath,
      },
    };
  });
}

export async function searchGitChanges(
  project: Project,
  query: string,
): Promise<GlobalSearchResult[]> {
  const repos = await window.nexus.git.discoverRepos(project.path);

  if (repos.length === 0) {
    return [];
  }

  const activeRepo = resolveActiveGitRepo(repos, getActiveTerminalCwd(project));

  if (!activeRepo) {
    return [];
  }

  const status = await window.nexus.git.getStatus(activeRepo.path);
  const changes = buildFlatChanges(status).filter((change) =>
    matchesQuery([change.path], query),
  );

  return limitResults(
    changes.map((change) => ({
      id: `git:${project.id}:${change.path}:${change.staged ? 'staged' : 'unstaged'}:${change.status}`,
      kind: 'git' as const,
      title: change.path,
      subtitle: formatGitChangeSubtitle(change),
      projectId: project.id,
      badge: formatGitStatusBadge(change.status),
      payload: {
        projectId: project.id,
        path: change.path,
        repoPath: activeRepo.path,
        staged: change.staged,
        untracked: change.status === 'untracked',
        status: change.status,
      },
    })),
  );
}

export function searchTasks(project: Project, query: string): GlobalSearchResult[] {
  const tasks = filterProjectTasks(project.tasks ?? [], query, EMPTY_TASK_FILTERS);

  return limitResults(
    tasks.map((task) => ({
      id: `task:${project.id}:${task.id}`,
      kind: 'task' as const,
      title: task.title,
      subtitle: buildTaskSubtitle(task),
      projectId: project.id,
      payload: {
        projectId: project.id,
        taskId: task.id,
      },
    })),
  );
}

export function searchForms(project: Project, query: string): GlobalSearchResult[] {
  const collections = (project.passwordCollections ?? []).filter((collection) =>
    matchesQuery(
      [
        collection.name,
        ...collection.fields.map((field) => field.label),
        summarizePasswordCollectionMeta(collection),
        'formulário',
      ],
      query,
    ),
  );

  return limitResults(
    collections.map((collection) => ({
      id: `form:${project.id}:${collection.id}`,
      kind: 'form' as const,
      title: collection.name,
      subtitle: summarizePasswordCollectionMeta(collection),
      projectId: project.id,
      payload: {
        projectId: project.id,
        collectionId: collection.id,
      },
    })),
  );
}

export function searchAutomations(project: Project, query: string): GlobalSearchResult[] {
  const automations = (project.automations ?? []).filter((automation) =>
    matchesQuery(
      [automation.name, formatAutomationTrigger(automation.trigger, automation.intervalMinutes)],
      query,
    ),
  );

  return limitResults(
    automations.map((automation) => ({
      id: `automation:${project.id}:${automation.id}`,
      kind: 'automation' as const,
      title: automation.name,
      subtitle: buildAutomationSubtitle(automation),
      projectId: project.id,
      payload: {
        projectId: project.id,
        automationId: automation.id,
        stepTypes: automation.steps.map((step) => step.type),
      },
    })),
  );
}

export async function searchMusic(query: string): Promise<GlobalSearchResult[]> {
  const [nowPlaying, playlists] = await Promise.all([
    window.nexus.music.getNowPlaying(),
    window.nexus.music.getPlaylists(),
  ]);

  if (!nowPlaying.platformSupported || !nowPlaying.musicReady) {
    return [];
  }

  const results: GlobalSearchResult[] = [];

  if (
    nowPlaying.available &&
    matchesQuery([nowPlaying.title, nowPlaying.artist, 'now playing'], query)
  ) {
    results.push({
      id: `music-track:now-playing:${nowPlaying.title}`,
      kind: 'music-track',
      title: nowPlaying.title,
      subtitle: nowPlaying.artist || 'Tocando agora',
      iconUrl: nowPlaying.artworkUrl,
      payload: {
        source: 'now-playing',
        trackId: nowPlaying.title,
        playlistIndex: 0,
      },
    });
  }

  for (const track of nowPlaying.upcoming) {
    if (!matchesQuery([track.title, track.artist], query)) {
      continue;
    }

    results.push({
      id: `music-track:queue:${track.trackId}:${track.playlistIndex}`,
      kind: 'music-track',
      title: track.title,
      subtitle: track.artist,
      iconUrl: track.artworkUrl,
      payload: {
        source: 'queue',
        trackId: track.trackId,
        playlistIndex: track.playlistIndex,
      },
    });

    if (results.length >= GLOBAL_SEARCH_MAX_RESULTS) {
      return results;
    }
  }

  for (const playlist of playlists) {
    if (!matchesQuery([playlist.name, 'playlist'], query)) {
      continue;
    }

    results.push({
      id: `music-playlist:${playlist.id}`,
      kind: 'music-playlist',
      title: playlist.name,
      subtitle: 'Playlist',
      iconUrl: playlist.artworkUrl,
      payload: {
        playlistId: playlist.id,
      },
    });

    if (results.length >= GLOBAL_SEARCH_MAX_RESULTS) {
      return results;
    }
  }

  return limitResults(results);
}

export async function searchEmulatorDevices(
  project: Project,
  filterText: string,
): Promise<GlobalSearchResult[]> {
  const defaultPlatform = await resolveDefaultEmulatorPlatform(project.path);
  const parsedFilter = parseEmulatorFilter(filterText, defaultPlatform);
  const devices = await window.nexus.emulator.listDevices(parsedFilter.platform);

  const filtered = devices.filter((device) =>
    matchesQuery([device.name, device.subtitle, device.platform], parsedFilter.query),
  );

  return limitResults(
    filtered.map((device) => buildEmulatorResult(project.id, device)),
  );
}

function buildEmulatorResult(projectId: string, device: EmulatorDevice): GlobalSearchResult {
  const platformLabel = device.platform === 'android' ? 'Android' : 'iOS';
  const subtitle = device.subtitle ? `${platformLabel} · ${device.subtitle}` : platformLabel;

  return {
    id: `emulator:${projectId}:${device.platform}:${device.id}`,
    kind: 'emulator',
    title: device.name,
    subtitle,
    projectId,
    payload: {
      projectId,
      platform: device.platform,
      deviceId: device.id,
    },
  };
}

export async function searchApiRoutes(
  projectId: string,
  query: string,
): Promise<GlobalSearchResult[]> {
  const data = await window.nexus.api.loadProjectData(projectId);
  const routes = flattenApiProjectRoutes(data).filter((route) =>
    matchesQuery(
      [route.request.name, route.request.url, route.method, route.collectionLabel],
      query,
    ),
  );

  return limitResults(
    routes.map((route) => ({
      id: `api-route:${projectId}:${route.source}:${route.request.id}`,
      kind: 'api-route' as const,
      title: buildApiRouteTitle(route),
      subtitle: buildApiRouteSubtitle(route),
      projectId,
      payload: {
        projectId,
        request: route.request,
        source: route.source,
        collectionId: route.source === 'collection' ? route.request.id : null,
        responseStatus: route.responseStatus,
      },
    })),
  );
}

function truncateSuggestionText(text: string, maxLength = 72): string {
  const trimmed = text.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function resolveAgentPreviousPrompt(
  pane: Tab,
  lastRestartCommands: Record<string, string>,
): string | null {
  if (pane.type === 'agent') {
    const turns = pane.turns ?? [];
    const lastUser = turns[turns.length - 1]?.user.content.trim();

    return lastUser || null;
  }

  if (pane.type !== 'terminal') {
    return null;
  }

  const lastCommand = pane.lastCommand?.trim() || lastRestartCommands[pane.id]?.trim() || '';

  if (!lastCommand || extractCliAgentCommand(lastCommand)) {
    return null;
  }

  return lastCommand;
}

function buildAgentSessionSuggestions(project: Project): GlobalSearchResult[] {
  const lastRestartCommands = useTerminalSessionStore.getState().lastRestartCommands;
  const openAgents = collectOpenAgentPanes(project);
  const results: GlobalSearchResult[] = [];

  for (const entry of openAgents) {
    const lastPrompt = resolveAgentPreviousPrompt(entry.pane, lastRestartCommands);

    results.push({
      id: `agent-session:${project.id}:${entry.pane.id}`,
      kind: 'agent-session',
      title: entry.paneTitle,
      subtitle: lastPrompt ? truncateSuggestionText(lastPrompt) : 'Agent aberto',
      projectId: project.id,
      badge: String(entry.badgeIndex),
      badgeColor: entry.badgeColor,
      payload: {
        projectId: project.id,
        paneId: entry.pane.id,
        tabBarId: resolveTabBarId(project, entry.pane.id),
        lastPrompt: lastPrompt ?? '',
      },
    });
  }

  results.sort((left, right) => {
    const leftHasPrompt = left.subtitle !== 'Agent aberto';
    const rightHasPrompt = right.subtitle !== 'Agent aberto';

    if (leftHasPrompt === rightHasPrompt) {
      return 0;
    }

    return leftHasPrompt ? -1 : 1;
  });

  return results;
}

const INITIAL_SUGGESTIONS_LIMIT = 4;

function buildSingleSlashCommandResult(command: SlashCommandId): GlobalSearchResult {
  return buildSlashCommandResults([command])[0];
}

function buildOpenFileSuggestions(project: Project): GlobalSearchResult[] {
  const panes = collectProjectPanes(project.tabs).filter(
    (pane): pane is FileTab => pane.type === 'file',
  );

  return panes.map((pane) => {
    const relativePath = toProjectRelativePath(project.path, pane.filePath);

    return {
      id: `file:${project.id}:${pane.filePath}`,
      kind: 'file' as const,
      title: relativePath,
      subtitle: 'Arquivo',
      projectId: project.id,
      payload: {
        projectId: project.id,
        absolutePath: pane.filePath,
        relativePath,
      },
    };
  });
}

function buildOpenTerminalSuggestions(project: Project): GlobalSearchResult[] {
  return collectOpenTerminalPanes(project).map((entry) => ({
    id: `tab:${project.id}:${entry.pane.id}`,
    kind: 'tab' as const,
    title: entry.paneTitle,
    subtitle: 'Terminal',
    projectId: project.id,
    badge: String(entry.badgeIndex),
    badgeColor: entry.badgeColor,
    payload: {
      projectId: project.id,
      paneId: entry.pane.id,
      tabBarId: resolveTabBarId(project, entry.pane.id),
    },
  }));
}

function searchAgentSessions(project: Project, query: string): GlobalSearchResult[] {
  return limitResults(
    buildAgentSessionSuggestions(project).filter((item) =>
      matchesQuery([item.title, item.subtitle], query),
    ),
  );
}

function searchOpenTerminals(project: Project, query: string): GlobalSearchResult[] {
  return limitResults(
    buildOpenTerminalSuggestions(project).filter((item) =>
      matchesQuery([item.title, item.subtitle], query),
    ),
  );
}

async function searchFileCategoryResults(
  project: Project,
  query: string,
  signal?: AbortSignal,
): Promise<GlobalSearchResult[]> {
  const openMatches = buildOpenFileSuggestions(project).filter((item) =>
    matchesQuery([item.title], query),
  );

  if (signal?.aborted) {
    return openMatches;
  }

  const filesystemMatches = await searchFiles(project, query, signal);

  if (signal?.aborted) {
    return openMatches;
  }

  const seenPaths = new Set(
    openMatches.map((item) => (item.payload as { absolutePath: string }).absolutePath),
  );
  const merged = [...openMatches];

  for (const item of filesystemMatches) {
    const absolutePath = (item.payload as { absolutePath: string }).absolutePath;

    if (seenPaths.has(absolutePath)) {
      continue;
    }

    seenPaths.add(absolutePath);
    merged.push(item);
  }

  return limitResults(merged, GLOBAL_SEARCH_MAX_RESULTS);
}

function scheduleSearchUiYield(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

interface FreeTextSearchCategory {
  id: string;
  label: string;
  search: (
    project: Project,
    query: string,
    signal?: AbortSignal,
  ) => GlobalSearchResult[] | Promise<GlobalSearchResult[]>;
}

const FREE_TEXT_SEARCH_CATEGORIES: FreeTextSearchCategory[] = [
  {
    id: 'search-automations',
    label: 'Automações',
    search: (project, query) => searchAutomations(project, query),
  },
  {
    id: 'search-tasks',
    label: 'Tarefas',
    search: (project, query) => searchTasks(project, query),
  },
  {
    id: 'search-forms',
    label: 'Formulário',
    search: (project, query) => searchForms(project, query),
  },
  {
    id: 'search-agents',
    label: 'Agents',
    search: (project, query) => searchAgentSessions(project, query),
  },
  {
    id: 'search-files',
    label: 'Arquivos',
    search: (project, query, signal) => searchFileCategoryResults(project, query, signal),
  },
  {
    id: 'search-terminals',
    label: 'Terminais',
    search: (project, query) => searchOpenTerminals(project, query),
  },
];

function pushSearchCategoryGroup(
  groups: GlobalSearchResultGroup[],
  category: FreeTextSearchCategory,
  items: GlobalSearchResult[],
  projectId: string,
): void {
  if (items.length === 0) {
    return;
  }

  groups.push({
    id: category.id,
    kind: 'results',
    label: category.label,
    projectId,
    items,
  });
}

export async function searchAllProgressive(
  query: string,
  projects: Project[],
  activeProjectId: string | null,
  onUpdate: (groups: GlobalSearchResultGroup[]) => void,
  signal?: AbortSignal,
): Promise<void> {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    onUpdate([]);
    return;
  }

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const groups: GlobalSearchResultGroup[] = [];
  const slashCommandMatches = findMatchingSlashCommands(normalizedQuery);

  if (slashCommandMatches.length > 0) {
    groups.push({
      id: 'commands',
      kind: 'results',
      items: buildSlashCommandResults(slashCommandMatches),
    });
    onUpdate([...groups]);
  }

  const activeProjectMatches = activeProject
    ? searchProjects([activeProject], normalizedQuery, activeProjectId)
    : [];

  if (activeProject && activeProjectMatches.length > 0) {
    groups.push({
      id: 'active-project',
      kind: 'results',
      label: activeProject.name,
      projectId: activeProject.id,
      items: activeProjectMatches,
    });
    onUpdate([...groups]);
  }

  if (activeProject) {
    for (const category of FREE_TEXT_SEARCH_CATEGORIES) {
      if (signal?.aborted) {
        return;
      }

      const items = await Promise.resolve(
        category.search(activeProject, normalizedQuery, signal),
      );

      if (signal?.aborted) {
        return;
      }

      pushSearchCategoryGroup(groups, category, items, activeProject.id);
      onUpdate([...groups]);
      await scheduleSearchUiYield();
    }

    if (!signal?.aborted) {
      const gitChanges = await searchGitChanges(activeProject, normalizedQuery);

      if (!signal?.aborted && gitChanges.length > 0) {
        groups.push({
          id: 'search-git',
          kind: 'results',
          label: 'Git',
          projectId: activeProject.id,
          items: gitChanges,
        });
        onUpdate([...groups]);
      }
    }
  }

  if (!signal?.aborted) {
    const musicResults = await searchMusic(normalizedQuery);

    if (!signal?.aborted && musicResults.length > 0) {
      groups.push({
        id: 'search-music',
        kind: 'results',
        label: 'Música',
        items: musicResults,
      });
      onUpdate([...groups]);
    }
  }

  const otherProjectMatches = searchProjects(
    projects.filter((project) => project.id !== activeProjectId),
    normalizedQuery,
    activeProjectId,
  );

  if (!signal?.aborted && otherProjectMatches.length > 0) {
    if (groups.length > 0) {
      groups.push({
        id: 'separator',
        kind: 'separator',
        items: [],
      });
    }

    groups.push({
      id: 'others',
      kind: 'results',
      label: GLOBAL_SEARCH_OTHER_PROJECTS_LABEL,
      items: otherProjectMatches,
    });
    onUpdate([...groups]);
  }
}

function buildInitialCategoryGroup(
  id: string,
  label: string,
  command: SlashCommandId,
  suggestions: GlobalSearchResult[],
  projectId: string | null,
): GlobalSearchResultGroup {
  return {
    id,
    kind: 'results',
    label,
    projectId: projectId ?? undefined,
    items: [
      buildSingleSlashCommandResult(command),
      ...limitResults(suggestions, INITIAL_SUGGESTIONS_LIMIT),
    ],
  };
}

export function buildInitialSearchSuggestions(
  projects: Project[],
  activeProjectId: string | null,
): GlobalSearchGroupedResults {
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const projectId = activeProject?.id ?? null;

  const categories: Array<{
    id: string;
    label: string;
    command: SlashCommandId;
    suggestions: GlobalSearchResult[];
  }> = [
    {
      id: 'initial-automations',
      label: 'Automações',
      command: 'automation',
      suggestions: activeProject ? searchAutomations(activeProject, '') : [],
    },
    {
      id: 'initial-tasks',
      label: 'Tarefas',
      command: 'task',
      suggestions: activeProject ? searchTasks(activeProject, '') : [],
    },
    {
      id: 'initial-forms',
      label: 'Formulário',
      command: 'form',
      suggestions: activeProject ? searchForms(activeProject, '') : [],
    },
    {
      id: 'initial-agents',
      label: 'Agents',
      command: 'agent',
      suggestions: activeProject ? buildAgentSessionSuggestions(activeProject) : [],
    },
    {
      id: 'initial-files',
      label: 'Arquivos',
      command: 'file',
      suggestions: activeProject ? buildOpenFileSuggestions(activeProject) : [],
    },
    {
      id: 'initial-terminals',
      label: 'Terminais',
      command: 'terminal',
      suggestions: activeProject ? buildOpenTerminalSuggestions(activeProject) : [],
    },
  ];

  return {
    groups: categories.map((category) =>
      buildInitialCategoryGroup(
        category.id,
        category.label,
        category.command,
        category.suggestions,
        projectId,
      ),
    ),
  };
}

export async function searchAll(
  query: string,
  projects: Project[],
  activeProjectId: string | null,
  signal?: AbortSignal,
): Promise<GlobalSearchGroupedResults> {
  let finalGroups: GlobalSearchResultGroup[] = [];

  await searchAllProgressive(
    query,
    projects,
    activeProjectId,
    (groups) => {
      finalGroups = groups;
    },
    signal,
  );

  return { groups: finalGroups };
}

function buildSlashCommandResults(commands: SlashCommandId[]): GlobalSearchResult[] {
  return commands.map((command) => {
    const meta = getSlashCommandMeta(command);

    return {
      id: `slash-command:${command}`,
      kind: 'slash-command' as const,
      title: `/${command}`,
      subtitle: meta.placeholder,
      badge: meta.badge,
      payload: { command },
    };
  });
}

function buildAgentTargetResults(project: Project): GlobalSearchResult[] {
  const openAgents = collectOpenAgentPanes(project);
  const results: GlobalSearchResult[] = [
    {
      id: `agent-target:new:${project.id}`,
      kind: 'agent-target',
      title: 'Novo Agent',
      subtitle: 'Abrir um novo agent',
      projectId: project.id,
      payload: {
        projectId: project.id,
        paneId: null,
        createNew: true,
      },
    },
  ];

  for (const entry of openAgents) {
    results.push({
      id: `agent-target:${project.id}:${entry.pane.id}`,
      kind: 'agent-target',
      title: entry.paneTitle,
      subtitle: 'Agent aberto',
      projectId: project.id,
      badge: String(entry.badgeIndex),
      badgeColor: entry.badgeColor,
      payload: {
        projectId: project.id,
        paneId: entry.pane.id,
        createNew: false,
      },
    });
  }

  return results;
}

function buildTerminalTargetResults(project: Project): GlobalSearchResult[] {
  const openTerminals = collectOpenTerminalPanes(project);
  const results: GlobalSearchResult[] = [
    {
      id: `terminal-target:new:${project.id}`,
      kind: 'terminal-target',
      title: 'Novo Terminal',
      subtitle: 'Abrir um novo terminal',
      projectId: project.id,
      payload: {
        projectId: project.id,
        paneId: null,
        createNew: true,
      },
    },
  ];

  for (const entry of openTerminals) {
    results.push({
      id: `terminal-target:${project.id}:${entry.pane.id}`,
      kind: 'terminal-target',
      title: entry.paneTitle,
      subtitle: 'Terminal aberto',
      projectId: project.id,
      badge: String(entry.badgeIndex),
      badgeColor: entry.badgeColor,
      payload: {
        projectId: project.id,
        paneId: entry.pane.id,
        createNew: false,
      },
    });
  }

  return results;
}

function buildTaskTargetResults(project: Project): GlobalSearchResult[] {
  return [
    {
      id: `task-target:new:${project.id}`,
      kind: 'task-target',
      title: 'Nova tarefa',
      subtitle: 'Criar uma nova tarefa',
      projectId: project.id,
      payload: {
        projectId: project.id,
        createNew: true,
      },
    },
  ];
}

function buildFormTargetResults(project: Project): GlobalSearchResult[] {
  return [
    {
      id: `form-target:new:${project.id}`,
      kind: 'form-target',
      title: 'Novo formulário',
      subtitle: 'Criar um novo formulário',
      projectId: project.id,
      payload: {
        projectId: project.id,
        createNew: true,
      },
    },
  ];
}

function buildAutomationTargetResults(project: Project): GlobalSearchResult[] {
  return [
    {
      id: `automation-target:new:${project.id}`,
      kind: 'automation-target',
      title: 'Nova automação',
      subtitle: 'Criar uma nova automação',
      projectId: project.id,
      payload: {
        projectId: project.id,
        createNew: true,
      },
    },
  ];
}

function buildFileTargetResults(project: Project): GlobalSearchResult[] {
  return [
    {
      id: `file-target:new:${project.id}`,
      kind: 'file-target',
      title: 'Novo arquivo',
      subtitle: 'Criar um novo arquivo',
      projectId: project.id,
      payload: {
        projectId: project.id,
        createNew: true,
      },
    },
  ];
}

function mergeCreateTargetResults(
  createResults: GlobalSearchResult[],
  searchResults: GlobalSearchResult[],
  filterText: string,
): GlobalSearchResult[] {
  const filteredCreate = createResults.filter((item) =>
    matchesQuery([item.title, item.subtitle], filterText),
  );

  return [...filteredCreate, ...searchResults];
}

export async function searchSlashQuery(
  slash: SlashCommandQuery | null,
  suggestedCommands: SlashCommandId[],
  projects: Project[],
  activeProjectId: string | null,
  signal?: AbortSignal,
): Promise<GlobalSearchGroupedResults> {
  if (!slash) {
    const commands = suggestedCommands.length > 0 ? suggestedCommands : [];

    if (commands.length === 0) {
      return { groups: [] };
    }

    return {
      groups: [
        {
          id: 'commands',
          kind: 'results',
          items: buildSlashCommandResults(commands),
        },
      ],
    };
  }

  if (slash.phase === 'project') {
    const token = slash.projectToken ?? '';

    return {
      groups: [
        {
          id: 'projects',
          kind: 'results',
          items: searchProjects(projects, token, activeProjectId),
        },
      ],
    };
  }

  const project = projects.find((entry) => entry.id === slash.projectId) ?? null;

  if (slash.requiresProject && !project) {
    return { groups: [] };
  }

  const filterText = slash.filterText;
  let items: GlobalSearchResult[] = [];

  switch (slash.command) {
    case 'project':
      items = searchProjects(projects, filterText, activeProjectId);
      break;
    case 'tab':
      items = project ? searchTabs(project, filterText) : [];
      break;
    case 'file':
      if (project && !signal?.aborted) {
        const searchResults = filterText.trim()
          ? await searchFiles(project, filterText, signal)
          : [];
        items = mergeCreateTargetResults(
          buildFileTargetResults(project),
          signal?.aborted ? [] : searchResults,
          filterText,
        );
      }
      break;
    case 'git':
      items = project ? await searchGitChanges(project, filterText) : [];
      break;
    case 'task':
      items = project
        ? mergeCreateTargetResults(buildTaskTargetResults(project), searchTasks(project, filterText), filterText)
        : [];
      break;
    case 'form':
      items = project
        ? mergeCreateTargetResults(buildFormTargetResults(project), searchForms(project, filterText), filterText)
        : [];
      break;
    case 'automation':
      items = project
        ? mergeCreateTargetResults(
            buildAutomationTargetResults(project),
            searchAutomations(project, filterText),
            filterText,
          )
        : [];
      break;
    case 'music':
      items = await searchMusic(filterText);
      break;
    case 'emulator':
      items = project ? await searchEmulatorDevices(project, filterText) : [];
      break;
    case 'api':
      if (!slash.isCurlPayload && project) {
        items = await searchApiRoutes(project.id, filterText);
      }

      break;
    case 'agent':
      items = project ? buildAgentTargetResults(project) : [];
      break;
    case 'terminal':
      items = project ? buildTerminalTargetResults(project) : [];
      break;
    case 'browser':
      items = [];
      break;
    default:
      items = [];
  }

  if (items.length === 0) {
    return { groups: [] };
  }

  return {
    groups: [
      {
        id: 'slash-results',
        kind: 'results',
        label: project?.name,
        projectId: project?.id,
        items,
      },
    ],
  };
}
