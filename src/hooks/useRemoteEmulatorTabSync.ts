import { useEffect } from 'react';
import { useProjectStore } from '@/stores/useProjectStore';
import { createBadgeColorIndex } from '@/utils/tabBadge';
import {
  collectProjectPanes,
  findPaneTab,
  updatePaneInTabs,
} from '@/utils/tabGroups';
import type { EmulatorTab } from '@/types';

function countEmulatorPanes(projectId: string): number {
  const project = useProjectStore.getState().projects.find((entry) => entry.id === projectId);
  if (!project) {
    return 0;
  }
  return collectProjectPanes(project.tabs).filter((pane) => pane.type === 'emulator').length;
}

export function useRemoteEmulatorTabSync(): void {
  useEffect(() => {
    if (!window.nexus?.emulator?.onEnsureRemoteTab) {
      return;
    }

    return window.nexus.emulator.onEnsureRemoteTab((payload) => {
      void (async () => {
        const state = useProjectStore.getState();
        let project =
          (payload.localProjectId
            ? state.projects.find((entry) => entry.id === payload.localProjectId)
            : null) ??
          state.projects.find((entry) => entry.id === state.activeProjectId) ??
          state.projects[0] ??
          null;

        if (!project) {
          return;
        }

        if (state.activeProjectId !== project.id) {
          await state.selectProject(project.id);
          project =
            useProjectStore.getState().projects.find((entry) => entry.id === project!.id) ?? project;
        }

        const existing = findPaneTab(project.tabs, payload.tabId);
        if (existing?.type === 'emulator') {
          await useProjectStore.getState().updateProject(project.id, {
            tabs: updatePaneInTabs(project.tabs, payload.tabId, (entry) =>
              entry.type === 'emulator'
                ? {
                    ...entry,
                    platform: payload.platform,
                    deviceId: payload.deviceId,
                    sessionId: payload.sessionId ?? entry.sessionId,
                  }
                : entry,
            ),
            activeTabId: payload.tabId,
            activePaneId: null,
          });
          return;
        }

        const nextTab: EmulatorTab = {
          id: payload.tabId,
          title: `Emulador ${countEmulatorPanes(project.id) + 1}`,
          type: 'emulator',
          platform: payload.platform,
          deviceId: payload.deviceId,
          sessionId: payload.sessionId ?? null,
          badgeColorIndex: createBadgeColorIndex(project.tabs),
        };

        await useProjectStore.getState().updateProject(project.id, {
          tabs: [...project.tabs, nextTab],
          activeTabId: payload.tabId,
          activePaneId: null,
        });
      })();
    });
  }, []);
}
