import { create } from 'zustand';
import { BUILTIN_AGENT_ROLES } from '@/constants/agentRoles';
import { BUILTIN_AGENT_TEMPLATES } from '@/constants/agentTemplates';
import type {
  AgentRole,
  AgentTemplate,
  CreateMissionInput,
  Mission,
  MissionAgentNode,
  MissionEdge,
  MissionFlowTemplate,
  MissionInboxItem,
} from '@/types/mission';

interface MissionStoreState {
  missions: Mission[];
  inbox: MissionInboxItem[];
  customRoles: AgentRole[];
  customTemplates: AgentTemplate[];
  flowTemplates: MissionFlowTemplate[];
  activeMissionId: string | null;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  selectedEdgeId: string | null;
  selectedPaneIds: string[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setActiveMissionId: (id: string | null) => void;
  setSelectedNodeId: (id: string | null) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  clearSelectedNodeIds: () => void;
  setSelectedEdgeId: (id: string | null) => void;
  toggleSelectedPaneId: (paneId: string, additive: boolean) => void;
  clearSelectedPaneIds: () => void;
  createMission: (input: CreateMissionInput) => Promise<Mission | null>;
  updateMission: (id: string, patch: Partial<Mission>) => Promise<Mission | null>;
  removeMission: (id: string) => Promise<boolean>;
  upsertNode: (missionId: string, node: MissionAgentNode) => Promise<Mission | null>;
  removeNode: (missionId: string, nodeId: string) => Promise<Mission | null>;
  upsertEdge: (missionId: string, edge: MissionEdge) => Promise<Mission | null>;
  removeEdge: (missionId: string, edgeId: string) => Promise<Mission | null>;
  upsertInboxItem: (missionId: string, item: MissionInboxItem) => Promise<Mission | null>;
  saveFlowTemplate: (template: MissionFlowTemplate) => Promise<MissionFlowTemplate | null>;
  removeFlowTemplate: (id: string) => Promise<boolean>;
  applyMission: (mission: Mission) => void;
  applyInbox: (items: MissionInboxItem[]) => void;
  getRoles: () => AgentRole[];
  getTemplates: () => AgentTemplate[];
  getFlowTemplates: () => MissionFlowTemplate[];
  getMissionById: (id: string) => Mission | undefined;
  getMissionByPaneId: (paneId: string) => Mission | undefined;
}

function mergeMission(missions: Mission[], mission: Mission): Mission[] {
  const index = missions.findIndex((entry) => entry.id === mission.id);

  if (index < 0) {
    return [mission, ...missions];
  }

  const next = [...missions];
  next[index] = mission;
  return next;
}

function mergeFlowTemplate(
  templates: MissionFlowTemplate[],
  template: MissionFlowTemplate,
): MissionFlowTemplate[] {
  const index = templates.findIndex((entry) => entry.id === template.id);

  if (index < 0) {
    return [template, ...templates];
  }

  const next = [...templates];
  next[index] = template;
  return next;
}

export const useMissionStore = create<MissionStoreState>((set, get) => ({
  missions: [],
  inbox: [],
  customRoles: [],
  customTemplates: [],
  flowTemplates: [],
  activeMissionId: null,
  selectedNodeId: null,
  selectedNodeIds: [],
  selectedEdgeId: null,
  selectedPaneIds: [],
  hydrated: false,

  hydrate: async () => {
    if (!window.nexus?.missions) {
      set({ hydrated: true });
      return;
    }

    const api = window.nexus.missions;
    const current = get();

    const [missionsResult, inboxResult, rolesResult, templatesResult, flowResult] =
      await Promise.allSettled([
        api.list(),
        api.listInbox(),
        api.listCustomRoles(),
        api.listCustomTemplates(),
        api.listFlowTemplates(),
      ]);

    set({
      missions:
        missionsResult.status === 'fulfilled' && Array.isArray(missionsResult.value)
          ? missionsResult.value
          : current.missions,
      inbox:
        inboxResult.status === 'fulfilled' && Array.isArray(inboxResult.value)
          ? inboxResult.value
          : current.inbox,
      customRoles:
        rolesResult.status === 'fulfilled' && Array.isArray(rolesResult.value)
          ? rolesResult.value
          : current.customRoles,
      customTemplates:
        templatesResult.status === 'fulfilled' && Array.isArray(templatesResult.value)
          ? templatesResult.value
          : current.customTemplates,
      flowTemplates:
        flowResult.status === 'fulfilled' && Array.isArray(flowResult.value)
          ? flowResult.value
          : current.flowTemplates,
      hydrated: true,
    });
  },

  setActiveMissionId: (id) => set({ activeMissionId: id }),
  setSelectedNodeId: (id) =>
    set({
      selectedNodeId: id,
      selectedNodeIds: id ? [id] : [],
      selectedEdgeId: null,
    }),
  setSelectedNodeIds: (ids) =>
    set({
      selectedNodeIds: ids,
      selectedNodeId: ids[0] ?? null,
      selectedEdgeId: null,
    }),
  clearSelectedNodeIds: () => set({ selectedNodeIds: [], selectedNodeId: null }),
  setSelectedEdgeId: (id) =>
    set({ selectedEdgeId: id, selectedNodeId: null, selectedNodeIds: [] }),

  toggleSelectedPaneId: (paneId, additive) => {
    set((state) => {
      if (!additive) {
        return { selectedPaneIds: [paneId] };
      }

      if (state.selectedPaneIds.includes(paneId)) {
        return {
          selectedPaneIds: state.selectedPaneIds.filter((id) => id !== paneId),
        };
      }

      return { selectedPaneIds: [...state.selectedPaneIds, paneId] };
    });
  },

  clearSelectedPaneIds: () => set({ selectedPaneIds: [] }),

  createMission: async (input) => {
    if (!window.nexus?.missions) {
      return null;
    }

    const mission = await window.nexus.missions.create(input);
    set((state) => ({
      missions: mergeMission(state.missions, mission),
      activeMissionId: mission.id,
      selectedNodeId: null,
      selectedEdgeId: null,
    }));
    return mission;
  },

  updateMission: async (id, patch) => {
    if (!window.nexus?.missions) {
      return null;
    }

    const mission = await window.nexus.missions.update(id, patch);

    if (mission) {
      set((state) => ({ missions: mergeMission(state.missions, mission) }));
    }

    return mission;
  },

  removeMission: async (id) => {
    set((state) => ({
      missions: state.missions.filter((mission) => mission.id !== id),
      activeMissionId: state.activeMissionId === id ? null : state.activeMissionId,
    }));

    if (!window.nexus?.missions) {
      return true;
    }

    try {
      await window.nexus.missions.remove(id);
      return true;
    } catch {
      return true;
    }
  },

  upsertNode: async (missionId, node) => {
    if (!window.nexus?.missions) {
      return null;
    }

    const mission = await window.nexus.missions.upsertNode(missionId, node);

    if (mission) {
      set((state) => ({ missions: mergeMission(state.missions, mission) }));
    }

    return mission;
  },

  removeNode: async (missionId, nodeId) => {
    if (!window.nexus?.missions) {
      return null;
    }

    const mission = await window.nexus.missions.removeNode(missionId, nodeId);

    if (mission) {
      set((state) => ({ missions: mergeMission(state.missions, mission) }));
    }

    return mission;
  },

  upsertEdge: async (missionId, edge) => {
    if (!window.nexus?.missions) {
      return null;
    }

    const mission = await window.nexus.missions.upsertEdge(missionId, edge);

    if (mission) {
      set((state) => ({ missions: mergeMission(state.missions, mission) }));
    }

    return mission;
  },

  removeEdge: async (missionId, edgeId) => {
    if (!window.nexus?.missions) {
      return null;
    }

    const mission = await window.nexus.missions.removeEdge(missionId, edgeId);

    if (mission) {
      set((state) => ({ missions: mergeMission(state.missions, mission) }));
    }

    return mission;
  },

  upsertInboxItem: async (missionId, item) => {
    if (!window.nexus?.missions) {
      return null;
    }

    const mission = await window.nexus.missions.upsertInboxItem(missionId, item);

    if (mission) {
      set((state) => ({
        missions: mergeMission(state.missions, mission),
        inbox: mission.inbox.filter((entry) => !entry.resolvedAt),
      }));
    }

    return mission;
  },

  saveFlowTemplate: async (template) => {
    if (!window.nexus?.missions) {
      return null;
    }

    const saved = await window.nexus.missions.saveFlowTemplate(template);

    if (saved) {
      set((state) => ({
        flowTemplates: mergeFlowTemplate(state.flowTemplates, saved),
      }));
    }

    return saved;
  },

  removeFlowTemplate: async (id) => {
    set((state) => ({
      flowTemplates: state.flowTemplates.filter((entry) => entry.id !== id),
    }));

    if (!window.nexus?.missions) {
      return true;
    }

    try {
      return await window.nexus.missions.removeFlowTemplate(id);
    } catch {
      return true;
    }
  },

  applyMission: (mission) => {
    set((state) => ({ missions: mergeMission(state.missions, mission) }));
  },

  applyInbox: (items) => {
    set({ inbox: items });
  },

  getRoles: () => {
    const custom = get().customRoles;
    return [...BUILTIN_AGENT_ROLES, ...custom];
  },

  getTemplates: () => {
    const custom = get().customTemplates;
    return [...BUILTIN_AGENT_TEMPLATES, ...custom];
  },

  getFlowTemplates: () => get().flowTemplates,

  getMissionById: (id) => get().missions.find((mission) => mission.id === id),

  getMissionByPaneId: (paneId) =>
    get().missions.find(
      (mission) =>
        mission.sourcePaneId === paneId ||
        mission.nodes.some((node) => node.paneId === paneId),
    ),
}));
