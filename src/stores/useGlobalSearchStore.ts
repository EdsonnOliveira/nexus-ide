import { create } from 'zustand';

interface GlobalSearchState {
  isOpen: boolean;
  musicPlayerOpenTick: number;
  open: () => void;
  close: () => void;
  toggle: () => void;
  requestMusicPlayerOpen: () => void;
}

export const useGlobalSearchStore = create<GlobalSearchState>((set) => ({
  isOpen: false,
  musicPlayerOpenTick: 0,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  requestMusicPlayerOpen: () =>
    set((state) => ({ musicPlayerOpenTick: state.musicPlayerOpenTick + 1 })),
}));
