import { create } from 'zustand';

interface AgentComposerDraftState {
  draftByPane: Record<string, string>;
  draftProjectByPane: Record<string, string>;
  projectIdsWithDraft: Record<string, true>;
  setDraft: (paneId: string, projectId: string, value: string) => void;
  clearDraft: (paneId: string) => void;
  getDraft: (paneId: string) => string;
}

function rebuildProjectIdsWithDraft(
  draftByPane: Record<string, string>,
  draftProjectByPane: Record<string, string>,
): Record<string, true> {
  const next: Record<string, true> = {};

  for (const [paneId, value] of Object.entries(draftByPane)) {
    if (!value.trim()) {
      continue;
    }

    const projectId = draftProjectByPane[paneId];

    if (projectId) {
      next[projectId] = true;
    }
  }

  return next;
}

export const useAgentComposerDraftStore = create<AgentComposerDraftState>((set, get) => ({
  draftByPane: {},
  draftProjectByPane: {},
  projectIdsWithDraft: {},
  setDraft: (paneId, projectId, value) => {
    const trimmed = value.trim();

    if (!trimmed) {
      get().clearDraft(paneId);
      return;
    }

    set((state) => {
      const draftByPane = {
        ...state.draftByPane,
        [paneId]: value,
      };
      const draftProjectByPane = {
        ...state.draftProjectByPane,
        [paneId]: projectId,
      };

      return {
        draftByPane,
        draftProjectByPane,
        projectIdsWithDraft: rebuildProjectIdsWithDraft(draftByPane, draftProjectByPane),
      };
    });
  },
  clearDraft: (paneId) => {
    set((state) => {
      if (!(paneId in state.draftByPane)) {
        return state;
      }

      const draftByPane = { ...state.draftByPane };
      const draftProjectByPane = { ...state.draftProjectByPane };
      delete draftByPane[paneId];
      delete draftProjectByPane[paneId];

      return {
        draftByPane,
        draftProjectByPane,
        projectIdsWithDraft: rebuildProjectIdsWithDraft(draftByPane, draftProjectByPane),
      };
    });
  },
  getDraft: (paneId) => get().draftByPane[paneId] ?? '',
}));
