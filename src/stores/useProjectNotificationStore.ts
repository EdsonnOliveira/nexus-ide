import { create } from 'zustand';
import {
  playAgentNotificationSound,
  startAgentNotificationSoundLoop,
  stopAgentNotificationSoundLoop,
} from '@/utils/agentNotificationSound';
import { findProjectIdByPaneId } from '@/utils/findProjectIdByPaneId';

interface ProjectNotificationState {
  notifiedAgentPaneByProject: Record<string, string>;
  markProjectReady: (projectId: string, paneId: string) => void;
  restoreProjectNotification: (projectId: string, paneId: string) => void;
  clearProjectNotification: (projectId: string) => void;
  clearNotificationForPane: (paneId: string) => void;
}

export const useProjectNotificationStore = create<ProjectNotificationState>((set) => ({
  notifiedAgentPaneByProject: {},
  markProjectReady: (projectId, paneId) => {
    playAgentNotificationSound();
    startAgentNotificationSoundLoop();

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
    startAgentNotificationSoundLoop();
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
    const projectId = findProjectIdByPaneId(paneId);

    if (!projectId) {
      return;
    }

    set((state) => {
      if (state.notifiedAgentPaneByProject[projectId] !== paneId) {
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
