import { projectStore } from './projectStore';
import { sessionStore } from './sessionStore';

function collectAliveTerminalPaneIds(): string[] {
  const { projects } = projectStore.list();
  const alive: string[] = [];

  for (const project of projects) {
    for (const item of project.tabs ?? []) {
      if (item.type === 'split') {
        for (const pane of item.panes) {
          if (pane.type === 'terminal' || pane.type === 'agent') {
            alive.push(pane.id);
          }
        }
        continue;
      }

      if (item.type === 'terminal' || item.type === 'agent') {
        alive.push(item.id);
      }
    }
  }

  return alive;
}

export function pruneSessionScrollbacksOnBoot(): void {
  try {
    const alivePaneIds = collectAliveTerminalPaneIds();
    sessionStore.pruneAndTruncateScrollbacks(alivePaneIds);
  } catch {
    return;
  }
}
