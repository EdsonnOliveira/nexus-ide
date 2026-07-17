import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import {
  captureGitSnapshot,
  diffGitSnapshots,
  diffGitSnapshotsLoose,
  resolveRepoPathForAgentTurn,
  toIncrementalDeltaFiles,
  type GitSnapshotDelta,
} from '@/utils/agentGitDiff';
import { useProjectStore } from '@/stores/useProjectStore';
import type { AgentGitChangeGroup } from '@/types/agentGit';
import { emitGitProjectRefresh, emitGitRepoRefresh } from '@/utils/gitRepoRefresh';
import type { GitFlatChange } from '@/utils/gitFlatChanges';
import { findProjectIdByPaneId } from '@/utils/findProjectIdByPaneId';
import { findGitFlatChangeByPath } from '@/utils/gitPaths';
import { schedulePersistAgentGitGroups } from '@/utils/persistAgentGitGroups';
import { sanitizeAgentPrompt } from '@/utils/terminalShellPrompt';

interface PendingAgentGitTurn {
  prompt: string;
  snapshot: GitFlatChange[] | null;
  projectId: string;
  repoPath: string;
}

export type { AgentGitChangeGroup } from '@/types/agentGit';

interface AgentGitChangeState {
  groupsByProject: Record<string, AgentGitChangeGroup[]>;
  pendingTurnByPane: Record<string, PendingAgentGitTurn>;
  lastPromptByPane: Record<string, string>;
  focusedGroupId: string | null;
  rememberPrompt: (paneId: string, prompt: string) => void;
  beginTurn: (
    paneId: string,
    projectId: string,
    prompt: string,
    repoPath: string,
  ) => Promise<void>;
  finalizeTurn: (paneId: string) => Promise<void>;
  clearPendingTurn: (paneId: string) => PendingAgentGitTurn | null;
  removeGroups: (projectId: string, groupIds: string[]) => void;
  clearProject: (projectId: string) => void;
  setFocusedGroupId: (groupId: string | null) => void;
  pruneGroupsForChanges: (projectId: string, activeChanges: GitFlatChange[]) => void;
}

const FINALIZE_SNAPSHOT_DELAY_MS = 500;
const FINALIZE_SNAPSHOT_RETRY_DELAY_MS = 600;
const PENDING_SNAPSHOT_WAIT_MS = 50;
const PENDING_SNAPSHOT_MAX_ATTEMPTS = 40;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForPendingSnapshot(
  paneId: string,
  readPending: () => Record<string, PendingAgentGitTurn>,
): Promise<PendingAgentGitTurn | null> {
  for (let attempt = 0; attempt < PENDING_SNAPSHOT_MAX_ATTEMPTS; attempt += 1) {
    const pending = readPending()[paneId];

    if (!pending) {
      return null;
    }

    if (pending.snapshot !== null) {
      return pending;
    }

    await delay(PENDING_SNAPSHOT_WAIT_MS);
  }

  return readPending()[paneId] ?? null;
}

async function refreshProjectGitCounts(projectId: string, fallbackRepoPath?: string | null): Promise<void> {
  const project = useProjectStore.getState().projects.find((entry) => entry.id === projectId);

  if (project) {
    await emitGitProjectRefresh(project.path);
    return;
  }

  if (fallbackRepoPath) {
    await emitGitRepoRefresh(fallbackRepoPath);
  }
}

const EMPTY_AGENT_GIT_GROUPS: AgentGitChangeGroup[] = [];

export function selectAgentGitGroupsForProject(
  state: AgentGitChangeState,
  projectId: string,
): AgentGitChangeGroup[] {
  const fromStore = state.groupsByProject[projectId];

  if (fromStore && fromStore.length > 0) {
    return fromStore;
  }

  const project = useProjectStore.getState().projects.find((entry) => entry.id === projectId);

  return project?.agentGitGroups ?? EMPTY_AGENT_GIT_GROUPS;
}

export function useAgentGitGroupsForProject(projectId: string): AgentGitChangeGroup[] {
  return useAgentGitChangeStore(
    useShallow((state) => selectAgentGitGroupsForProject(state, projectId)),
  );
}

function createGroupId(): string {
  return `agent-git-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function appendGroup(
  groupsByProject: Record<string, AgentGitChangeGroup[]>,
  group: AgentGitChangeGroup,
): Record<string, AgentGitChangeGroup[]> {
  const existing = groupsByProject[group.projectId] ?? [];

  return {
    ...groupsByProject,
    [group.projectId]: [group, ...existing],
  };
}

function createGroupFromDelta(
  paneId: string,
  projectId: string,
  prompt: string,
  delta: GitSnapshotDelta,
): AgentGitChangeGroup | null {
  if (delta.fileCount === 0) {
    return null;
  }

  return {
    id: createGroupId(),
    paneId,
    projectId,
    prompt: sanitizeAgentPrompt(prompt),
    files: delta.files,
    additions: delta.additions,
    deletions: delta.deletions,
    completedAt: Date.now(),
  };
}

async function createFallbackGroup(
  paneId: string,
  prompt: string,
  projectId: string,
  repoPath: string,
): Promise<AgentGitChangeGroup | null> {
  const snapshot = await captureGitSnapshot(repoPath);
  const additions = snapshot.reduce((sum, change) => sum + change.additions, 0);
  const deletions = snapshot.reduce((sum, change) => sum + change.deletions, 0);

  return createGroupFromDelta(paneId, projectId, prompt, {
    files: snapshot,
    additions,
    deletions,
    fileCount: snapshot.length,
  });
}

function buildIncrementalDelta(
  beforeSnapshot: GitFlatChange[],
  files: GitFlatChange[],
): GitSnapshotDelta {
  const incrementalFiles = toIncrementalDeltaFiles(beforeSnapshot, files);

  return {
    files: incrementalFiles,
    additions: incrementalFiles.reduce((sum, change) => sum + change.additions, 0),
    deletions: incrementalFiles.reduce((sum, change) => sum + change.deletions, 0),
    fileCount: incrementalFiles.length,
  };
}

function resolveTurnDelta(beforeSnapshot: GitFlatChange[], afterSnapshot: GitFlatChange[]): GitSnapshotDelta {
  const strictDelta = diffGitSnapshots(beforeSnapshot, afterSnapshot);

  if (strictDelta.fileCount > 0) {
    return buildIncrementalDelta(beforeSnapshot, strictDelta.files);
  }

  const looseDelta = diffGitSnapshotsLoose(beforeSnapshot, afterSnapshot);

  if (looseDelta.fileCount > 0) {
    return buildIncrementalDelta(beforeSnapshot, looseDelta.files);
  }

  const beforePaths = new Set(beforeSnapshot.map((change) => change.path));
  const newFiles = afterSnapshot.filter((change) => !beforePaths.has(change.path));

  return {
    files: newFiles,
    additions: newFiles.reduce((sum, change) => sum + change.additions, 0),
    deletions: newFiles.reduce((sum, change) => sum + change.deletions, 0),
    fileCount: newFiles.length,
  };
}

export const useAgentGitChangeStore = create<AgentGitChangeState>((set, get) => ({
  groupsByProject: {},
  pendingTurnByPane: {},
  lastPromptByPane: {},
  focusedGroupId: null,
  rememberPrompt: (paneId, prompt) => {
    set((state) => ({
      lastPromptByPane: {
        ...state.lastPromptByPane,
        [paneId]: prompt,
      },
    }));
  },
  beginTurn: async (paneId, projectId, prompt, repoPath) => {
    set((state) => ({
      pendingTurnByPane: {
        ...state.pendingTurnByPane,
        [paneId]: {
          prompt,
          snapshot: null,
          projectId,
          repoPath,
        },
      },
    }));

    try {
      const snapshot = await captureGitSnapshot(repoPath);

      set((state) => {
        const pending = state.pendingTurnByPane[paneId];

        if (!pending) {
          return state;
        }

        return {
          pendingTurnByPane: {
            ...state.pendingTurnByPane,
            [paneId]: {
              ...pending,
              snapshot,
            },
          },
        };
      });
    } catch {
      set((state) => {
        const nextPending = { ...state.pendingTurnByPane };
        delete nextPending[paneId];
        return { pendingTurnByPane: nextPending };
      });
    }
  },
  finalizeTurn: async (paneId) => {
    let pending = await waitForPendingSnapshot(paneId, () => get().pendingTurnByPane);
    let repoPathForRefresh: string | null = pending?.repoPath ?? null;
    const projectIdForRefresh = pending?.projectId ?? findProjectIdByPaneId(paneId);

    if (!pending || pending.snapshot === null) {
      const fallbackPrompt = get().lastPromptByPane[paneId];
      const projectId = projectIdForRefresh;

      if (fallbackPrompt && projectId) {
        const project = useProjectStore.getState().projects.find((entry) => entry.id === projectId);

        if (project) {
          const repoPath = await resolveRepoPathForAgentTurn(project.path, paneId);

          if (repoPath) {
            try {
              const fallbackGroup = await createFallbackGroup(
                paneId,
                fallbackPrompt,
                projectId,
                repoPath,
              );

              if (fallbackGroup) {
                repoPathForRefresh = repoPath;
                set((state) => ({
                  groupsByProject: appendGroup(state.groupsByProject, fallbackGroup),
                  focusedGroupId: fallbackGroup.id,
                }));
                schedulePersistAgentGitGroups(projectId);
              }
            } catch {
              // ignore fallback failures
            }
          }
        }
      }

      set((state) => {
        const nextPending = { ...state.pendingTurnByPane };
        const nextPrompts = { ...state.lastPromptByPane };
        delete nextPending[paneId];
        delete nextPrompts[paneId];
        return { pendingTurnByPane: nextPending, lastPromptByPane: nextPrompts };
      });

      if (repoPathForRefresh || projectIdForRefresh) {
        await refreshProjectGitCounts(projectIdForRefresh ?? '', repoPathForRefresh);
      }

      return;
    }

    const beforeSnapshot = pending.snapshot;

    await delay(FINALIZE_SNAPSHOT_DELAY_MS);

    try {
      let afterSnapshot = await captureGitSnapshot(pending.repoPath);
      let delta = resolveTurnDelta(beforeSnapshot, afterSnapshot);

      if (delta.fileCount === 0) {
        await delay(FINALIZE_SNAPSHOT_RETRY_DELAY_MS);
        afterSnapshot = await captureGitSnapshot(pending.repoPath);
        delta = resolveTurnDelta(beforeSnapshot, afterSnapshot);
      }

      const group = createGroupFromDelta(paneId, pending.projectId, pending.prompt, delta);

      if (group) {
        set((state) => ({
          groupsByProject: appendGroup(state.groupsByProject, group),
          focusedGroupId: group.id,
        }));
        schedulePersistAgentGitGroups(pending.projectId);
      }
    } catch {
      // ignore snapshot failures
    } finally {
      set((state) => {
        const nextPending = { ...state.pendingTurnByPane };
        const nextPrompts = { ...state.lastPromptByPane };
        delete nextPending[paneId];
        delete nextPrompts[paneId];
        return { pendingTurnByPane: nextPending, lastPromptByPane: nextPrompts };
      });

      await refreshProjectGitCounts(pending.projectId, pending.repoPath);
    }
  },
  clearPendingTurn: (paneId) => {
    const pending = get().pendingTurnByPane[paneId] ?? null;

    if (!pending) {
      return null;
    }

    set((state) => {
      const nextPending = { ...state.pendingTurnByPane };
      const nextPrompts = { ...state.lastPromptByPane };
      delete nextPending[paneId];
      delete nextPrompts[paneId];
      return { pendingTurnByPane: nextPending, lastPromptByPane: nextPrompts };
    });

    return pending;
  },
  removeGroups: (projectId, groupIds) => {
    if (groupIds.length === 0) {
      return;
    }

    const removed = new Set(groupIds);

    set((state) => {
      const current = state.groupsByProject[projectId] ?? [];
      const nextGroups = current.filter((group) => !removed.has(group.id));

      if (nextGroups.length === current.length) {
        return state;
      }

      return {
        groupsByProject: {
          ...state.groupsByProject,
          [projectId]: nextGroups,
        },
        focusedGroupId:
          state.focusedGroupId && removed.has(state.focusedGroupId) ? null : state.focusedGroupId,
      };
    });

    schedulePersistAgentGitGroups(projectId);
  },
  clearProject: (projectId) => {
    set((state) => {
      const nextGroups = { ...state.groupsByProject };
      const removedGroupIds = new Set(
        (state.groupsByProject[projectId] ?? []).map((group) => group.id),
      );
      delete nextGroups[projectId];

      const nextPending = { ...state.pendingTurnByPane };

      for (const [paneId, turn] of Object.entries(nextPending)) {
        if (turn.projectId === projectId) {
          delete nextPending[paneId];
        }
      }

      return {
        groupsByProject: nextGroups,
        pendingTurnByPane: nextPending,
        focusedGroupId:
          state.focusedGroupId && removedGroupIds.has(state.focusedGroupId)
            ? null
            : state.focusedGroupId,
      };
    });
    schedulePersistAgentGitGroups(projectId);
  },
  setFocusedGroupId: (groupId) => {
    set((state) => {
      if (state.focusedGroupId === groupId) {
        return state;
      }

      return { focusedGroupId: groupId };
    });
  },
  pruneGroupsForChanges: (projectId, activeChanges) => {
    set((state) => {
      const current = state.groupsByProject[projectId];

      if (!current || current.length === 0) {
        return state;
      }

      let changed = false;
      const nextGroups = current
        .map((group) => {
          const files = group.files
            .map((file) => {
              const live = findGitFlatChangeByPath(activeChanges, file.path);

              if (!live) {
                return null;
              }

              return {
                ...file,
                path: live.path,
                status: live.status,
                staged: live.staged,
                additions: live.additions,
                deletions: live.deletions,
              };
            })
            .filter((file): file is AgentGitChangeGroup['files'][number] => file !== null);

          if (files.length !== group.files.length) {
            changed = true;
          }

          if (files.length === 0) {
            return null;
          }

          const additions = files.reduce((sum, file) => sum + file.additions, 0);
          const deletions = files.reduce((sum, file) => sum + file.deletions, 0);

          if (additions !== group.additions || deletions !== group.deletions) {
            changed = true;
          }

          return {
            ...group,
            files,
            additions,
            deletions,
          };
        })
        .filter((group): group is AgentGitChangeGroup => group !== null);

      if (!changed && nextGroups.length === current.length) {
        return state;
      }

      schedulePersistAgentGitGroups(projectId);

      return {
        groupsByProject: {
          ...state.groupsByProject,
          [projectId]: nextGroups,
        },
      };
    });
  },
}));
