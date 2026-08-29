import { create } from 'zustand';

interface AgentPipState {
  paneId: string | null;
  pin: (paneId: string) => void;
  unpin: () => void;
  clearLocal: () => void;
}

export const useAgentPipStore = create<AgentPipState>((set, get) => ({
  paneId: null,
  pin: (paneId) => {
    set({ paneId });
  },
  unpin: () => {
    if (!get().paneId) {
      return;
    }

    set({ paneId: null });
    void window.nexus.agentPip.unpin();
  },
  clearLocal: () => {
    set({ paneId: null });
  },
}));
