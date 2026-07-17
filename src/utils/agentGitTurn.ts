import {
  selectAgentGitGroupsForProject,
  useAgentGitChangeStore,
} from '@/stores/useAgentGitChangeStore';
import { useProjectStore } from '@/stores/useProjectStore';
import {
  captureGitSnapshot,
  diffGitSnapshots,
  diffGitSnapshotsLoose,
  resolveRepoPathForAgentTurn,
} from '@/utils/agentGitDiff';
import { findProjectIdByPaneId } from '@/utils/findProjectIdByPaneId';
import { emitGitProjectRefresh, emitGitRepoRefresh } from '@/utils/gitRepoRefresh';
import { persistTerminalCommand } from '@/utils/persistTerminalSession';
import { isProjectSwitching } from '@/utils/projectSwitch';
import { resolvePaneAgentForGitTurn } from '@/utils/projectAgentStatus';
import { sanitizeAgentPrompt } from '@/utils/terminalShellPrompt';
import type { AgentGitChangeGroup, AgentTurn } from '@/types';

const finalizeTurnInFlight = new Map<string, Promise<void>>();
const deferredFinalizePaneIds = new Set<string>();

function collectChangedPaths(
  beforeSnapshot: Awaited<ReturnType<typeof captureGitSnapshot>>,
  afterSnapshot: Awaited<ReturnType<typeof captureGitSnapshot>>,
): string[] {
  const strict = diffGitSnapshots(beforeSnapshot, afterSnapshot);

  if (strict.fileCount > 0) {
    return strict.files.map((file) => file.path);
  }

  const loose = diffGitSnapshotsLoose(beforeSnapshot, afterSnapshot);

  if (loose.fileCount > 0) {
    return loose.files.map((file) => file.path);
  }

  const beforePaths = new Set(beforeSnapshot.map((change) => change.path));
  return afterSnapshot
    .filter((change) => !beforePaths.has(change.path))
    .map((change) => change.path);
}

async function beginAgentGitTurn(paneId: string, prompt: string): Promise<void> {
  const projectId = findProjectIdByPaneId(paneId);

  if (!projectId) {
    return;
  }

  const project = useProjectStore.getState().projects.find((entry) => entry.id === projectId);

  if (!project) {
    return;
  }

  const repoPath = await resolveRepoPathForAgentTurn(project.path, paneId);

  if (!repoPath) {
    return;
  }

  await useAgentGitChangeStore.getState().beginTurn(paneId, projectId, prompt, repoPath);
}

function runFinalizeAgentGitTurn(paneId: string): void {
  const existing = finalizeTurnInFlight.get(paneId);

  if (existing) {
    return;
  }

  const task = useAgentGitChangeStore.getState().finalizeTurn(paneId);
  finalizeTurnInFlight.set(paneId, task);

  void task.finally(() => {
    if (finalizeTurnInFlight.get(paneId) === task) {
      finalizeTurnInFlight.delete(paneId);
    }
  });
}

export function trackAgentGitPrompt(paneId: string, prompt: string): void {
  const trimmed = sanitizeAgentPrompt(prompt);

  if (!trimmed || trimmed.startsWith('/')) {
    return;
  }

  void (async () => {
    const { useTerminalSessionStore } = await import('@/stores/useTerminalSessionStore');
    const session = useTerminalSessionStore.getState();
    const activeAgent = resolvePaneAgentForGitTurn(
      paneId,
      useProjectStore.getState().projects,
      session.activeAgentByPane,
    );

    if (!activeAgent) {
      return;
    }

    if (!session.activeAgentByPane[paneId]) {
      session.setActiveAgent(paneId, activeAgent);
    }

    persistTerminalCommand(paneId, trimmed);
    useAgentGitChangeStore.getState().rememberPrompt(paneId, trimmed);
    await beginAgentGitTurn(paneId, trimmed);
  })();
}

export function completeAgentGitTurn(paneId: string): void {
  if (isProjectSwitching()) {
    deferredFinalizePaneIds.add(paneId);
    return;
  }

  runFinalizeAgentGitTurn(paneId);
}

export async function drainDeferredAgentGitTurns(): Promise<void> {
  if (deferredFinalizePaneIds.size === 0) {
    return;
  }

  const paneIds = [...deferredFinalizePaneIds];
  deferredFinalizePaneIds.clear();

  for (const paneId of paneIds) {
    runFinalizeAgentGitTurn(paneId);
  }
}

function resolveTurnPrompt(turn: AgentTurn): string {
  return sanitizeAgentPrompt(turn.user.agentPrompt ?? turn.user.content);
}

function findGroupForTurn(
  groups: AgentGitChangeGroup[],
  paneId: string,
  turn: AgentTurn,
): AgentGitChangeGroup | null {
  const paneGroups = groups.filter(
    (group) => group.paneId === paneId && group.files.length > 0,
  );

  if (paneGroups.length === 0) {
    return null;
  }

  const prompt = resolveTurnPrompt(turn);
  const byPrompt = prompt
    ? paneGroups.filter((group) => sanitizeAgentPrompt(group.prompt) === prompt)
    : [];

  if (byPrompt.length === 1) {
    return byPrompt[0] ?? null;
  }

  if (byPrompt.length > 1) {
    const next = [...byPrompt].sort(
      (left, right) =>
        Math.abs(left.completedAt - turn.startedAt) - Math.abs(right.completedAt - turn.startedAt),
    );
    return next[0] ?? null;
  }

  const editedPaths = new Set(
    (turn.summary?.editedFiles ?? []).map((file) => file.path.trim()).filter(Boolean),
  );

  if (editedPaths.size > 0) {
    const matched = paneGroups.find((group) =>
      group.files.some((file) => editedPaths.has(file.path)),
    );

    if (matched) {
      return matched;
    }
  }

  if (
    turn.summary &&
    (turn.summary.additions > 0 || turn.summary.deletions > 0)
  ) {
    const matched = paneGroups.find(
      (group) =>
        group.additions === turn.summary?.additions &&
        group.deletions === turn.summary?.deletions,
    );

    if (matched) {
      return matched;
    }
  }

  return null;
}

export async function revertAgentGitChangesForTurn(options: {
  paneId: string;
  projectPath: string;
  turn: AgentTurn;
  isActiveOrPendingTurn?: boolean;
}): Promise<void> {
  const { paneId, projectPath, turn, isActiveOrPendingTurn = false } = options;
  const projectId = findProjectIdByPaneId(paneId);
  const store = useAgentGitChangeStore.getState();
  const paths = new Set<string>();
  const groupIds: string[] = [];
  let repoPath: string | null = null;

  if (isActiveOrPendingTurn) {
    const pending = store.clearPendingTurn(paneId);
    repoPath = pending?.repoPath ?? null;

    if (pending?.snapshot) {
      try {
        const afterSnapshot = await captureGitSnapshot(pending.repoPath);

        for (const path of collectChangedPaths(pending.snapshot, afterSnapshot)) {
          paths.add(path);
        }
      } catch {
        // ignore pending snapshot failures
      }
    }
  }

  if (projectId) {
    const group = findGroupForTurn(
      selectAgentGitGroupsForProject(store, projectId),
      paneId,
      turn,
    );

    if (group) {
      groupIds.push(group.id);

      for (const file of group.files) {
        paths.add(file.path);
      }
    }
  }

  for (const file of turn.summary?.editedFiles ?? []) {
    const trimmed = file.path.trim();

    if (trimmed) {
      paths.add(trimmed);
    }
  }

  if (!repoPath) {
    repoPath = await resolveRepoPathForAgentTurn(projectPath, paneId);
  }

  if (repoPath && paths.size > 0) {
    await window.nexus.git.discard(repoPath, [...paths]).catch(() => undefined);
  }

  if (projectId && groupIds.length > 0) {
    useAgentGitChangeStore.getState().removeGroups(projectId, groupIds);
  }

  if (projectId) {
    await emitGitProjectRefresh(projectPath).catch(() => undefined);
  } else if (repoPath) {
    await emitGitRepoRefresh(repoPath).catch(() => undefined);
  }
}
