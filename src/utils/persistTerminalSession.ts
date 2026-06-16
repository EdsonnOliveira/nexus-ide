import { extractCliAgentCommand } from '@/constants/cliAgentCommands';
import { useProjectStore } from '@/stores/useProjectStore';
import type { TerminalTab } from '@/types';
import { findProjectIdByPaneId } from '@/utils/findProjectIdByPaneId';
import { collectProjectPanes, updatePaneInTabs } from '@/utils/tabGroups';

type TerminalSessionPatch = Partial<
  Pick<TerminalTab, 'lastCommand' | 'restoreCommand' | 'terminalCwd'>
>;

const pendingUpdates = new Map<string, TerminalSessionPatch>();
let flushTimer: number | null = null;

async function flushPendingTerminalSessions(): Promise<void> {
  flushTimer = null;

  if (pendingUpdates.size === 0) {
    return;
  }

  const updates = new Map(pendingUpdates);
  pendingUpdates.clear();
  const { projects, updateProject } = useProjectStore.getState();

  for (const [key, patch] of updates) {
    const separatorIndex = key.indexOf(':');

    if (separatorIndex === -1) {
      continue;
    }

    const projectId = key.slice(0, separatorIndex);
    const paneId = key.slice(separatorIndex + 1);
    const project = projects.find((entry) => entry.id === projectId);

    if (!project) {
      continue;
    }

    await updateProject(projectId, {
      tabs: updatePaneInTabs(project.tabs, paneId, (pane) =>
        pane.type === 'terminal' ? { ...pane, ...patch } : pane,
      ),
    });
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
    restoreCommand: agentCommand ? trimmed : null,
  });
}

export function persistTerminalCwd(paneId: string, cwd: string): void {
  schedulePersistTerminalPane(paneId, { terminalCwd: cwd });
}

export function clearTerminalRestoreCommand(paneId: string): void {
  schedulePersistTerminalPane(paneId, { restoreCommand: null });
}

export async function flushTerminalSessionsNow(): Promise<void> {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }

  await flushPendingTerminalSessions();

  const { projects } = useProjectStore.getState();
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
