import { useEffect, useState } from 'react';
import { useProjectStore } from '@/stores/useProjectStore';
import type { Project } from '@/types';
import {
  isOverlayBlockingTerminalHints,
  subscribeOverlayBlockingChange,
} from '@/utils/overlayBlocking';

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

function canSelectProjectByIndex(): boolean {
  if (isOverlayBlockingTerminalHints()) {
    return false;
  }

  const { activeProjectId, projects } = useProjectStore.getState();
  const activeProject = projects.find((entry) => entry.id === activeProjectId);

  if (activeProject && activeProject.tabs.length > 0) {
    return false;
  }

  return true;
}

export function useProjectIndexShortcuts({
  filteredProjects,
  onSelectProject,
}: UseProjectIndexShortcutsOptions): boolean {
  const [modifierHeld, setModifierHeld] = useState(false);
  const [overlayBlocking, setOverlayBlocking] = useState(() => isOverlayBlockingTerminalHints());
  const activeProjectHasTabs = useProjectStore((state) => {
    const activeProject = state.projects.find((entry) => entry.id === state.activeProjectId);
    return Boolean(activeProject && activeProject.tabs.length > 0);
  });

  useEffect(() => {
    const syncOverlayBlocking = () => {
      setOverlayBlocking(isOverlayBlockingTerminalHints());
    };

    syncOverlayBlocking();
    return subscribeOverlayBlockingChange(syncOverlayBlocking);
  }, []);

  useEffect(() => {
    const syncModifierHeld = (event: KeyboardEvent) => {
      setModifierHeld(event.metaKey || event.ctrlKey);
    };

    const clearModifierHeld = () => {
      setModifierHeld(false);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearModifierHeld();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      syncModifierHeld(event);

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

      if (!canSelectProjectByIndex()) {
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

    const handleKeyUp = (event: KeyboardEvent) => {
      syncModifierHeld(event);
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keyup', handleKeyUp, { capture: true });
    window.addEventListener('blur', clearModifierHeld);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('keyup', handleKeyUp, { capture: true });
      window.removeEventListener('blur', clearModifierHeld);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [filteredProjects, onSelectProject]);

  return modifierHeld && !activeProjectHasTabs && !overlayBlocking;
}
