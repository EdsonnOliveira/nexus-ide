import { create } from 'zustand';

interface ProjectNotificationState {
  notifiedProjectIds: Record<string, true>;
  markProjectReady: (projectId: string) => void;
  clearProjectNotification: (projectId: string) => void;
}

export const useProjectNotificationStore = create<ProjectNotificationState>((set) => ({
  notifiedProjectIds: {},
  markProjectReady: (projectId) => {
    set((state) => ({
      notifiedProjectIds: {
        ...state.notifiedProjectIds,
        [projectId]: true,
      },
    }));
  },
  clearProjectNotification: (projectId) => {
    set((state) => {
      if (!state.notifiedProjectIds[projectId]) {
        return state;
      }

      const next = { ...state.notifiedProjectIds };
      delete next[projectId];
      return { notifiedProjectIds: next };
    });
  },
}));
