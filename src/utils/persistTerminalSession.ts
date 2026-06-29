import { extractCliAgentCommand } from '@/constants/cliAgentCommands';
import { useProjectStore } from '@/stores/useProjectStore';
import type { Project, TerminalTab } from '@/types';
import { findProjectIdByPaneId } from '@/utils/findProjectIdByPaneId';
import { collectProjectPanes, updatePaneInTabs } from '@/utils/tabGroups';

type TerminalSessionPatch = Partial<
  Pick<TerminalTab, 'lastCommand' | 'restoreCommand' | 'terminalCwd'>
>;

const pendingUpdates = new Map<string, TerminalSessionPatch>();
let flushTimer: number | null = null;

function clearPendingTerminalFlushTimer(): void {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
}

function takePendingTerminalUpdates(): Map<string, TerminalSessionPatch> {
  clearPendingTerminalFlushTimer();
  const updates = new Map(pendingUpdates);
  pendingUpdates.clear();
  return updates;
}

function applyTerminalPatchesToProjects(
  projects: Project[],
  updates: Map<string, TerminalSessionPatch>,
): Map<string, Project> {
  const nextById = new Map(projects.map((project) => [project.id, project]));
  const touchedProjectIds = new Set<string>();

  for (const [key, patch] of updates) {
    const separatorIndex = key.indexOf(':');

    if (separatorIndex === -1) {
      continue;
    }

    const projectId = key.slice(0, separatorIndex);
    const paneId = key.slice(separatorIndex + 1);
    const project = nextById.get(projectId);

    if (!project) {
      continue;
    }

    nextById.set(projectId, {
      ...project,
      tabs: updatePaneInTabs(project.tabs, paneId, (pane) =>
        pane.type === 'terminal' ? { ...pane, ...patch } : pane,
      ),
    });
    touchedProjectIds.add(projectId);
  }

  const touched = new Map<string, Project>();

  for (const projectId of touchedProjectIds) {
    const project = nextById.get(projectId);

    if (project) {
      touched.set(projectId, project);
    }
  }

  return touched;
}

export async function flushPendingTerminalSessionsToDisk(projects: Project[]): Promise<void> {
  const updates = takePendingTerminalUpdates();

  if (updates.size === 0) {
    return;
  }

  const touchedProjects = applyTerminalPatchesToProjects(projects, updates);

  for (const [projectId, project] of touchedProjects) {
    await window.nexus.projects.update(projectId, { tabs: project.tabs });
  }
}

async function flushPendingTerminalSessions(): Promise<void> {
  const { projects, updateProject } = useProjectStore.getState();
  const updates = takePendingTerminalUpdates();

  if (updates.size === 0) {
    return;
  }

  const touchedProjects = applyTerminalPatchesToProjects(projects, updates);

  for (const [projectId, project] of touchedProjects) {
    await updateProject(projectId, { tabs: project.tabs });
  }
}

export function schedulePersistTerminalPane(paneId: string, patch: TerminalSessionPatch): void {
  const projectId = findProjectIdByPaneId(paneId);

  if (!projectId) {
    return;
  }

  const key = `${projectId}:${paneId}`;
  pendingUpdates.set(key, { ...pendingUpdates.get(key), ...patch });

  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
  }

  flushTimer = window.setTimeout(() => {
    void flushPendingTerminalSessions();
  }, 400);
}

export function persistTerminalCommand(paneId: string, command: string): void {
  const trimmed = command.trim();
  const agentCommand = extractCliAgentCommand(trimmed);

  schedulePersistTerminalPane(paneId, {
    lastCommand: trimmed,
    ...(agentCommand ? { restoreCommand: trimmed } : {}),
  });
}

export function persistTerminalCwd(paneId: string, cwd: string): void {
  schedulePersistTerminalPane(paneId, { terminalCwd: cwd });
}

export function clearTerminalRestoreCommand(paneId: string): void {
  schedulePersistTerminalPane(paneId, { restoreCommand: null });
}

export async function saveScrollbackForPane(paneId: string, ptyId: string): Promise<void> {
  const scrollback = await window.nexus.terminal.getScrollback(ptyId);

  if (!scrollback) {
    return;
  }

  await window.nexus.session.saveScrollbacks({ [paneId]: scrollback });
}

export async function saveScrollbacksFromProjects(projects: Project[]): Promise<void> {
  const scrollbacks: Record<string, string> = {};

  for (const project of projects) {
    for (const pane of collectProjectPanes(project.tabs)) {
      if (pane.type !== 'terminal' || !pane.ptyId) {
        continue;
      }

      const scrollback = await window.nexus.terminal.getScrollback(pane.ptyId);

      if (scrollback) {
        scrollbacks[pane.id] = scrollback;
      }
    }
  }

  if (Object.keys(scrollbacks).length > 0) {
    await window.nexus.session.saveScrollbacks(scrollbacks);
  }
}

export async function flushTerminalSessionsForProjectSwitch(projects: Project[]): Promise<void> {
  await flushPendingTerminalSessionsToDisk(projects);
  await saveScrollbacksFromProjects(projects);
}

export async function flushTerminalSessionsNow(): Promise<void> {
  clearPendingTerminalFlushTimer();
  await flushPendingTerminalSessions();

  const { projects } = useProjectStore.getState();
  await saveScrollbacksFromProjects(projects);
}
