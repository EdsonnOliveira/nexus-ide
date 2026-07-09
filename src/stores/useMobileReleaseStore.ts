import { create } from 'zustand';
import type { MobileActiveRelease, MobileReleaseKind, MobileReleaseState } from '@/types';

const HISTORY_STORAGE_KEY = 'nexus-mobile-releases-history';
const DISMISSED_UID_STORAGE_KEY = 'nexus-mobile-dismissed-release-uid';
const MAX_HISTORY_PER_PROJECT = 20;
const LOG_TAIL_MAX = 16_384;
const VISIBLE_FINISHED_MS = 10 * 60 * 1000;

interface MobileReleaseHistoryEntry extends MobileActiveRelease {}

interface MobileReleaseStoreState {
  releases: Record<string, MobileActiveRelease>;
  activeUidsByPane: Record<string, string[]>;
  dismissedUids: Set<string>;
  historyByProject: Record<string, MobileReleaseHistoryEntry[]>;
  startRelease: (release: MobileActiveRelease) => void;
  feedOutput: (paneId: string, chunk: string) => void;
  updateRelease: (
    uid: string,
    patch: Partial<
      Pick<
        MobileActiveRelease,
        'state' | 'artifactPath' | 'phase' | 'readyAt' | 'logTail' | 'version' | 'versionCode'
      >
    >,
  ) => void;
  completeRelease: (uid: string, state: MobileReleaseState, artifactPath?: string | null) => void;
  completeBuildingReleasesOnPane: (paneId: string, state: MobileReleaseState) => void;
  dismiss: (uid: string) => void;
  getVisibleReleases: () => MobileActiveRelease[];
  getProjectHistory: (projectId: string) => MobileReleaseHistoryEntry[];
  getReleaseLogs: (uid: string) => string;
}

function readDismissedUids(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_UID_STORAGE_KEY);

    if (!raw) {
      return new Set();
    }

    const parsed = JSON.parse(raw) as string[];

    if (!Array.isArray(parsed)) {
      return new Set();
    }

    return new Set(parsed.filter((entry) => typeof entry === 'string'));
  } catch {
    return new Set();
  }
}

function writeDismissedUids(uids: Set<string>): void {
  try {
    localStorage.setItem(DISMISSED_UID_STORAGE_KEY, JSON.stringify([...uids]));
  } catch {
    return;
  }
}

function readHistoryByProject(): Record<string, MobileReleaseHistoryEntry[]> {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, MobileReleaseHistoryEntry[]>;

    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    return parsed;
  } catch {
    return {};
  }
}

function writeHistoryByProject(history: Record<string, MobileReleaseHistoryEntry[]>): void {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch {
    return;
  }
}

function appendLogTail(current: string, chunk: string): string {
  return (current + chunk).slice(-LOG_TAIL_MAX);
}

function pushHistory(
  historyByProject: Record<string, MobileReleaseHistoryEntry[]>,
  release: MobileActiveRelease,
): Record<string, MobileReleaseHistoryEntry[]> {
  const existing = historyByProject[release.projectId] ?? [];
  const nextEntry: MobileReleaseHistoryEntry = { ...release };
  const filtered = existing.filter((entry) => entry.uid !== release.uid);
  const next = [nextEntry, ...filtered].slice(0, MAX_HISTORY_PER_PROJECT);

  return {
    ...historyByProject,
    [release.projectId]: next,
  };
}

export const useMobileReleaseStore = create<MobileReleaseStoreState>((set, get) => ({
  releases: {},
  activeUidsByPane: {},
  dismissedUids: readDismissedUids(),
  historyByProject: readHistoryByProject(),
  startRelease: (release) => {
    set((state) => {
      const paneUids = state.activeUidsByPane[release.paneId] ?? [];
      const nextDismissed = new Set(state.dismissedUids);
      nextDismissed.delete(release.uid);

      return {
        releases: {
          ...state.releases,
          [release.uid]: release,
        },
        activeUidsByPane: {
          ...state.activeUidsByPane,
          [release.paneId]: [...paneUids.filter((uid) => uid !== release.uid), release.uid],
        },
        dismissedUids: nextDismissed,
      };
    });

    writeDismissedUids(get().dismissedUids);
  },
  feedOutput: (paneId, chunk) => {
    const uids = get().activeUidsByPane[paneId];

    if (!uids?.length) {
      return;
    }

    set((state) => {
      let changed = false;
      const nextReleases = { ...state.releases };

      for (const uid of uids) {
        const release = nextReleases[uid];

        if (!release || release.state !== 'BUILDING') {
          continue;
        }

        nextReleases[uid] = {
          ...release,
          logTail: appendLogTail(release.logTail, chunk),
        };
        changed = true;
      }

      return changed ? { releases: nextReleases } : state;
    });
  },
  updateRelease: (uid, patch) => {
    set((state) => {
      const release = state.releases[uid];

      if (!release) {
        return state;
      }

      return {
        releases: {
          ...state.releases,
          [uid]: {
            ...release,
            ...patch,
            logTail: patch.logTail ?? release.logTail,
          },
        },
      };
    });
  },
  completeRelease: (uid, nextState, artifactPath = null) => {
    set((state) => {
      const release = state.releases[uid];

      if (!release) {
        return state;
      }

      const completed: MobileActiveRelease = {
        ...release,
        state: nextState,
        artifactPath: artifactPath ?? release.artifactPath,
        readyAt: Date.now(),
        phase: null,
      };

      const nextHistory = pushHistory(state.historyByProject, completed);
      writeHistoryByProject(nextHistory);

      const paneUids = (state.activeUidsByPane[release.paneId] ?? []).filter((entry) => entry !== uid);

      return {
        releases: {
          ...state.releases,
          [uid]: completed,
        },
        activeUidsByPane: {
          ...state.activeUidsByPane,
          [release.paneId]: paneUids,
        },
        historyByProject: nextHistory,
      };
    });
  },
  completeBuildingReleasesOnPane: (paneId, nextState) => {
    const uids = get().activeUidsByPane[paneId] ?? [];

    for (const uid of uids) {
      const release = get().releases[uid];

      if (release?.state === 'BUILDING') {
        get().completeRelease(uid, nextState);
      }
    }
  },
  dismiss: (uid) => {
    set((state) => {
      const nextDismissed = new Set(state.dismissedUids);
      nextDismissed.add(uid);
      writeDismissedUids(nextDismissed);

      return {
        dismissedUids: nextDismissed,
      };
    });
  },
  getVisibleReleases: () => {
    const state = get();
    const now = Date.now();

    return Object.values(state.releases).filter((release) => {
      if (state.dismissedUids.has(release.uid)) {
        return false;
      }

      if (release.state === 'BUILDING') {
        return true;
      }

      const finishedAt = release.readyAt ?? release.createdAt;

      return now - finishedAt <= VISIBLE_FINISHED_MS;
    });
  },
  getProjectHistory: (projectId) => {
    return get().historyByProject[projectId] ?? [];
  },
  getReleaseLogs: (uid) => {
    const release = get().releases[uid];
    const historyEntry = Object.values(get().historyByProject)
      .flat()
      .find((entry) => entry.uid === uid);

    const logs = release?.logTail ?? historyEntry?.logTail ?? '';

    return logs.trim() || 'Nenhum log disponível para este release.';
  },
}));

export type { MobileReleaseKind };
