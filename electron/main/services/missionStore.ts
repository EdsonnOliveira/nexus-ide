import Store from 'electron-store';
import { randomUUID } from 'node:crypto';
import { removeMissionAttachmentsDir, saveMissionAttachment } from './missionAttachments';
import type {
  AgentRole,
  AgentTemplate,
  CreateMissionInput,
  Mission,
  MissionAgentNode,
  MissionAttachment,
  MissionEdge,
  MissionFlowTemplate,
  MissionInboxItem,
  MissionStoreState,
} from '../../types/mission';
import { DEFAULT_MISSION_BUDGET } from '../../types/mission';

const defaultState: MissionStoreState = {
  missions: [],
  customRoles: [],
  customTemplates: [],
  flowTemplates: [],
};

const store = new Store<{ state: MissionStoreState }>({
  name: 'missions',
  defaults: { state: defaultState },
});

function readState(): MissionStoreState {
  const state = store.get('state');
  return {
    missions: Array.isArray(state?.missions) ? state.missions : [],
    customRoles: Array.isArray(state?.customRoles) ? state.customRoles : [],
    customTemplates: Array.isArray(state?.customTemplates) ? state.customTemplates : [],
    flowTemplates: Array.isArray(state?.flowTemplates) ? state.flowTemplates : [],
  };
}

function writeState(state: MissionStoreState): void {
  store.set('state', state);
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildMissionRootNode(input: {
  title: string;
  objective?: string;
  projectId?: string;
  position?: { x: number; y: number };
}): MissionAgentNode {
  const title = input.title.trim() || 'Nova missão';
  const objective = input.objective?.trim() || title;

  return {
    id: randomUUID(),
    kind: 'mission',
    agentTemplateId: 'tpl-mission-root',
    projectId: input.projectId ?? '',
    paneId: null,
    roleId: 'role-mission',
    name: title,
    objective,
    status: 'pending',
    progress: 0,
    iteration: 1,
    maxIterations: 3,
    attempt: 0,
    maxAttempts: 3,
    position: input.position ?? { x: 40, y: 160 },
    checklist: [],
    contextRefs: [],
  };
}

function isMissionRootNode(node: MissionAgentNode): boolean {
  return (node.kind ?? 'agent') === 'mission';
}

function ensureMissionRoot(mission: Mission): { mission: Mission; changed: boolean } {
  if (mission.nodes.some((node) => isMissionRootNode(node))) {
    return { mission, changed: false };
  }

  const others = mission.nodes;
  const minX = others.length > 0 ? Math.min(...others.map((node) => node.position.x)) : 360;
  const avgY =
    others.length > 0
      ? others.reduce((sum, node) => sum + node.position.y, 0) / others.length
      : 160;

  const root = buildMissionRootNode({
    title: mission.title,
    objective: mission.objective ?? mission.description,
    projectId: mission.defaultProjectId ?? others[0]?.projectId ?? '',
    position: {
      x: Math.min(40, minX - 320),
      y: Math.round(avgY),
    },
  });

  return {
    mission: {
      ...mission,
      nodes: [root, ...mission.nodes],
    },
    changed: true,
  };
}

export function listMissions(): Mission[] {
  const state = readState();
  let changed = false;
  const missions = state.missions.map((mission) => {
    const ensured = ensureMissionRoot(mission);
    if (ensured.changed) {
      changed = true;
    }
    return ensured.mission;
  });

  if (changed) {
    writeState({ ...state, missions });
  }

  return missions;
}

export function getMission(id: string): Mission | null {
  const state = readState();
  const current = state.missions.find((entry) => entry.id === id) ?? null;

  if (!current) {
    return null;
  }

  const ensured = ensureMissionRoot(current);

  if (ensured.changed) {
    const missions = state.missions.map((mission) =>
      mission.id === id ? ensured.mission : mission,
    );
    writeState({ ...state, missions });
  }

  return ensured.mission;
}

export function createMission(input: CreateMissionInput): Mission {
  const state = readState();
  const title = (typeof input.title === 'string' ? input.title : '').trim() || 'Nova missão';
  const objective = input.objective?.trim() || undefined;
  const description = input.description?.trim() || undefined;
  const inputNodes = input.nodes ?? [];
  const defaultProjectId = input.defaultProjectId?.trim() || null;
  const root = buildMissionRootNode({
    title,
    objective: objective ?? description,
    projectId: defaultProjectId ?? inputNodes[0]?.projectId ?? '',
    position: { x: 40, y: 160 },
  });
  const mission: Mission = {
    id: randomUUID(),
    title,
    description,
    objective,
    status: 'draft',
    progress: 0,
    nodes: [root, ...inputNodes.filter((node) => !isMissionRootNode(node))],
    edges: input.edges ?? [],
    maxParallelAgents: input.maxParallelAgents ?? 4,
    maxIterations: 3,
    subagentPolicy: input.subagentPolicy ?? 'never',
    maxSubagents: 5,
    budget: {
      ...DEFAULT_MISSION_BUDGET,
      ...input.budget,
    },
    capsules: input.capsules ?? [],
    discoveries: [],
    inbox: [],
    attachments: input.attachments ?? [],
    sourceTasks: input.sourceTasks ?? [],
    defaultProjectId,
    sourcePaneId: input.sourcePaneId ?? null,
    createdAt: nowIso(),
  };

  writeState({
    ...state,
    missions: [mission, ...state.missions],
  });

  return mission;
}

export function updateMission(id: string, patch: Partial<Mission>): Mission | null {
  const state = readState();
  const index = state.missions.findIndex((mission) => mission.id === id);

  if (index < 0) {
    return null;
  }

  const current = state.missions[index];
  const next: Mission = {
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    nodes: patch.nodes ?? current.nodes,
    edges: patch.edges ?? current.edges,
    capsules: patch.capsules ?? current.capsules,
    discoveries: patch.discoveries ?? current.discoveries,
    inbox: patch.inbox ?? current.inbox,
    attachments: patch.attachments ?? current.attachments,
    sourceTasks: patch.sourceTasks ?? current.sourceTasks,
    budget: patch.budget ?? current.budget,
    drawings: patch.drawings ?? current.drawings,
    floors: patch.floors ?? current.floors,
    companionEvents: patch.companionEvents ?? current.companionEvents,
  };

  const missions = [...state.missions];
  missions[index] = next;
  writeState({ ...state, missions });
  return next;
}

export function removeMission(id: string): boolean {
  const state = readState();
  const nextMissions = state.missions.filter((mission) => mission.id !== id);

  if (nextMissions.length === state.missions.length) {
    return false;
  }

  writeState({ ...state, missions: nextMissions });
  void removeMissionAttachmentsDir(id);
  return true;
}

export async function addMissionAttachment(
  missionId: string,
  sourcePath: string,
): Promise<{ mission: Mission; attachment: MissionAttachment } | null> {
  const mission = getMission(missionId);
  if (!mission) {
    return null;
  }

  try {
    const attachment = await saveMissionAttachment(missionId, sourcePath);
    const next = updateMission(missionId, {
      attachments: [...(mission.attachments ?? []), attachment],
    });

    if (!next) {
      return null;
    }

    return { mission: next, attachment };
  } catch {
    return null;
  }
}

export function upsertMissionNode(missionId: string, node: MissionAgentNode): Mission | null {
  const mission = getMission(missionId);

  if (!mission) {
    return null;
  }

  const index = mission.nodes.findIndex((entry) => entry.id === node.id);
  const nodes = [...mission.nodes];

  if (index >= 0) {
    nodes[index] = node;
  } else {
    nodes.push(node);
  }

  return updateMission(missionId, { nodes });
}

export function upsertMissionEdge(missionId: string, edge: MissionEdge): Mission | null {
  const mission = getMission(missionId);

  if (!mission) {
    return null;
  }

  const index = mission.edges.findIndex((entry) => entry.id === edge.id);
  const edges = [...mission.edges];

  if (index >= 0) {
    edges[index] = edge;
  } else {
    edges.push(edge);
  }

  return updateMission(missionId, { edges });
}

export function removeMissionNode(missionId: string, nodeId: string): Mission | null {
  const mission = getMission(missionId);

  if (!mission) {
    return null;
  }

  const target = mission.nodes.find((node) => node.id === nodeId);

  if (target && isMissionRootNode(target)) {
    return mission;
  }

  return updateMission(missionId, {
    nodes: mission.nodes.filter((node) => node.id !== nodeId),
    edges: mission.edges.filter(
      (edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId,
    ),
  });
}

export function removeMissionEdge(missionId: string, edgeId: string): Mission | null {
  const mission = getMission(missionId);

  if (!mission) {
    return null;
  }

  return updateMission(missionId, {
    edges: mission.edges.filter((edge) => edge.id !== edgeId),
  });
}

export function upsertInboxItem(missionId: string, item: MissionInboxItem): Mission | null {
  const mission = getMission(missionId);

  if (!mission) {
    return null;
  }

  const index = mission.inbox.findIndex((entry) => entry.id === item.id);
  const inbox = [...mission.inbox];

  if (index >= 0) {
    inbox[index] = item;
  } else {
    inbox.unshift(item);
  }

  return updateMission(missionId, { inbox });
}

export function listCustomRoles(): AgentRole[] {
  return readState().customRoles;
}

export function listCustomTemplates(): AgentTemplate[] {
  return readState().customTemplates;
}

export function saveCustomRole(role: AgentRole): AgentRole {
  const state = readState();
  const index = state.customRoles.findIndex((entry) => entry.id === role.id);
  const customRoles = [...state.customRoles];

  if (index >= 0) {
    customRoles[index] = role;
  } else {
    customRoles.push(role);
  }

  writeState({ ...state, customRoles });
  return role;
}

export function saveCustomTemplate(template: AgentTemplate): AgentTemplate {
  const state = readState();
  const index = state.customTemplates.findIndex((entry) => entry.id === template.id);
  const customTemplates = [...state.customTemplates];

  if (index >= 0) {
    customTemplates[index] = template;
  } else {
    customTemplates.push(template);
  }

  writeState({ ...state, customTemplates });
  return template;
}

export function listFlowTemplates(): MissionFlowTemplate[] {
  return readState().flowTemplates;
}

export function saveFlowTemplate(template: MissionFlowTemplate): MissionFlowTemplate {
  const state = readState();
  const index = state.flowTemplates.findIndex((entry) => entry.id === template.id);
  const flowTemplates = [...state.flowTemplates];
  const now = nowIso();
  const next: MissionFlowTemplate = {
    ...template,
    name: (typeof template.name === 'string' ? template.name : '').trim() || 'Fluxo personalizado',
    updatedAt: now,
    createdAt: index >= 0 ? flowTemplates[index]!.createdAt : template.createdAt || now,
  };

  if (index >= 0) {
    flowTemplates[index] = next;
  } else {
    flowTemplates.unshift(next);
  }

  writeState({ ...state, flowTemplates });
  return next;
}

export function removeFlowTemplate(id: string): boolean {
  const state = readState();
  const next = state.flowTemplates.filter((entry) => entry.id !== id);

  if (next.length === state.flowTemplates.length) {
    return false;
  }

  writeState({ ...state, flowTemplates: next });
  return true;
}

export function listOpenInboxItems(): MissionInboxItem[] {
  return readState()
    .missions.flatMap((mission) =>
      mission.inbox
        .filter((item) => !item.resolvedAt)
        .map((item) => ({ ...item, missionId: mission.id })),
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
