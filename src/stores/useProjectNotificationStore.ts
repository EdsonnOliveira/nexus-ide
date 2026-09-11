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
  notifiedAtByProject: Record<string, number>;
  markProjectReady: (projectId: string, paneId: string) => void;
  restoreProjectNotification: (projectId: string, paneId: string) => void;
  clearProjectNotification: (projectId: string) => void;
  clearNotificationForPane: (paneId: string) => void;
}

function omitProjectNotification(
  notifiedAgentPaneByProject: Record<string, string>,
  notifiedAtByProject: Record<string, number>,
  projectId: string,
): Pick<ProjectNotificationState, 'notifiedAgentPaneByProject' | 'notifiedAtByProject'> {
  const nextPanes = { ...notifiedAgentPaneByProject };
  delete nextPanes[projectId];
  const nextAt = { ...notifiedAtByProject };
  delete nextAt[projectId];

  if (Object.keys(nextPanes).length === 0) {
    stopAgentNotificationSoundLoop();
  }

  return {
    notifiedAgentPaneByProject: nextPanes,
    notifiedAtByProject: nextAt,
  };
}

export const useProjectNotificationStore = create<ProjectNotificationState>((set, get) => ({
  notifiedAgentPaneByProject: {},
  notifiedAtByProject: {},
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
      notifiedAtByProject: {
        ...state.notifiedAtByProject,
        [projectId]: Date.now(),
      },
    }));
  },

  restoreProjectNotification: (projectId, paneId) => {
    set((state) => ({
      notifiedAgentPaneByProject: {
        ...state.notifiedAgentPaneByProject,
        [projectId]: paneId,
      },
      notifiedAtByProject: {
        ...state.notifiedAtByProject,
        [projectId]: state.notifiedAtByProject[projectId] ?? Date.now(),
      },
    }));
  },
  clearProjectNotification: (projectId) => {
    set((state) => {
      if (!state.notifiedAgentPaneByProject[projectId]) {
        return state;
      }

      return omitProjectNotification(
        state.notifiedAgentPaneByProject,
        state.notifiedAtByProject,
        projectId,
      );
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

      return omitProjectNotification(
        state.notifiedAgentPaneByProject,
        state.notifiedAtByProject,
        projectId,
      );
    });
  },
}));
