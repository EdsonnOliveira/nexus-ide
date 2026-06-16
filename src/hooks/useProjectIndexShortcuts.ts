import { useEffect } from 'react';
import type { Project } from '@/types';
import { isOverlayBlockingTerminalHints } from '@/utils/overlayBlocking';

interface UseProjectIndexShortcutsOptions {
  filteredProjects: Project[];
  onSelectProject: (projectId: string) => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.closest('.xterm')) {
    return false;
  }

  const tag = target.tagName;

  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    return true;
  }

  return target.isContentEditable;
}

export function useProjectIndexShortcuts({
  filteredProjects,
  onSelectProject,
}: UseProjectIndexShortcutsOptions): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) {
        return;
      }

      if (event.altKey || event.shiftKey) {
        return;
      }

      const digit = event.key;

      if (digit < '1' || digit > '9') {
        return;
      }

      if (isOverlayBlockingTerminalHints()) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      const index = Number(digit) - 1;
      const project = filteredProjects[index];

      if (!project) {
        return;
      }

      event.preventDefault();
      onSelectProject(project.id);
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [filteredProjects, onSelectProject]);
}
