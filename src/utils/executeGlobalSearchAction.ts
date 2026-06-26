import { useGlobalSearchStore } from '@/stores/useGlobalSearchStore';
import { usePendingApiRequestStore } from '@/stores/usePendingApiRequestStore';
import { usePendingAutomationCreateStore } from '@/stores/usePendingAutomationCreateStore';
import { usePendingExplorerCreateStore } from '@/stores/usePendingExplorerCreateStore';
import { usePendingPasswordViewStore } from '@/stores/usePendingPasswordViewStore';
import { usePendingTaskViewStore } from '@/stores/usePendingTaskViewStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import type { ApiTab, EmulatorTab, Project } from '@/types';
import { executeAgentPrompt } from '@/utils/executeAgentPrompt';
import { executeAutomation } from '@/utils/executeAutomation';
import { parseCurl } from '@/utils/parseCurl';
import { getTerminalHandle } from '@/utils/terminalHandleRegistry';
import { resetAgentReadyDetectors } from '@/utils/terminalTaskCompletion';
import type {
  GlobalSearchResult,
  SlashCommandQuery,
} from '@/utils/globalSearchTypes';
import type { TabStoreActions } from '@/stores/useTabStore';

const PANE_FOCUS_DELAY_MS = 100;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function waitForWritableHandle(paneId: string, attempts = 120): Promise<boolean> {
  return new Promise((resolve) => {
    let remaining = attempts;

    const tryResolve = () => {
      if (getTerminalHandle(paneId)?.isWritable()) {
        resolve(true);
        return;
      }

      remaining -= 1;

      if (remaining <= 0) {
        resolve(false);
        return;
      }

      window.requestAnimationFrame(tryResolve);
    };

    tryResolve();
  });
}

function normalizeBrowserUrlInput(url: string): string {
  const trimmed = url.trim();

  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

async function ensureProject(projectId: string): Promise<Project | null> {
  const store = useProjectStore.getState();
  const existing = store.projects.find((project) => project.id === projectId);

  if (!existing) {
    return null;
  }

  if (store.activeProjectId === projectId) {
    return store.getActiveProject();
  }

  await store.selectProject(projectId);
  return useProjectStore.getState().getActiveProject();
}

async function runTerminalCommand(
  projectId: string,
  command: string,
  tabActions: TabStoreActions,
  options?: { paneId?: string | null; createNew?: boolean },
): Promise<void> {
  await ensureProject(projectId);
  const trimmed = command.trim();

  if (!trimmed) {
    return;
  }

  let paneId = !options?.createNew ? options?.paneId ?? null : null;
  const creatingNew = !paneId;

  if (creatingNew) {
    resetAgentReadyDetectors('');
    await tabActions.addTab('terminal');
    await delay(PANE_FOCUS_DELAY_MS);

    const project = useProjectStore.getState().getActiveProject();
    paneId = project?.activeTabId ?? null;
  }

  if (!paneId) {
    return;
  }

  if (creatingNew) {
    useTerminalSessionStore.getState().setPendingLaunchCommand(paneId, trimmed);
    await tabActions.selectPane(paneId);
    return;
  }

  await tabActions.selectPane(paneId);
  await delay(PANE_FOCUS_DELAY_MS);

  const ready = await waitForWritableHandle(paneId);

  if (!ready) {
    return;
  }

  const handle = getTerminalHandle(paneId);
  handle?.focus();
  handle?.write(`${trimmed}\n`);
  useTerminalSessionStore.getState().setLastCommand(paneId, trimmed);
}

async function openApiWithRequest(
  projectId: string,
  request: ReturnType<typeof parseCurl>,
  autoSend: boolean,
  tabActions: TabStoreActions,
): Promise<void> {
  await ensureProject(projectId);
  await tabActions.addTab('api');
  await delay(PANE_FOCUS_DELAY_MS);

  const project = useProjectStore.getState().getActiveProject();
  const paneId = project?.activeTabId;

  if (!paneId) {
    return;
  }

  usePendingApiRequestStore.getState().setPending(paneId, request, autoSend);
  await tabActions.selectPane(paneId);
}

async function openEmulatorDevice(
  projectId: string,
  platform: EmulatorTab['platform'],
  deviceId: string,
  tabActions: TabStoreActions,
): Promise<void> {
  await ensureProject(projectId);
  await tabActions.addTab('emulator');
  await delay(PANE_FOCUS_DELAY_MS);

  const store = useProjectStore.getState();
  const project = store.getActiveProject();

  if (!project?.activeTabId) {
    return;
  }

  const nextTabs = project.tabs.map((tab) => {
    if (tab.id !== project.activeTabId || tab.type !== 'emulator') {
      return tab;
    }

    return {
      ...tab,
      platform,
      deviceId,
    };
  });

  await store.updateProject(project.id, {
    tabs: nextTabs,
  });

  await tabActions.selectPane(project.activeTabId);

  try {
    await window.nexus.emulator.start(project.activeTabId, platform, deviceId);
  } catch {
    return;
  }
}

export async function executeGlobalSearchResult(
  result: GlobalSearchResult,
  tabActions: TabStoreActions,
): Promise<boolean> {
  switch (result.kind) {
    case 'project': {
      const payload = result.payload as { projectId: string };
      await useProjectStore.getState().selectProject(payload.projectId);
      return true;
    }
    case 'tab': {
      const payload = result.payload as { projectId: string; paneId: string; tabBarId: string };
      await ensureProject(payload.projectId);
      await tabActions.selectTab(payload.tabBarId);
      await tabActions.selectPane(payload.paneId);
      return true;
    }
    case 'agent-session': {
      const payload = result.payload as { projectId: string; paneId: string; tabBarId: string };
      await ensureProject(payload.projectId);
      await tabActions.selectTab(payload.tabBarId);
      await tabActions.selectPane(payload.paneId);
      return true;
    }
    case 'file': {
      const payload = result.payload as { projectId: string; absolutePath: string };
      await ensureProject(payload.projectId);
      const fileName = payload.absolutePath.split('/').pop() ?? 'file';
      await tabActions.openFileTab(payload.absolutePath, fileName);
      return true;
    }
    case 'git': {
      const payload = result.payload as {
        projectId: string;
        path: string;
        repoPath: string;
        staged: boolean;
        untracked: boolean;
      };
      await ensureProject(payload.projectId);
      await tabActions.openDiffTab(payload.path, {
        staged: payload.staged,
        untracked: payload.untracked,
        repoPath: payload.repoPath,
      });
      return true;
    }
    case 'task': {
      const payload = result.payload as { projectId: string; taskId: string };
      const project = await ensureProject(payload.projectId);

      if (!project) {
        return false;
      }

      const task = project.tasks?.find((entry) => entry.id === payload.taskId);

      if (!task) {
        return false;
      }

      useProjectStore.getState().setSidePanel('tasks');
      usePendingTaskViewStore.getState().setPending(payload.projectId, payload.taskId);
      return true;
    }
    case 'form': {
      const payload = result.payload as { projectId: string; collectionId: string };
      const project = await ensureProject(payload.projectId);

      if (!project) {
        return false;
      }

      const collection = project.passwordCollections?.find(
        (entry) => entry.id === payload.collectionId,
      );

      if (!collection) {
        return false;
      }

      useProjectStore.getState().setSidePanel('passwords');
      usePendingPasswordViewStore.getState().setPending(payload.projectId, payload.collectionId);
      return true;
    }
    case 'automation': {
      const payload = result.payload as {
        projectId: string;
        automationId: string;
      };
      const project = useProjectStore.getState().projects.find((entry) => entry.id === payload.projectId);

      if (!project) {
        return false;
      }

      const automation = project.automations?.find((entry) => entry.id === payload.automationId);

      if (!automation) {
        return false;
      }

      await ensureProject(payload.projectId);
      await executeAutomation(automation, project.id);
      return true;
    }
    case 'music-playlist': {
      const payload = result.payload as { playlistId: string };
      await window.nexus.music.playPlaylist(payload.playlistId);
      useGlobalSearchStore.getState().requestMusicPlayerOpen();
      return true;
    }
    case 'music-track': {
      const payload = result.payload as { playlistIndex: number };
      await window.nexus.music.playQueueTrack(payload.playlistIndex);
      useGlobalSearchStore.getState().requestMusicPlayerOpen();
      return true;
    }
    case 'emulator': {
      const payload = result.payload as {
        projectId: string;
        platform: EmulatorTab['platform'];
        deviceId: string;
      };
      await openEmulatorDevice(payload.projectId, payload.platform, payload.deviceId, tabActions);
      return true;
    }
    case 'api-route': {
      const payload = result.payload as {
        projectId: string;
        request: ReturnType<typeof parseCurl>;
      };
      await openApiWithRequest(payload.projectId, payload.request, false, tabActions);
      return true;
    }
    case 'slash-command': {
      return false;
    }
    case 'task-target': {
      const payload = result.payload as { projectId: string; createNew: boolean };

      if (!payload.createNew) {
        return false;
      }

      const project = await ensureProject(payload.projectId);

      if (!project) {
        return false;
      }

      useProjectStore.getState().setSidePanel('tasks');
      usePendingTaskViewStore.getState().setPendingCreate(payload.projectId);
      return true;
    }
    case 'form-target': {
      const payload = result.payload as { projectId: string; createNew: boolean };

      if (!payload.createNew) {
        return false;
      }

      const project = await ensureProject(payload.projectId);

      if (!project) {
        return false;
      }

      useProjectStore.getState().setSidePanel('passwords');
      usePendingPasswordViewStore.getState().setPendingCreate(payload.projectId);
      return true;
    }
    case 'automation-target': {
      const payload = result.payload as { projectId: string; createNew: boolean };

      if (!payload.createNew) {
        return false;
      }

      const project = await ensureProject(payload.projectId);

      if (!project) {
        return false;
      }

      useProjectStore.getState().setSidePanel('automations');
      usePendingAutomationCreateStore.getState().setPending(payload.projectId);
      return true;
    }
    case 'file-target': {
      const payload = result.payload as { projectId: string; createNew: boolean };

      if (!payload.createNew) {
        return false;
      }

      const project = await ensureProject(payload.projectId);

      if (!project) {
        return false;
      }

      useProjectStore.getState().setSidePanel('explorer');
      usePendingExplorerCreateStore.getState().setPending(payload.projectId, 'file');
      return true;
    }
    default:
      return false;
  }
}

export async function executeSlashCommand(
  slash: SlashCommandQuery,
  tabActions: TabStoreActions,
  selectedResult: GlobalSearchResult | null,
  agentPromptImageDataUrls: string[] = [],
): Promise<boolean> {
  const agentTarget =
    selectedResult?.kind === 'agent-target'
      ? (selectedResult.payload as { projectId: string; paneId: string | null; createNew: boolean })
      : null;
  const terminalTarget =
    selectedResult?.kind === 'terminal-target'
      ? (selectedResult.payload as { projectId: string; paneId: string | null; createNew: boolean })
      : null;

  if (
    selectedResult &&
    selectedResult.kind !== 'slash-command' &&
    selectedResult.kind !== 'agent-target' &&
    selectedResult.kind !== 'terminal-target'
  ) {
    return executeGlobalSearchResult(selectedResult, tabActions);
  }

  const project =
    slash.projectId && slash.requiresProject
      ? await ensureProject(slash.projectId)
      : useProjectStore.getState().getActiveProject();

  switch (slash.command) {
    case 'project': {
      const projects = useProjectStore.getState().projects;
      const match = projects.find((entry) =>
        entry.name.toLowerCase().includes(slash.filterText.trim().toLowerCase()),
      );

      if (match) {
        await useProjectStore.getState().selectProject(match.id);
        return true;
      }

      return false;
    }
    case 'agent': {
      if (!project || !slash.projectId) {
        return false;
      }

      const target = agentTarget ?? {
        projectId: slash.projectId,
        paneId: null,
        createNew: true,
      };

      return executeAgentPrompt({
        project,
        prompt: slash.payload || slash.filterText,
        paneId: target.paneId,
        createNew: target.createNew,
        imageDataUrls: agentPromptImageDataUrls,
        addAgentTab: tabActions.addAgentTab,
        selectPane: tabActions.selectPane,
      });
    }
    case 'terminal': {
      if (!slash.projectId) {
        return false;
      }

      const target = terminalTarget ?? {
        projectId: slash.projectId,
        paneId: null,
        createNew: true,
      };

      await runTerminalCommand(slash.projectId, slash.payload || slash.filterText, tabActions, {
        paneId: target.paneId,
        createNew: target.createNew,
      });
      return Boolean((slash.payload || slash.filterText).trim());
    }
    case 'browser': {
      if (!slash.projectId) {
        return false;
      }

      await ensureProject(slash.projectId);
      const url = normalizeBrowserUrlInput(slash.payload || slash.filterText);

      if (url) {
        await tabActions.openBrowserTab(url);
      } else {
        await tabActions.addTab('browser');
      }

      return true;
    }
    case 'api': {
      if (!slash.projectId) {
        return false;
      }

      if (slash.isCurlPayload) {
        const request = parseCurl(slash.filterText);
        await openApiWithRequest(slash.projectId, request, true, tabActions);
        return true;
      }

      return false;
    }
    default:
      return false;
  }
}
