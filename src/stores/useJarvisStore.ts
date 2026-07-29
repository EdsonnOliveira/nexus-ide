import { create } from 'zustand';
import type { JarvisIntent, JarvisPhase, JarvisStatus } from '@/types';

interface JarvisStoreState {
  enabled: boolean;
  phase: JarvisPhase;
  status: JarvisStatus | null;
  lastTranscript: string | null;
  lastError: string | null;
  busy: boolean;
  setEnabled: (enabled: boolean) => void;
  setPhase: (phase: JarvisPhase) => void;
  setStatus: (status: JarvisStatus | null) => void;
  setLastTranscript: (transcript: string | null) => void;
  setLastError: (error: string | null) => void;
  setBusy: (busy: boolean) => void;
}

export const useJarvisStore = create<JarvisStoreState>((set) => ({
  enabled: false,
  phase: 'idle',
  status: null,
  lastTranscript: null,
  lastError: null,
  busy: false,
  setEnabled: (enabled) => set({ enabled }),
  setPhase: (phase) => set({ phase }),
  setStatus: (status) => set({ status }),
  setLastTranscript: (lastTranscript) => set({ lastTranscript }),
  setLastError: (lastError) => set({ lastError }),
  setBusy: (busy) => set({ busy }),
}));

export type { JarvisIntent };
