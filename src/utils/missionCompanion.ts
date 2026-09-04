import { useMissionStore } from '@/stores/useMissionStore';
import type { MissionCompanionEvent } from '@/types/mission';
import {
  getMissionNodeDisplayName,
  isMissionAgentNode,
} from '@/utils/missionHelpers';
import { getBuiltinTemplateById } from '@/constants/agentTemplates';

const MAX_EVENTS = 40;

export function pushMissionCompanionEvent(input: {
  missionId: string;
  nodeId: string;
  title: string;
  summary: string;
  nextStep?: string;
}): void {
  const store = useMissionStore.getState();
  const mission = store.getMissionById(input.missionId);
  if (!mission || mission.companionEnabled === false) {
    return;
  }

  const event: MissionCompanionEvent = {
    id: crypto.randomUUID(),
    missionId: input.missionId,
    nodeId: input.nodeId,
    title: input.title.trim(),
    summary: input.summary.trim(),
    nextStep: input.nextStep?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };

  const previous = mission.companionEvents ?? [];
  void store.updateMission(mission.id, {
    companionEvents: [event, ...previous].slice(0, MAX_EVENTS),
  });
}

export function dismissMissionCompanionEvent(
  missionId: string,
  eventId: string,
): void {
  const store = useMissionStore.getState();
  const mission = store.getMissionById(missionId);
  if (!mission?.companionEvents?.length) {
    return;
  }

  void store.updateMission(missionId, {
    companionEvents: mission.companionEvents.map((event) =>
      event.id === eventId
        ? { ...event, dismissedAt: new Date().toISOString() }
        : event,
    ),
  });
}

export function buildCompanionNextStep(missionId: string, nodeId: string): string {
  const mission = useMissionStore.getState().getMissionById(missionId);
  if (!mission) {
    return 'Revise o canvas da missão.';
  }

  const dagSuccessors = mission.edges
    .filter(
      (edge) =>
        edge.sourceNodeId === nodeId &&
        edge.type !== 'live' &&
        edge.type !== 'parallel',
    )
    .map((edge) => mission.nodes.find((node) => node.id === edge.targetNodeId))
    .filter((node): node is NonNullable<typeof node> => Boolean(node));

  const livePeers = mission.edges
    .filter(
      (edge) =>
        edge.type === 'live' &&
        (edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId),
    )
    .map((edge) => {
      const otherId =
        edge.sourceNodeId === nodeId ? edge.targetNodeId : edge.sourceNodeId;
      return mission.nodes.find((node) => node.id === otherId);
    })
    .filter((node): node is NonNullable<typeof node> => Boolean(node));

  const formatNode = (node: (typeof mission.nodes)[number]) => {
    const template = getBuiltinTemplateById(node.agentTemplateId);
    return getMissionNodeDisplayName(node, template?.name ?? 'Nó');
  };

  if (dagSuccessors.length > 0) {
    return `Próximo no DAG: ${dagSuccessors.map(formatNode).join(', ')}.`;
  }

  if (livePeers.length > 0) {
    return `Peers live: ${livePeers.map(formatNode).join(', ')}.`;
  }

  const running = mission.nodes.filter(
    (node) => isMissionAgentNode(node) && node.status === 'running' && node.id !== nodeId,
  );
  if (running.length > 0) {
    return `Ainda rodando: ${running.map(formatNode).join(', ')}.`;
  }

  return 'Missão sem próximos nós óbvios — revise o grafo.';
}
