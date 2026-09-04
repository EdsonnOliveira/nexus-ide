import { create } from 'zustand';
import {
  playAgentNotificationSound,
  startAgentNotificationSoundLoop,
  stopAgentNotificationSoundLoop,
} from '@/utils/agentNotificationSound';
import { findProjectIdByPaneId } from '@/utils/findProjectIdByPaneId';
import { notifyDesktopAgentWebPush } from '@/utils/notifyDesktopAgentWebPush';

interface ProjectNotificationState {
  notifiedAgentPaneByProject: Record<string, string>;
  markProjectReady: (projectId: string, paneId: string) => void;
  restoreProjectNotification: (projectId: string, paneId: string) => void;
  clearProjectNotification: (projectId: string) => void;
  clearNotificationForPane: (paneId: string) => void;
}

export const useProjectNotificationStore = create<ProjectNotificationState>((set, get) => ({
  notifiedAgentPaneByProject: {},
  markProjectReady: (projectId, paneId) => {
    if (get().notifiedAgentPaneByProject[projectId] === paneId) {
      startAgentNotificationSoundLoop();
      return;
    }

    playAgentNotificationSound();
    startAgentNotificationSoundLoop();
    notifyDesktopAgentWebPush(projectId, paneId);

    set((state) => ({
      notifiedAgentPaneByProject: {
        ...state.notifiedAgentPaneByProject,
        [projectId]: paneId,
      },
    }));
  },

  restoreProjectNotification: (projectId, paneId) => {
    set((state) => ({
      notifiedAgentPaneByProject: {
        ...state.notifiedAgentPaneByProject,
        [projectId]: paneId,
      },
    }));
  },
  clearProjectNotification: (projectId) => {
    set((state) => {
      if (!state.notifiedAgentPaneByProject[projectId]) {
        return state;
      }

      const next = { ...state.notifiedAgentPaneByProject };
      delete next[projectId];

      if (Object.keys(next).length === 0) {
        stopAgentNotificationSoundLoop();
      }

      return { notifiedAgentPaneByProject: next };
    });
  },
  clearNotificationForPane: (paneId) => {
    set((state) => {
      const matchedProjectId = Object.entries(state.notifiedAgentPaneByProject).find(
        ([, notifiedPaneId]) => notifiedPaneId === paneId,
      )?.[0];
      const projectId = findProjectIdByPaneId(paneId) ?? matchedProjectId;

      if (!projectId || state.notifiedAgentPaneByProject[projectId] !== paneId) {
        return state;
      }

      const next = { ...state.notifiedAgentPaneByProject };
      delete next[projectId];

      if (Object.keys(next).length === 0) {
        stopAgentNotificationSoundLoop();
      }

      return { notifiedAgentPaneByProject: next };
    });
  },
}));
