import { create } from 'zustand';

export interface ShellCommandHistoryEntry {
  command: string;
  runAt: number;
}

interface ShellCommandHistoryState {
  entriesByProject: Record<string, ShellCommandHistoryEntry[]>;
  getEntries: (projectPath: string) => ShellCommandHistoryEntry[];
  push: (projectPath: string, command: string) => void;
}

const STORAGE_KEY = 'nexus-shell-command-history';
const MAX_ENTRIES = 10;

function readEntriesByProject(): Record<string, ShellCommandHistoryEntry[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, ShellCommandHistoryEntry[]>;

    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    const next: Record<string, ShellCommandHistoryEntry[]> = {};

    for (const [projectPath, entries] of Object.entries(parsed)) {
      if (!Array.isArray(entries)) {
        continue;
      }

      next[projectPath] = entries
        .filter(
          (entry): entry is ShellCommandHistoryEntry =>
            Boolean(entry) &&
            typeof entry.command === 'string' &&
            entry.command.trim().length > 0 &&
            typeof entry.runAt === 'number',
        )
        .slice(0, MAX_ENTRIES);
    }

    return next;
  } catch {
    return {};
  }
}

function writeEntriesByProject(entriesByProject: Record<string, ShellCommandHistoryEntry[]>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entriesByProject));
  } catch {
    return;
  }
}

export const useShellCommandHistoryStore = create<ShellCommandHistoryState>((set, get) => ({
  entriesByProject: readEntriesByProject(),
  getEntries: (projectPath) => get().entriesByProject[projectPath] ?? [],
  push: (projectPath, command) => {
    const trimmed = command.trim();

    if (!projectPath || !trimmed) {
      return;
    }

    set((state) => {
      const current = state.entriesByProject[projectPath] ?? [];
      const withoutDuplicate = current.filter((entry) => entry.command !== trimmed);
      const nextEntries = [{ command: trimmed, runAt: Date.now() }, ...withoutDuplicate].slice(
        0,
        MAX_ENTRIES,
      );
      const entriesByProject = {
        ...state.entriesByProject,
        [projectPath]: nextEntries,
      };

      writeEntriesByProject(entriesByProject);

      return { entriesByProject };
    });
  },
}));
