import { create } from 'zustand';

export interface TerminalPasteImage {
  id: number;
  label: string;
  dataUrl: string;
  addedAt: number;
}

interface TerminalPasteImageState {
  imagesByPane: Record<string, TerminalPasteImage[]>;
  confirmedInPromptByPane: Record<string, number[]>;
  addImage: (paneId: string, dataUrl: string) => TerminalPasteImage;
  removeImage: (paneId: string, imageId: number) => void;
  syncPaneImages: (paneId: string, activeIds: number[]) => void;
  clearPaneImages: (paneId: string) => void;
}

const PASTE_GRACE_MS = 5000;

export const useTerminalPasteImageStore = create<TerminalPasteImageState>((set, get) => ({
  imagesByPane: {},
  confirmedInPromptByPane: {},
  addImage: (paneId, dataUrl) => {
    const current = get().imagesByPane[paneId] ?? [];
    const nextImage: TerminalPasteImage = {
      id: current.length + 1,
      label: `Image #${current.length + 1}`,
      dataUrl,
      addedAt: Date.now(),
    };

    set((state) => ({
      imagesByPane: {
        ...state.imagesByPane,
        [paneId]: [...current, nextImage],
      },
    }));

    return nextImage;
  },
  removeImage: (paneId, imageId) => {
    set((state) => {
      const current = state.imagesByPane[paneId] ?? [];
      const next = current.filter((image) => image.id !== imageId);
      const previousConfirmed = state.confirmedInPromptByPane[paneId] ?? [];
      const nextConfirmed = previousConfirmed.filter((id) => id !== imageId);

      if (next.length === current.length && nextConfirmed.length === previousConfirmed.length) {
        return state;
      }

      const imagesByPane = { ...state.imagesByPane };
      const confirmedInPromptByPane = { ...state.confirmedInPromptByPane };

      if (next.length === 0) {
        delete imagesByPane[paneId];
      } else {
        imagesByPane[paneId] = next;
      }

      if (nextConfirmed.length === 0) {
        delete confirmedInPromptByPane[paneId];
      } else {
        confirmedInPromptByPane[paneId] = nextConfirmed;
      }

      return { imagesByPane, confirmedInPromptByPane };
    });
  },
  syncPaneImages: (paneId, activeIds) => {
    set((state) => {
      const current = state.imagesByPane[paneId] ?? [];

      if (current.length === 0) {
        return state;
      }

      const activeIdSet = new Set(activeIds);
      const confirmedSet = new Set(state.confirmedInPromptByPane[paneId] ?? []);
      const now = Date.now();

      for (const id of activeIds) {
        confirmedSet.add(id);
      }

      const next = current.filter((image) => {
        if (activeIdSet.has(image.id)) {
          return true;
        }

        if (!confirmedSet.has(image.id)) {
          return now - image.addedAt < PASTE_GRACE_MS;
        }

        return false;
      });

      const nextConfirmed = [...confirmedSet]
        .filter((id) => activeIdSet.has(id) || next.some((image) => image.id === id))
        .sort((left, right) => left - right);

      const confirmedInPromptByPane = { ...state.confirmedInPromptByPane };

      if (nextConfirmed.length === 0) {
        delete confirmedInPromptByPane[paneId];
      } else {
        confirmedInPromptByPane[paneId] = nextConfirmed;
      }

      if (next.length === current.length) {
        if (confirmedInPromptByPane[paneId]) {
          return { ...state, confirmedInPromptByPane };
        }

        return state;
      }

      const imagesByPane = { ...state.imagesByPane };

      if (next.length === 0) {
        delete imagesByPane[paneId];
        delete confirmedInPromptByPane[paneId];
      } else {
        imagesByPane[paneId] = next;
      }

      return { imagesByPane, confirmedInPromptByPane };
    });
  },
  clearPaneImages: (paneId) => {
    set((state) => {
      const hasImages = Boolean(state.imagesByPane[paneId]?.length);
      const hasConfirmed = Boolean(state.confirmedInPromptByPane[paneId]?.length);

      if (!hasImages && !hasConfirmed) {
        return state;
      }

      const imagesByPane = { ...state.imagesByPane };
      const confirmedInPromptByPane = { ...state.confirmedInPromptByPane };

      delete imagesByPane[paneId];
      delete confirmedInPromptByPane[paneId];

      return { imagesByPane, confirmedInPromptByPane };
    });
  },
}));
