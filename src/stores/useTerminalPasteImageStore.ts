import { create } from 'zustand';

export interface TerminalPasteImage {
  id: number;
  label: string;
  dataUrl: string;
  relativePath: string;
  absolutePath: string;
  addedAt: number;
}

interface TerminalPasteImageState {
  imagesByPane: Record<string, TerminalPasteImage[]>;
  confirmedInPromptByPane: Record<string, string[]>;
  addImage: (
    paneId: string,
    dataUrl: string,
    saved: { relativePath: string; absolutePath: string },
  ) => TerminalPasteImage;
  removeImage: (paneId: string, imageId: number) => void;
  syncPaneImages: (paneId: string, activeRelativePaths: string[]) => void;
  clearPaneImages: (paneId: string) => void;
}

const PASTE_GRACE_MS = 5000;

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

export const useTerminalPasteImageStore = create<TerminalPasteImageState>((set, get) => ({
  imagesByPane: {},
  confirmedInPromptByPane: {},
  addImage: (paneId, dataUrl, saved) => {
    const current = get().imagesByPane[paneId] ?? [];
    const nextImage: TerminalPasteImage = {
      id: current.length + 1,
      label: `Image #${current.length + 1}`,
      dataUrl,
      relativePath: normalizeRelativePath(saved.relativePath),
      absolutePath: saved.absolutePath,
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
      const removed = current.find((image) => image.id === imageId);

      if (!removed) {
        return state;
      }

      const next = current.filter((image) => image.id !== imageId);
      const previousConfirmed = state.confirmedInPromptByPane[paneId] ?? [];
      const nextConfirmed = previousConfirmed.filter((path) => path !== removed.relativePath);

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
  syncPaneImages: (paneId, activeRelativePaths) => {
    set((state) => {
      const current = state.imagesByPane[paneId] ?? [];

      if (current.length === 0) {
        return state;
      }

      const activePathSet = new Set(activeRelativePaths.map(normalizeRelativePath));
      const confirmedSet = new Set(state.confirmedInPromptByPane[paneId] ?? []);
      const now = Date.now();

      for (const pathValue of activeRelativePaths) {
        confirmedSet.add(normalizeRelativePath(pathValue));
      }

      const next = current.filter((image) => {
        if (activePathSet.has(image.relativePath)) {
          return true;
        }

        return now - image.addedAt < PASTE_GRACE_MS;
      });

      const nextConfirmed = [...confirmedSet]
        .filter((pathValue) => activePathSet.has(pathValue) || next.some((image) => image.relativePath === pathValue))
        .sort((left, right) => left.localeCompare(right));

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
