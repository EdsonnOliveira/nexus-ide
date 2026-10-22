import { create } from 'zustand';

export interface AgentWhatsAppFinishPayload {
  paneId: string;
  projectId: string;
  turnId: string;
  agentLabel: string;
  promptPreview: string;
  message: string;
  link: string;
}

interface AgentWhatsAppNotifyState {
  finish: AgentWhatsAppFinishPayload | null;
  openFinish: (payload: AgentWhatsAppFinishPayload) => void;
  closeFinish: () => void;
}

export const useAgentWhatsAppNotifyStore = create<AgentWhatsAppNotifyState>((set) => ({
  finish: null,
  openFinish: (payload) => {
    set({ finish: payload });
  },
  closeFinish: () => {
    set({ finish: null });
  },
}));
