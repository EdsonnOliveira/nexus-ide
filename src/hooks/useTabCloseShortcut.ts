import { useEffect } from 'react';
import { useProjectStore } from '@/stores/useProjectStore';
import { resolveDirtyFileTabTitle, useFileDirtyStore } from '@/stores/useFileDirtyStore';
import { useTabActions } from '@/stores/useTabStore';
import { isOverlayBlockingTerminalHints } from '@/utils/overlayBlocking';
import { isTabPinned } from '@/utils/tabOrder';
import { isHomeBoundTabItem, listProjectSurfaceTabs } from '@/utils/homeDashboardAgents';

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

function isCloseTabShortcut(event: KeyboardEvent): boolean {
  if (event.altKey || event.shiftKey) {
    return false;
  }

  if (!event.metaKey && !event.ctrlKey) {
    return false;
  }

  return event.key.toLowerCase() === 'w';
}

export function useTabCloseShortcut(): void {
  const { closeTab } = useTabActions();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isCloseTabShortcut(event)) {
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

      if (!project?.activeTabId) {
        return;
      }

      const surfaceTabs = listProjectSurfaceTabs(project);
      const activeTab =
        surfaceTabs.find((item) => item.id === project.activeTabId) ??
        surfaceTabs[surfaceTabs.length - 1] ??
        null;

      if (!activeTab || isTabPinned(activeTab) || isHomeBoundTabItem(project.id, activeTab)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const dirtyStore = useFileDirtyStore.getState();
      const dirtyFiles = dirtyStore.findDirtyFileTabs(activeTab);

      if (dirtyFiles.length === 0) {
        void closeTab(activeTab.id);
        return;
      }

      const firstDirty = dirtyFiles[0]!;

      dirtyStore.setPendingClose({
        tabId: activeTab.id,
        title: resolveDirtyFileTabTitle(firstDirty),
        filePath: firstDirty.filePath,
      });
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [closeTab]);
}
