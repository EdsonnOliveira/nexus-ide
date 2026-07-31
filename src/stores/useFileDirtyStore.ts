import { create } from 'zustand';
import type { FileTab, TabBarItem } from '@/types';
import { getPanesFromItem } from '@/utils/tabGroups';

export interface UnsavedCloseRequest {
  tabId: string;
  title: string;
  filePath: string;
  closeAll?: boolean;
}

type SaveHandler = () => Promise<boolean>;

interface FileDirtyState {
  dirtyByTabId: Record<string, boolean>;
  pendingClose: UnsavedCloseRequest | null;
  setDirty: (tabId: string, dirty: boolean) => void;
  registerSaveHandler: (tabId: string, handler: SaveHandler | null) => void;
  isDirty: (tabId: string) => boolean;
  clearTab: (tabId: string) => void;
  findDirtyFileTabs: (item: TabBarItem) => FileTab[];
  setPendingClose: (request: UnsavedCloseRequest | null) => void;
  saveTab: (tabId: string) => Promise<boolean>;
}

const saveHandlersByTabId = new Map<string, SaveHandler>();

export function resolveDirtyFileTabTitle(tab: FileTab): string {
  const trimmed = tab.title.trim();

  if (trimmed) {
    return trimmed;
  }

  const segments = tab.filePath.replace(/\\/g, '/').split('/');
  return segments[segments.length - 1] || tab.filePath;
}

export const useFileDirtyStore = create<FileDirtyState>((set, get) => ({
  dirtyByTabId: {},
  pendingClose: null,
  setDirty: (tabId, dirty) => {
    set((state) => {
      const current = Boolean(state.dirtyByTabId[tabId]);

      if (current === dirty) {
        return state;
      }

      if (!dirty) {
        if (!(tabId in state.dirtyByTabId)) {
          return state;
        }

        const next = { ...state.dirtyByTabId };
        delete next[tabId];
        return { dirtyByTabId: next };
      }

      return {
        dirtyByTabId: {
          ...state.dirtyByTabId,
          [tabId]: true,
        },
      };
    });
  },
  registerSaveHandler: (tabId, handler) => {
    if (!handler) {
      saveHandlersByTabId.delete(tabId);
      return;
    }

    saveHandlersByTabId.set(tabId, handler);
  },
  isDirty: (tabId) => Boolean(get().dirtyByTabId[tabId]),
  clearTab: (tabId) => {
    saveHandlersByTabId.delete(tabId);
    set((state) => {
      if (!(tabId in state.dirtyByTabId) && state.pendingClose?.tabId !== tabId) {
        return state;
      }

      const nextDirty = { ...state.dirtyByTabId };
      delete nextDirty[tabId];

      return {
        dirtyByTabId: nextDirty,
        pendingClose: state.pendingClose?.tabId === tabId ? null : state.pendingClose,
      };
    });
  },
  findDirtyFileTabs: (item) => {
    const dirtyByTabId = get().dirtyByTabId;

    return getPanesFromItem(item).filter(
      (pane): pane is FileTab => pane.type === 'file' && Boolean(dirtyByTabId[pane.id]),
    );
  },
  setPendingClose: (request) => {
    set({ pendingClose: request });
  },
  saveTab: async (tabId) => {
    const handler = saveHandlersByTabId.get(tabId);

    if (!handler) {
      return false;
    }

    const saved = await handler();

    if (saved) {
      get().setDirty(tabId, false);
    }

    return saved;
  },
}));
