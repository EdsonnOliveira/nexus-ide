import { create } from 'zustand';

type ExplorerCreateMode = 'file';

interface PendingExplorerCreate {
  projectId: string;
  mode: ExplorerCreateMode;
}

interface PendingExplorerCreateState {
  pending: PendingExplorerCreate | null;
  setPending: (projectId: string, mode: ExplorerCreateMode) => void;
  clearPending: () => void;
}

export const usePendingExplorerCreateStore = create<PendingExplorerCreateState>((set) => ({
  pending: null,
  setPending: (projectId, mode) => set({ pending: { projectId, mode } }),
  clearPending: () => set({ pending: null }),
}));
