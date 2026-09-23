import { create } from 'zustand';

export type AgentShellTerminalStatus = 'starting' | 'running' | 'completed' | 'failed';

export type AgentShellTerminalKind = 'interactive' | 'tool';

export interface AgentShellTerminalEntry {
  paneId: string;
  kind: AgentShellTerminalKind;
  command: string;
  title: string;
  cwd: string;
  startedAt: number;
  status: AgentShellTerminalStatus;
  exitCode: number | null;
  ptyId: string | null;
  commandDispatched: boolean;
  dispatchedAt: number | null;
  launchRetryCount: number;
}

type AgentShellTerminalEntryPatch = Partial<
  Pick<
    AgentShellTerminalEntry,
    | 'status'
    | 'exitCode'
    | 'ptyId'
    | 'title'
    | 'commandDispatched'
    | 'dispatchedAt'
    | 'launchRetryCount'
  >
>;

interface AgentShellTerminalStoreState {
  entriesByAgentPane: Record<string, AgentShellTerminalEntry[]>;
  addEntry: (agentPaneId: string, entry: AgentShellTerminalEntry) => void;
  updateEntry: (agentPaneId: string, paneId: string, patch: AgentShellTerminalEntryPatch) => void;
  removeEntry: (agentPaneId: string, paneId: string) => void;
  clearEntries: (agentPaneId: string) => AgentShellTerminalEntry[];
  getEntries: (agentPaneId: string) => AgentShellTerminalEntry[];
}

const EMPTY_ENTRIES: AgentShellTerminalEntry[] = [];

export const useAgentShellTerminalStore = create<AgentShellTerminalStoreState>((set, get) => ({
  entriesByAgentPane: {},

  addEntry: (agentPaneId, entry) => {
    set((state) => {
      const current = state.entriesByAgentPane[agentPaneId] ?? [];

      if (current.some((item) => item.paneId === entry.paneId)) {
        return state;
      }

      return {
        entriesByAgentPane: {
          ...state.entriesByAgentPane,
          [agentPaneId]: [...current, entry],
        },
      };
    });
  },

  updateEntry: (agentPaneId, paneId, patch) => {
    set((state) => {
      const current = state.entriesByAgentPane[agentPaneId];

      if (!current?.length) {
        return state;
      }

      return {
        entriesByAgentPane: {
          ...state.entriesByAgentPane,
          [agentPaneId]: current.map((entry) =>
            entry.paneId === paneId ? { ...entry, ...patch } : entry,
          ),
        },
      };
    });
  },

  removeEntry: (agentPaneId, paneId) => {
    set((state) => {
      const current = state.entriesByAgentPane[agentPaneId];

      if (!current?.length) {
        return state;
      }

      const next = current.filter((entry) => entry.paneId !== paneId);

      if (next.length === current.length) {
        return state;
      }

      const entriesByAgentPane = { ...state.entriesByAgentPane };

      if (next.length === 0) {
        delete entriesByAgentPane[agentPaneId];
      } else {
        entriesByAgentPane[agentPaneId] = next;
      }

      return { entriesByAgentPane };
    });
  },

  clearEntries: (agentPaneId) => {
    const current = get().entriesByAgentPane[agentPaneId] ?? EMPTY_ENTRIES;

    if (!current.length) {
      return EMPTY_ENTRIES;
    }

    set((state) => {
      const entriesByAgentPane = { ...state.entriesByAgentPane };
      delete entriesByAgentPane[agentPaneId];
      return { entriesByAgentPane };
    });

    return current;
  },

  getEntries: (agentPaneId) => get().entriesByAgentPane[agentPaneId] ?? EMPTY_ENTRIES,
}));

export function useAgentShellTerminalEntries(agentPaneId: string): AgentShellTerminalEntry[] {
  return useAgentShellTerminalStore(
    (state) => state.entriesByAgentPane[agentPaneId] ?? EMPTY_ENTRIES,
  );
}
