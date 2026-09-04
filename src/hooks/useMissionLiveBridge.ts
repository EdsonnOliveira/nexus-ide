import { useEffect } from 'react';
import { useMissionStore } from '@/stores/useMissionStore';
import { useProjectStore } from '@/stores/useProjectStore';
import {
  askLiveAgent,
  listLivePeers,
  listMissionLiveAgents,
  readConnectedNote,
  writeConnectedNote,
} from '@/utils/missionLiveBus';
import { ensureMissionLiveSkillInProject } from '@/utils/missionLiveSkill';

export function useMissionLiveBridge(): void {
  useEffect(() => {
    const api = window.nexus?.missions;
    if (!api?.onLiveRequest || !api.respondLiveRequest) {
      return;
    }

    const unsubscribe = api.onLiveRequest((request) => {
      void (async () => {
        try {
          if (request.type === 'list') {
            const missionId =
              request.missionId ||
              useMissionStore.getState().activeMissionId ||
              useMissionStore.getState().missions.find((mission) => mission.status === 'running')
                ?.id ||
              '';
            const fromNodeId = request.fromNodeId || '';
            const peers = fromNodeId
              ? listLivePeers(missionId, fromNodeId)
              : listMissionLiveAgents(missionId);
            await api.respondLiveRequest({
              id: request.id,
              ok: true,
              result: { ok: true, peers },
            });
            return;
          }

          if (request.type === 'ask') {
            const result = await askLiveAgent({
              missionId: request.missionId || '',
              fromNodeId: request.fromNodeId || '',
              toNameOrId: request.to || '',
              message: request.message || '',
            });
            await api.respondLiveRequest({
              id: request.id,
              ok: result.ok,
              result,
              error: result.error,
            });
            return;
          }

          if (request.type === 'note-read') {
            const result = readConnectedNote({
              missionId: request.missionId || '',
              fromNodeId: request.fromNodeId || '',
              noteNameOrId: request.note || '',
            });
            await api.respondLiveRequest({
              id: request.id,
              ok: result.ok,
              result,
              error: result.error,
            });
            return;
          }

          if (request.type === 'note-write') {
            const result = await writeConnectedNote({
              missionId: request.missionId || '',
              fromNodeId: request.fromNodeId || '',
              noteNameOrId: request.note || '',
              content: request.content || '',
              append: Boolean(request.append),
            });
            await api.respondLiveRequest({
              id: request.id,
              ok: result.ok,
              result,
              error: result.error,
            });
            return;
          }

          await api.respondLiveRequest({
            id: request.id,
            ok: false,
            error: 'unknown_request',
          });
        } catch (error) {
          await api.respondLiveRequest({
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message : 'bridge_handler_error',
          });
        }
      })();
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const syncLiveSkills = () => {
      const missions = useMissionStore.getState().missions;
      const running = missions.filter(
        (mission) => mission.status === 'running' || mission.status === 'paused',
      );
      if (running.length === 0) {
        return;
      }

      const projects = useProjectStore.getState().projects;
      const seen = new Set<string>();
      for (const mission of running) {
        for (const node of mission.nodes) {
          const project = projects.find((entry) => entry.id === node.projectId);
          const projectPath = project?.path?.trim();
          if (!projectPath || seen.has(projectPath)) {
            continue;
          }
          seen.add(projectPath);
          void ensureMissionLiveSkillInProject(projectPath);
        }
      }
    };

    const signatureOf = (missions: ReturnType<typeof useMissionStore.getState>['missions']) =>
      missions
        .filter((mission) => mission.status === 'running' || mission.status === 'paused')
        .map(
          (mission) =>
            `${mission.id}:${mission.status}:${mission.nodes.map((node) => node.projectId).join(',')}`,
        )
        .join('|');

    syncLiveSkills();
    return useMissionStore.subscribe((state, previous) => {
      if (signatureOf(state.missions) === signatureOf(previous.missions)) {
        return;
      }
      syncLiveSkills();
    });
  }, []);
}
