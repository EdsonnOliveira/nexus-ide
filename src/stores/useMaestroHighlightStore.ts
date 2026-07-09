import { create } from 'zustand';
import type { MaestroTestHighlight, MaestroTestHighlightEvent } from '@/types/test';

interface MaestroHighlightState {
  activeHighlight: MaestroTestHighlight | null;
  applyHighlightEvent: (event: MaestroTestHighlightEvent) => void;
  clearAll: () => void;
}

export const useMaestroHighlightStore = create<MaestroHighlightState>((set) => ({
  activeHighlight: null,
  applyHighlightEvent: (event) => {
    if ('clear' in event) {
      set((state) => {
        if (!state.activeHighlight || state.activeHighlight.runId !== event.runId) {
          return state;
        }

        return { activeHighlight: null };
      });
      return;
    }

    set({ activeHighlight: event });
  },
  clearAll: () => set({ activeHighlight: null }),
}));

export function useMaestroHighlightForPlatform(
  platform: 'ios' | 'android',
): MaestroTestHighlight | null {
  return useMaestroHighlightStore((state) => {
    const highlight = state.activeHighlight;

    if (!highlight || highlight.platform !== platform) {
      return null;
    }

    return highlight;
  });
}
