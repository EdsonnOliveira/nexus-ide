import { create } from 'zustand';

interface AgentPipState {
  paneId: string | null;
  displayId: number | null;
  pin: (paneId: string, displayId: number) => void;
  unpin: () => void;
  clearLocal: () => void;
}

export const useAgentPipStore = create<AgentPipState>((set, get) => ({
  paneId: null,
  displayId: null,
  pin: (paneId, displayId) => {
    set({ paneId, displayId });
  },
  unpin: () => {
    if (!get().paneId) {
      return;
    }

    set({ paneId: null, displayId: null });
    void window.nexus.agentPip.unpin();
  },
  clearLocal: () => {
    set({ paneId: null, displayId: null });
  },
}));
