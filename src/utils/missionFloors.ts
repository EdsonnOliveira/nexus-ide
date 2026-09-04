import { useMissionStore } from '@/stores/useMissionStore';
import { useProjectStore } from '@/stores/useProjectStore';
import type { Mission, MissionFloor } from '@/types/mission';
import { ensureMissionNodeWorktree } from '@/utils/missionWorktree';
import { isMissionAgentNode, isMissionRootNode } from '@/utils/missionHelpers';

function cloneMissionForFloor(source: Mission, name: string): Mission {
  const idMap = new Map<string, string>();
  for (const node of source.nodes) {
    idMap.set(node.id, crypto.randomUUID());
  }

  const nodes = source.nodes.map((node) => ({
    ...node,
    id: idMap.get(node.id)!,
    paneId: null,
    worktreePath: null,
    worktreeBranch: null,
    status: isMissionRootNode(node) ? node.status : ('pending' as const),
    progress: isMissionRootNode(node) ? node.progress : 0,
    startedAt: undefined,
    completedAt: undefined,
    lastError: undefined,
    transcriptTurns: undefined,
    transcriptFollowUps: undefined,
    transcriptCapturedAt: undefined,
    position: {
      x: node.position.x,
      y: node.position.y,
    },
  }));

  const edges = source.edges.map((edge) => ({
    ...edge,
    id: crypto.randomUUID(),
    sourceNodeId: idMap.get(edge.sourceNodeId) ?? edge.sourceNodeId,
    targetNodeId: idMap.get(edge.targetNodeId) ?? edge.targetNodeId,
  }));

  const drawings = (source.drawings ?? []).map((drawing) => ({
    ...drawing,
    id: crypto.randomUUID(),
  }));

  return {
    ...source,
    id: crypto.randomUUID(),
    title: `${source.title} · ${name}`,
    status: 'draft',
    progress: 0,
    nodes,
    edges,
    drawings,
    floors: [],
    companionEvents: [],
    inbox: [],
    startedAt: undefined,
    completedAt: undefined,
    result: undefined,
    activeFloorId: null,
    createdAt: new Date().toISOString(),
  };
}

export async function createMissionFloor(input: {
  missionId: string;
  name?: string;
}): Promise<MissionFloor | null> {
  const store = useMissionStore.getState();
  const source = store.getMissionById(input.missionId);
  if (!source) {
    return null;
  }

  const floorName = input.name?.trim() || `Andar ${(source.floors?.length ?? 0) + 1}`;
  const clone = cloneMissionForFloor(source, floorName);
  const clonedRoot = clone.nodes.find((node) => isMissionRootNode(node));
  const created = await store.createMission({
    title: clone.title,
    description: clone.description,
    objective: clone.objective,
    nodes: clone.nodes,
    edges: clone.edges,
    defaultProjectId: clone.defaultProjectId,
  });

  if (!created) {
    return null;
  }

  const createdRoot = created.nodes.find((node) => isMissionRootNode(node));
  const remappedEdges =
    clonedRoot && createdRoot
      ? created.edges.map((edge) => ({
          ...edge,
          sourceNodeId:
            edge.sourceNodeId === clonedRoot.id ? createdRoot.id : edge.sourceNodeId,
          targetNodeId:
            edge.targetNodeId === clonedRoot.id ? createdRoot.id : edge.targetNodeId,
        }))
      : created.edges;

  await store.updateMission(created.id, {
    drawings: clone.drawings,
    companionEnabled: source.companionEnabled !== false,
    edges: remappedEdges,
  });

  const projects = useProjectStore.getState().projects;
  let worktreePath: string | null = null;
  let worktreeBranch: string | null = null;

  for (const node of created.nodes) {
    if (!isMissionAgentNode(node)) {
      continue;
    }
    const project = projects.find((entry) => entry.id === node.projectId);
    if (!project) {
      continue;
    }
    const worktree = await ensureMissionNodeWorktree({
      project,
      mission: created,
      node,
    });
    if (worktree) {
      worktreePath = worktree.path;
      worktreeBranch = worktree.branch;
      await store.upsertNode(created.id, {
        ...node,
        worktreePath: worktree.path,
        worktreeBranch: worktree.branch,
      });
      break;
    }
  }

  const floor: MissionFloor = {
    id: crypto.randomUUID(),
    name: floorName,
    parentMissionId: source.id,
    missionId: created.id,
    worktreePath,
    worktreeBranch,
    createdAt: new Date().toISOString(),
  };

  await store.updateMission(source.id, {
    floors: [...(source.floors ?? []), floor],
    activeFloorId: floor.id,
  });

  store.setActiveMissionId(created.id);
  return floor;
}

export async function discardMissionFloor(input: {
  parentMissionId: string;
  floorId: string;
}): Promise<void> {
  const store = useMissionStore.getState();
  const parent = store.getMissionById(input.parentMissionId);
  if (!parent?.floors) {
    return;
  }

  const floor = parent.floors.find((entry) => entry.id === input.floorId);
  if (!floor) {
    return;
  }

  await store.removeMission(floor.missionId);
  await store.updateMission(parent.id, {
    floors: parent.floors.filter((entry) => entry.id !== input.floorId),
    activeFloorId:
      parent.activeFloorId === input.floorId ? null : parent.activeFloorId,
  });
  store.setActiveMissionId(parent.id);
}

export async function landMissionFloor(input: {
  parentMissionId: string;
  floorId: string;
}): Promise<void> {
  const store = useMissionStore.getState();
  const parent = store.getMissionById(input.parentMissionId);
  const floor = parent?.floors?.find((entry) => entry.id === input.floorId);
  if (!parent || !floor) {
    return;
  }

  const floorMission = store.getMissionById(floor.missionId);
  if (!floorMission) {
    return;
  }

  await store.updateMission(parent.id, {
    nodes: floorMission.nodes.map((node) => ({
      ...node,
      paneId: null,
    })),
    edges: floorMission.edges,
    drawings: floorMission.drawings ?? [],
    activeFloorId: null,
  });

  await discardMissionFloor(input);
}
