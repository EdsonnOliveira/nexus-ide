import { create } from 'zustand';

interface AutomationExecutionState {
  executingAutomationByProject: Record<string, string | null>;
  executingPaneIds: Record<string, boolean>;
  pendingEmulatorAutoStartTabIds: string[];
  markAutomationRunning: (projectId: string, automationId: string) => void;
  clearAutomationRunning: (projectId: string) => void;
  markAutomationPaneExecuting: (paneId: string) => void;
  clearAutomationPaneExecuting: (paneId: string) => void;
  syncPendingEmulatorAutoStart: (tabIds: string[]) => void;
  shouldAutoStartEmulator: (tabId: string) => boolean;
  completeEmulatorAutoStart: (tabId: string) => void;
}

export const useAutomationExecutionStore = create<AutomationExecutionState>((set, get) => ({
  executingAutomationByProject: {},
  executingPaneIds: {},
  pendingEmulatorAutoStartTabIds: [],
  markAutomationRunning: (projectId, automationId) => {
    set((state) => ({
      executingAutomationByProject: {
        ...state.executingAutomationByProject,
        [projectId]: automationId,
      },
    }));
  },
  clearAutomationRunning: (projectId) => {
    set((state) => {
      if (!state.executingAutomationByProject[projectId]) {
        return state;
      }

      const next = { ...state.executingAutomationByProject };
      delete next[projectId];

      return { executingAutomationByProject: next };
    });
  },
  markAutomationPaneExecuting: (paneId) => {
    set((state) => {
      if (state.executingPaneIds[paneId]) {
        return state;
      }

      return {
        executingPaneIds: {
          ...state.executingPaneIds,
          [paneId]: true,
        },
      };
    });
  },
  clearAutomationPaneExecuting: (paneId) => {
    set((state) => {
      if (!state.executingPaneIds[paneId]) {
        return state;
      }

      const next = { ...state.executingPaneIds };
      delete next[paneId];

      return { executingPaneIds: next };
    });
  },
  syncPendingEmulatorAutoStart: (tabIds) => {
    set({ pendingEmulatorAutoStartTabIds: tabIds });
  },
  shouldAutoStartEmulator: (tabId) => get().pendingEmulatorAutoStartTabIds.includes(tabId),
  completeEmulatorAutoStart: (tabId) => {
    set((state) => ({
      pendingEmulatorAutoStartTabIds: state.pendingEmulatorAutoStartTabIds.filter(
        (entry) => entry !== tabId,
      ),
    }));
  },
}));
