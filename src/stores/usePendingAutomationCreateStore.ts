import { create } from 'zustand';

interface PendingAutomationCreateState {
  pendingProjectId: string | null;
  setPending: (projectId: string) => void;
  clearPending: () => void;
}

export const usePendingAutomationCreateStore = create<PendingAutomationCreateState>((set) => ({
  pendingProjectId: null,
  setPending: (projectId) => set({ pendingProjectId: projectId }),
  clearPending: () => set({ pendingProjectId: null }),
}));
