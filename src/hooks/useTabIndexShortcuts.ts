import { useEffect } from 'react';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTabActions } from '@/stores/useTabStore';
import { isOverlayBlockingTerminalHints } from '@/utils/overlayBlocking';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.closest('.xterm') || target.closest('.cm-editor')) {
    return false;
  }

  const tag = target.tagName;

  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    return true;
  }

  return target.isContentEditable;
}

function isTabIndexShortcut(event: KeyboardEvent): boolean {
  if (event.altKey || event.shiftKey) {
    return false;
  }

  if (!event.metaKey && !event.ctrlKey) {
    return false;
  }

  const digit = event.key;

  return digit >= '1' && digit <= '9';
}

export function useTabIndexShortcuts(): void {
  const { selectTab } = useTabActions();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTabIndexShortcut(event)) {
        return;
      }

      if (isOverlayBlockingTerminalHints()) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      const { activeProjectId, projects } = useProjectStore.getState();
      const project = projects.find((entry) => entry.id === activeProjectId);

      if (!project || project.tabs.length === 0) {
        return;
      }

      const index = Number(event.key) - 1;
      const tab = project.tabs[index];

      if (!tab) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void selectTab(tab.id);
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [selectTab]);
}
