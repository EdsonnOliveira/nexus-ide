import { create } from 'zustand';

interface PendingPasswordView {
  projectId: string;
  collectionId?: string;
  createNew?: boolean;
}

interface PendingPasswordViewState {
  pending: PendingPasswordView | null;
  setPending: (projectId: string, collectionId: string) => void;
  setPendingCreate: (projectId: string) => void;
  clearPending: () => void;
}

export const usePendingPasswordViewStore = create<PendingPasswordViewState>((set) => ({
  pending: null,
  setPending: (projectId, collectionId) => set({ pending: { projectId, collectionId } }),
  setPendingCreate: (projectId) => set({ pending: { projectId, createNew: true } }),
  clearPending: () => set({ pending: null }),
}));
