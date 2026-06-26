import { create } from 'zustand';

interface PendingTaskView {
  projectId: string;
  taskId?: string;
  createNew?: boolean;
}

interface PendingTaskViewState {
  pending: PendingTaskView | null;
  setPending: (projectId: string, taskId: string) => void;
  setPendingCreate: (projectId: string) => void;
  clearPending: () => void;
}

export const usePendingTaskViewStore = create<PendingTaskViewState>((set) => ({
  pending: null,
  setPending: (projectId, taskId) => set({ pending: { projectId, taskId } }),
  setPendingCreate: (projectId) => set({ pending: { projectId, createNew: true } }),
  clearPending: () => set({ pending: null }),
}));
