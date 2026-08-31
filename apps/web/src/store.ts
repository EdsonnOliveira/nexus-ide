import { create } from 'zustand';
import type { CloudProject, CloudWorkspace, CommandApproval, DeviceRecord } from '@nexus/protocol';
import type { Session, User } from '@supabase/supabase-js';

export type WebAgentActivityKind = 'thought' | 'response' | 'tool_run' | 'file_read' | 'file_edit';

export interface WebAgentActivity {
  id: string;
  kind: WebAgentActivityKind;
  label: string;
  streaming?: boolean;
  filePath?: string;
  toolCommand?: string;
  toolOutput?: string;
  additions?: number;
  deletions?: number;
  startedAt?: number;
  durationMs?: number;
}

export interface WebAgentTurn {
  id: string;
  prompt: string;
  thought: string;
  thoughtStreaming: boolean;
  response: string;
  activities: WebAgentActivity[];
  status: 'running' | 'done' | 'error';
  createdAt: number;
  endedAt?: number;
  commandId: string;
}

export type WebAgentTerminalStatus = 'starting' | 'running' | 'completed' | 'failed';

export interface WebAgentTerminal {
  id: string;
  command: string;
  title: string;
  startedAt: number;
  status: WebAgentTerminalStatus;
  exitCode: number | null;
  output: string;
  remoteSessionId: string | null;
}

export interface WebAgentSession {
  id: string;
  commandId: string;
  prompt: string;
  projectId: string | null;
  deviceId: string | null;
  projectName: string;
  projectColor: string;
  logoUrl: string | null;
  cursorSessionId: string | null;
  modelId: string;
  agentCommand: string;
  modeId: 'agent' | 'plan' | 'debug' | 'multitask' | 'ask';
  source: 'cloud' | 'desktop_pane';
  stream: string;
  status: 'running' | 'done' | 'error';
  createdAt: number;
  turns: WebAgentTurn[];
  terminals: WebAgentTerminal[];
}

interface WebState {
  session: Session | null;
  user: User | null;
  devices: DeviceRecord[];
  workspaces: CloudWorkspace[];
  projects: CloudProject[];
  approvals: CommandApproval[];
  selectedDeviceId: string | null;
  selectedProjectId: string | null;
  activeWorkspaceId: string | null;
  agents: WebAgentSession[];
  notifiedAgentIds: Record<string, true>;
  syncing: boolean;
  setSession: (session: Session | null) => void;
  setDevices: (devices: DeviceRecord[]) => void;
  setWorkspaces: (workspaces: CloudWorkspace[]) => void;
  setProjects: (projects: CloudProject[]) => void;
  setApprovals: (approvals: CommandApproval[]) => void;
  setSelectedDeviceId: (id: string | null) => void;
  setSelectedProjectId: (id: string | null) => void;
  setActiveWorkspaceId: (id: string | null) => void;
  setSyncing: (syncing: boolean) => void;
  setAgents: (agents: WebAgentSession[]) => void;
  addAgent: (agent: WebAgentSession) => void;
  mergeHydratedAgents: (incoming: WebAgentSession[]) => void;
  syncDesktopAgents: (incoming: WebAgentSession[]) => void;
  patchAgentTurn: (
    agentId: string,
    patch: Partial<
      Pick<
        WebAgentTurn,
        'thought' | 'thoughtStreaming' | 'response' | 'activities' | 'status' | 'endedAt'
      >
    >,
  ) => void;
  setAgentCursorSessionId: (agentId: string, cursorSessionId: string | null) => void;
  setAgentModelId: (agentId: string, modelId: string) => void;
  setAgentCommand: (agentId: string, agentCommand: string) => void;
  setAgentModeId: (agentId: string, modeId: WebAgentSession['modeId']) => void;
  setAgentStatus: (id: string, status: WebAgentSession['status']) => void;
  addAgentTurn: (agentId: string, turn: WebAgentTurn) => void;
  upsertAgentTerminal: (agentId: string, terminal: WebAgentTerminal) => void;
  patchAgentTerminal: (
    agentId: string,
    terminalId: string,
    patch: Partial<
      Pick<WebAgentTerminal, 'status' | 'exitCode' | 'output' | 'remoteSessionId' | 'title'>
    >,
  ) => void;
  removeAgentTerminal: (agentId: string, terminalId: string) => void;
  removeAgent: (id: string) => void;
  markAgentReady: (id: string) => void;
  clearAgentNotification: (id: string) => void;
}

function mapLastRunningTurn(
  turns: WebAgentTurn[],
  mapper: (turn: WebAgentTurn) => WebAgentTurn,
): WebAgentTurn[] {
  let found = false;
  return turns
    .slice()
    .reverse()
    .map((turn) => {
      if (!found && turn.status === 'running') {
        found = true;
        return mapper(turn);
      }
      return turn;
    })
    .reverse();
}

function turnContentLength(turn: WebAgentTurn | undefined): number {
  if (!turn) {
    return 0;
  }
  const activitiesLen = turn.activities.reduce((sum, entry) => sum + entry.label.length, 0);
  return turn.thought.length + turn.response.length + activitiesLen;
}

function mergeWebAgentSession(
  existing: WebAgentSession,
  incoming: WebAgentSession,
): WebAgentSession {
  const existingLast = existing.turns[existing.turns.length - 1];
  const incomingLast = incoming.turns[incoming.turns.length - 1];
  const existingLen = turnContentLength(existingLast);
  const incomingLen = turnContentLength(incomingLast);

  if (existing.turns.length > incoming.turns.length) {
    return {
      ...existing,
      commandId: existing.commandId || incoming.commandId,
      cursorSessionId: existing.cursorSessionId ?? incoming.cursorSessionId,
      agentCommand: existing.agentCommand || incoming.agentCommand,
    };
  }

  if (
    existing.status === 'running' &&
    incoming.status === 'running' &&
    existing.turns.length === incoming.turns.length &&
    existingLen >= incomingLen
  ) {
    return {
      ...existing,
      commandId: existing.commandId || incoming.commandId,
      cursorSessionId: existing.cursorSessionId ?? incoming.cursorSessionId,
      agentCommand: existing.agentCommand || incoming.agentCommand,
    };
  }

  if (
    incoming.status !== 'running' &&
    existing.turns.length === incoming.turns.length &&
    existingLen > incomingLen
  ) {
    return {
      ...existing,
      status: incoming.status,
      commandId: existing.commandId || incoming.commandId,
      cursorSessionId: existing.cursorSessionId ?? incoming.cursorSessionId,
      agentCommand: existing.agentCommand || incoming.agentCommand,
      turns: existing.turns.map((turn, index) =>
        index === existing.turns.length - 1
          ? {
              ...turn,
              status: incoming.status,
              thoughtStreaming: false,
              endedAt: turn.endedAt ?? Date.now(),
              activities: turn.activities.map((entry) =>
                entry.streaming ? { ...entry, streaming: undefined } : entry,
              ),
            }
          : turn,
      ),
      terminals:
        existing.terminals.length >= incoming.terminals.length
          ? existing.terminals
          : incoming.terminals,
    };
  }

  return {
    ...incoming,
    modelId: existing.modelId,
    modeId: existing.modeId,
    agentCommand: existing.agentCommand || incoming.agentCommand,
    terminals:
      existing.terminals.length >= incoming.terminals.length
        ? existing.terminals
        : incoming.terminals,
  };
}

export const useWebStore = create<WebState>((set) => ({
  session: null,
  user: null,
  devices: [],
  workspaces: [],
  projects: [],
  approvals: [],
  selectedDeviceId: null,
  selectedProjectId: null,
  activeWorkspaceId: null,
  agents: [],
  notifiedAgentIds: {},
  syncing: false,
  setSession: (session) => set({ session, user: session?.user ?? null }),
  setDevices: (devices) => set({ devices }),
  setWorkspaces: (workspaces) => set({ workspaces }),
  setProjects: (projects) => set({ projects }),
  setApprovals: (approvals) => set({ approvals }),
  setSelectedDeviceId: (selectedDeviceId) => set({ selectedDeviceId }),
  setSelectedProjectId: (selectedProjectId) => set({ selectedProjectId }),
  setActiveWorkspaceId: (activeWorkspaceId) => set({ activeWorkspaceId }),
  setSyncing: (syncing) => set({ syncing }),
  setAgents: (agents) => set({ agents }),
  addAgent: (agent) =>
    set((state) => ({
      agents: state.agents.some((item) => item.id === agent.id)
        ? state.agents.map((item) => (item.id === agent.id ? agent : item))
        : [...state.agents, agent],
    })),
  mergeHydratedAgents: (incoming) =>
    set((state) => {
      if (incoming.length === 0) {
        return state;
      }
      const incomingById = new Map(incoming.map((agent) => [agent.id, agent]));
      return {
        agents: state.agents.map((agent) => {
          const remote = incomingById.get(agent.id);
          if (!remote) {
            return agent;
          }
          return mergeWebAgentSession(agent, remote);
        }),
      };
    }),
  syncDesktopAgents: (incoming) =>
    set((state) => {
      const cloud = state.agents.filter((agent) => agent.source !== 'desktop_pane');
      const existingById = new Map(
        state.agents
          .filter((agent) => agent.source === 'desktop_pane')
          .map((agent) => [agent.id, agent]),
      );
      const desktop = incoming.map((remote) => {
        const existing = existingById.get(remote.id);
        return existing ? mergeWebAgentSession(existing, remote) : remote;
      });
      return { agents: [...cloud, ...desktop] };
    }),
  patchAgentTurn: (agentId, patch) =>
    set((state) => ({
      agents: state.agents.map((agent) => {
        if (agent.id !== agentId) {
          return agent;
        }
        return {
          ...agent,
          stream: patch.response ?? agent.stream,
          turns: mapLastRunningTurn(agent.turns, (turn) => ({
            ...turn,
            ...patch,
          })),
        };
      }),
    })),
  setAgentCursorSessionId: (agentId, cursorSessionId) =>
    set((state) => ({
      agents: state.agents.map((agent) =>
        agent.id === agentId ? { ...agent, cursorSessionId } : agent,
      ),
    })),
  setAgentModelId: (agentId, modelId) =>
    set((state) => ({
      agents: state.agents.map((agent) => (agent.id === agentId ? { ...agent, modelId } : agent)),
    })),
  setAgentCommand: (agentId, agentCommand) =>
    set((state) => ({
      agents: state.agents.map((agent) =>
        agent.id === agentId
          ? {
              ...agent,
              agentCommand,
              cursorSessionId:
                agent.agentCommand === agentCommand ? agent.cursorSessionId : null,
            }
          : agent,
      ),
    })),
  setAgentModeId: (agentId, modeId) =>
    set((state) => ({
      agents: state.agents.map((agent) => (agent.id === agentId ? { ...agent, modeId } : agent)),
    })),
  setAgentStatus: (id, status) =>
    set((state) => ({
      agents: state.agents.map((agent) => {
        if (agent.id !== id) {
          return agent;
        }
        return {
          ...agent,
          status,
          turns: agent.turns.map((turn) =>
            turn.status === 'running'
              ? {
                  ...turn,
                  status,
                  thoughtStreaming: false,
                  endedAt: Date.now(),
                  activities: turn.activities.map((entry) =>
                    entry.streaming ? { ...entry, streaming: undefined } : entry,
                  ),
                }
              : turn,
          ),
        };
      }),
    })),
  addAgentTurn: (agentId, turn) =>
    set((state) => ({
      agents: state.agents.map((agent) =>
        agent.id === agentId
          ? {
              ...agent,
              status: 'running',
              commandId: turn.commandId,
              prompt: turn.prompt,
              stream: '',
              turns: [...agent.turns, turn],
            }
          : agent,
      ),
    })),
  upsertAgentTerminal: (agentId, terminal) =>
    set((state) => ({
      agents: state.agents.map((agent) => {
        if (agent.id !== agentId) {
          return agent;
        }
        const terminals = agent.terminals ?? [];
        if (terminals.some((entry) => entry.id === terminal.id)) {
          return {
            ...agent,
            terminals: terminals.map((entry) =>
              entry.id === terminal.id ? { ...entry, ...terminal } : entry,
            ),
          };
        }
        return {
          ...agent,
          terminals: [...terminals, terminal],
        };
      }),
    })),
  patchAgentTerminal: (agentId, terminalId, patch) =>
    set((state) => ({
      agents: state.agents.map((agent) => {
        if (agent.id !== agentId) {
          return agent;
        }
        return {
          ...agent,
          terminals: (agent.terminals ?? []).map((entry) =>
            entry.id === terminalId ? { ...entry, ...patch } : entry,
          ),
        };
      }),
    })),
  removeAgentTerminal: (agentId, terminalId) =>
    set((state) => ({
      agents: state.agents.map((agent) => {
        if (agent.id !== agentId) {
          return agent;
        }
        return {
          ...agent,
          terminals: (agent.terminals ?? []).filter((entry) => entry.id !== terminalId),
        };
      }),
    })),
  removeAgent: (id) =>
    set((state) => {
      if (!state.notifiedAgentIds[id]) {
        return { agents: state.agents.filter((agent) => agent.id !== id) };
      }
      const next = { ...state.notifiedAgentIds };
      delete next[id];
      return {
        agents: state.agents.filter((agent) => agent.id !== id),
        notifiedAgentIds: next,
      };
    }),
  markAgentReady: (id) =>
    set((state) => {
      if (state.notifiedAgentIds[id]) {
        return state;
      }
      return { notifiedAgentIds: { ...state.notifiedAgentIds, [id]: true } };
    }),
  clearAgentNotification: (id) =>
    set((state) => {
      if (!state.notifiedAgentIds[id]) {
        return state;
      }
      const next = { ...state.notifiedAgentIds };
      delete next[id];
      return { notifiedAgentIds: next };
    }),
}));
