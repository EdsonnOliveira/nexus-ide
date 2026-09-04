import { useMissionStore } from '@/stores/useMissionStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { askLiveAgentAsHuman } from '@/utils/missionLiveBus';
import { submitAgentPanePrompt } from '@/utils/agentPaneRegistry';
import { countMissionAgentNodes } from '@/utils/missionHelpers';
import { findPaneTab } from '@/utils/tabGroups';

export async function askSelectedMaestroAgents(prompt: string): Promise<Array<{
  paneId: string;
  projectId: string;
  projectName: string;
}>> {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return [];
  }

  const selectedPaneIds = useMissionStore.getState().selectedPaneIds;
  const projects = useProjectStore.getState().projects;
  const targets: Array<{ paneId: string; projectId: string; projectName: string }> = [];
  const liveByMission = new Map<string, string[]>();
  const classicPaneIds: string[] = [];
  const missions = useMissionStore.getState().missions;

  for (const paneId of selectedPaneIds) {
    let handledAsLive = false;

    for (const mission of missions) {
      const node = mission.nodes.find((entry) => entry.paneId === paneId);
      if (!node) {
        continue;
      }

      const hasLive = mission.edges.some(
        (edge) =>
          edge.type === 'live' &&
          (edge.sourceNodeId === node.id || edge.targetNodeId === node.id),
      );

      if (hasLive || (node.runUntil ?? 'turn_end') === 'session') {
        const list = liveByMission.get(mission.id) ?? [];
        list.push(node.id);
        liveByMission.set(mission.id, list);
        handledAsLive = true;
      }

      for (const project of projects) {
        const pane = findPaneTab(project.tabs, paneId);
        if (pane?.type === 'agent') {
          targets.push({
            paneId,
            projectId: project.id,
            projectName: project.name,
          });
          break;
        }
      }
      break;
    }

    if (!handledAsLive) {
      classicPaneIds.push(paneId);
    }
  }

  for (const [missionId, nodeIds] of liveByMission) {
    await askLiveAgentAsHuman({
      missionId,
      targetNodeIds: nodeIds,
      message: trimmed,
    });
  }

  for (const paneId of classicPaneIds) {
    for (const project of projects) {
      const pane = findPaneTab(project.tabs, paneId);
      if (pane?.type === 'agent') {
        if (!targets.some((entry) => entry.paneId === paneId)) {
          targets.push({
            paneId,
            projectId: project.id,
            projectName: project.name,
          });
        }
        submitAgentPanePrompt(paneId, trimmed, {
          displayContent: trimmed,
          forceNewTurn: true,
        });
        break;
      }
    }
  }

  return targets;
}

export function publishMissionDiscovery(input: {
  missionId: string;
  sourceNodeId: string;
  content: string;
  sharedWithNodeIds?: string[];
}): void {
  const store = useMissionStore.getState();
  const mission = store.getMissionById(input.missionId);
  if (!mission || !input.content.trim()) {
    return;
  }

  void store.updateMission(mission.id, {
    discoveries: [
      {
        id: crypto.randomUUID(),
        missionId: mission.id,
        sourceNodeId: input.sourceNodeId,
        content: input.content.trim(),
        createdAt: new Date().toISOString(),
        sharedWithNodeIds: input.sharedWithNodeIds ?? [],
      },
      ...mission.discoveries,
    ],
  });
}

export function publishMissionCapsule(input: {
  missionId: string;
  title: string;
  content: string;
  sourceNodeId?: string;
}): void {
  const store = useMissionStore.getState();
  const mission = store.getMissionById(input.missionId);
  if (!mission || !input.content.trim()) {
    return;
  }

  void store.updateMission(mission.id, {
    capsules: [
      {
        id: crypto.randomUUID(),
        missionId: mission.id,
        title: input.title.trim() || 'Cápsula',
        content: input.content.trim(),
        sourceNodeId: input.sourceNodeId,
        createdAt: new Date().toISOString(),
      },
      ...mission.capsules,
    ],
  });
}

export function computeMissionTokenUsage(missionId: string): {
  tokens: number;
  nodeCount: number;
} {
  const mission = useMissionStore.getState().getMissionById(missionId);
  if (!mission) {
    return { tokens: 0, nodeCount: 0 };
  }

  const projects = useProjectStore.getState().projects;
  let tokens = 0;

  for (const node of mission.nodes) {
    if (!node.paneId) {
      continue;
    }

    for (const project of projects) {
      const pane = findPaneTab(project.tabs, node.paneId);
      if (pane?.type !== 'agent') {
        continue;
      }

      for (const turn of pane.turns) {
        if (!turn.usage) {
          continue;
        }
        tokens +=
          turn.usage.inputTokens +
          turn.usage.outputTokens +
          turn.usage.cacheReadTokens +
          turn.usage.cacheWriteTokens;
      }
    }
  }

  return { tokens, nodeCount: countMissionAgentNodes(mission.nodes) };
}
