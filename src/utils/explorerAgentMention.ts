import type { Project } from '@/types';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { getTerminalHandle } from '@/utils/terminalHandleRegistry';
import { resolvePaneAgentCommand } from '@/utils/projectAgentStatus';
import { collectProjectPanes, resolveActiveTabBarItem } from '@/utils/tabGroups';
import { toProjectRelativePath } from '@/utils/explorerRelativePath';

function findAgentPaneId(project: Project): string | null {
  const activeAgentByPane = useTerminalSessionStore.getState().activeAgentByPane;
  const activeItem = resolveActiveTabBarItem(project.tabs, project.activeTabId);

  if (activeItem?.type === 'split') {
    const activePaneId = project.activePaneId ?? activeItem.activePaneId;
    const activePane = activeItem.panes.find((pane) => pane.id === activePaneId);

    if (activePane && resolvePaneAgentCommand(activePane, activeAgentByPane)) {
      return activePane.id;
    }
  } else if (activeItem?.type === 'terminal') {
    if (resolvePaneAgentCommand(activeItem, activeAgentByPane)) {
      return activeItem.id;
    }
  }

  for (const pane of collectProjectPanes(project.tabs)) {
    if (resolvePaneAgentCommand(pane, activeAgentByPane)) {
      return pane.id;
    }
  }

  return null;
}

function waitForTerminalHandle(paneId: string, attempts = 16): Promise<ReturnType<typeof getTerminalHandle>> {
  return new Promise((resolve) => {
    let remaining = attempts;

    const tryResolve = () => {
      const handle = getTerminalHandle(paneId);

      if (handle) {
        resolve(handle);
        return;
      }

      remaining -= 1;

      if (remaining <= 0) {
        resolve(null);
        return;
      }

      window.requestAnimationFrame(tryResolve);
    };

    tryResolve();
  });
}

export async function mentionExplorerEntryInPane(
  projectPath: string,
  paneId: string,
  entryPath: string,
  selectPane: (paneId: string) => void | Promise<void>,
): Promise<boolean> {
  const relativePath = toProjectRelativePath(projectPath, entryPath);
  const mention = `@${relativePath}`;

  await selectPane(paneId);

  const handle = await waitForTerminalHandle(paneId);

  if (!handle) {
    return false;
  }

  handle.focus();
  handle.write(`${mention} `);
  return true;
}

export async function mentionExplorerEntryInAgent(
  project: Project,
  entryPath: string,
  selectPane: (paneId: string) => Promise<void>,
): Promise<boolean> {
  const paneId = findAgentPaneId(project);

  if (!paneId) {
    return false;
  }

  return mentionExplorerEntryInPane(project.path, paneId, entryPath, selectPane);
}
