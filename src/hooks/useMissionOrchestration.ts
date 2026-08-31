import { useEffect, useRef } from 'react';
import { useMissionStore } from '@/stores/useMissionStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTabActions } from '@/stores/useTabStore';
import {
  handleMissionNodeTurnFinished,
  hasSuccessfulMissionAgentTurn,
  isFailedMissionAgentTurn,
  resolveMissionAgentOwnedTurn,
} from '@/utils/missionOrchestrator';
import { detectMissionWriteConflicts, ensureMissionNodeWorktree } from '@/utils/missionWorktree';
import { isMissionRootNode } from '@/utils/missionHelpers';
import { resolveAgentLaunchCommand } from '@/utils/resolveAgentLaunchCommand';
import { findPaneTab } from '@/utils/tabGroups';

export function useMissionOrchestration(): void {
  const missions = useMissionStore((state) => state.missions);
  const upsertNode = useMissionStore((state) => state.upsertNode);
  const upsertInboxItem = useMissionStore((state) => state.upsertInboxItem);
  const { addAgentTabForProject } = useTabActions();
  const seenTurnKeysRef = useRef(new Set<string>());

  useEffect(() => {
    const projects = useProjectStore.getState().projects;

    for (const mission of missions) {
      const shouldTrack =
        mission.status === 'running' ||
        mission.status === 'paused' ||
        mission.status === 'failed' ||
        mission.nodes.some(
          (node) =>
            node.status === 'running' || node.status === 'failed' || node.status === 'blocked',
        );

      if (!shouldTrack) {
        continue;
      }

      for (const node of mission.nodes) {
        if (isMissionRootNode(node) || !node.paneId) {
          continue;
        }

        if (node.status !== 'running' && node.status !== 'failed' && node.status !== 'blocked') {
          continue;
        }

        const project = projects.find((entry) => entry.id === node.projectId);
        if (!project) {
          continue;
        }

        const pane = findPaneTab(project.tabs, node.paneId);
        if (!pane || pane.type !== 'agent') {
          continue;
        }

        const latest = resolveMissionAgentOwnedTurn(node.paneId, pane.turns, node);
        if (!latest || latest.running) {
          continue;
        }

        const successful = hasSuccessfulMissionAgentTurn(latest);
        const failed = isFailedMissionAgentTurn(latest);

        if (node.status === 'failed' || node.status === 'blocked') {
          if (!successful) {
            continue;
          }
        }

        if (!successful && !failed && latest.activities.length > 0) {
          continue;
        }

        const key = `${mission.id}:${node.id}:${latest.id}:${successful ? 'ok' : 'fail'}`;
        if (seenTurnKeysRef.current.has(key)) {
          continue;
        }

        seenTurnKeysRef.current.add(key);

        if (mission.status === 'paused' || (mission.status === 'failed' && successful)) {
          void useMissionStore.getState().updateMission(mission.id, {
            status: 'running',
            completedAt: undefined,
            result: undefined,
          });
        }

        const markFailed = !successful;

        void handleMissionNodeTurnFinished({
          missionId: mission.id,
          nodeId: node.id,
          failed: markFailed,
          errorMessage: markFailed
            ? latest.activities.find((activity) => activity.kind === 'status')?.label ||
              'Agent finalizou sem resultado útil.'
            : undefined,
          addAgentTabForProject: async (projectId) => {
            const target = useProjectStore
              .getState()
              .projects.find((entry) => entry.id === projectId);
            if (!target) {
              return null;
            }
            const command = await resolveAgentLaunchCommand(target.path, node.aiProvider);
            return addAgentTabForProject(projectId, command);
          },
        });
      }

      if (mission.status !== 'running') {
        continue;
      }

      const conflicts = detectMissionWriteConflicts(mission);
      for (const conflict of conflicts) {
        const existing = mission.inbox.find(
          (item) =>
            item.kind === 'conflict' &&
            !item.resolvedAt &&
            item.message.includes(conflict.projectId),
        );

        if (existing) {
          continue;
        }

        void upsertInboxItem(mission.id, {
          id: crypto.randomUUID(),
          missionId: mission.id,
          kind: 'conflict',
          title: 'Conflito potencial',
          message: `Dois agents estão executando no mesmo projeto (${conflict.projectId}). Escolha esperar, branch separada ou continuar.`,
          createdAt: new Date().toISOString(),
          actions: [
            { id: 'approve', label: 'Continuar' },
            { id: 'reject', label: 'Pausar' },
          ],
        });
      }
    }
  }, [addAgentTabForProject, missions, upsertInboxItem]);

  useEffect(() => {
    for (const mission of missions) {
      if (mission.status !== 'running') {
        continue;
      }

      for (const node of mission.nodes) {
        if (node.status !== 'running' || node.worktreePath) {
          continue;
        }

        const roleWantsWrite =
          node.roleId === 'role-execution' ||
          node.roleId === 'role-documentation' ||
          node.roleId === 'role-deploy';

        if (!roleWantsWrite) {
          continue;
        }

        const project = useProjectStore
          .getState()
          .projects.find((entry) => entry.id === node.projectId);
        if (!project) {
          continue;
        }

        const missionId = mission.id;
        const nodeId = node.id;

        void ensureMissionNodeWorktree({ project, mission, node }).then((worktree) => {
          if (!worktree) {
            return;
          }

          const current = useMissionStore
            .getState()
            .getMissionById(missionId)
            ?.nodes.find((entry) => entry.id === nodeId);

          if (!current) {
            return;
          }

          void upsertNode(missionId, {
            ...current,
            worktreePath: worktree.path,
            worktreeBranch: worktree.branch,
          });
        });
      }
    }
  }, [missions, upsertNode]);
}
