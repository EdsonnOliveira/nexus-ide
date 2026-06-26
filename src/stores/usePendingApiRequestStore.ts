import { create } from 'zustand';
import type { ApiRequest } from '@/types/api';

interface PendingApiRequestEntry {
  request: ApiRequest;
  autoSend: boolean;
}

interface PendingApiRequestState {
  pendingByPaneId: Record<string, PendingApiRequestEntry>;
  setPending: (paneId: string, request: ApiRequest, autoSend: boolean) => void;
  takePending: (paneId: string) => PendingApiRequestEntry | null;
}

export const usePendingApiRequestStore = create<PendingApiRequestState>((set, get) => ({
  pendingByPaneId: {},
  setPending: (paneId, request, autoSend) => {
    set((state) => ({
      pendingByPaneId: {
        ...state.pendingByPaneId,
        [paneId]: { request, autoSend },
      },
    }));
  },
  takePending: (paneId) => {
    const entry = get().pendingByPaneId[paneId] ?? null;

    if (!entry) {
      return null;
    }

    set((state) => {
      const next = { ...state.pendingByPaneId };
      delete next[paneId];
      return { pendingByPaneId: next };
    });

    return entry;
  },
}));
