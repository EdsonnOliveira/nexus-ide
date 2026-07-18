import { create } from 'zustand';
import type {
  CloudProject,
  CloudWorkspace,
  CommandApproval,
  DeviceRecord,
} from '@nexus/protocol';
import type { Session, User } from '@supabase/supabase-js';

export interface WebAgentTurn {
  id: string;
  prompt: string;
  thought: string;
  thoughtStreaming: boolean;
  response: string;
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
  modeId: 'agent' | 'plan' | 'debug' | 'multitask' | 'ask';
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
  patchAgentTurn: (
    agentId: string,
    patch: Partial<Pick<WebAgentTurn, 'thought' | 'thoughtStreaming' | 'response' | 'status' | 'endedAt'>>,
  ) => void;
  setAgentCursorSessionId: (agentId: string, cursorSessionId: string | null) => void;
  setAgentModelId: (agentId: string, modelId: string) => void;
  setAgentModeId: (
    agentId: string,
    modeId: WebAgentSession['modeId'],
  ) => void;
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
      agents: state.agents.map((agent) =>
        agent.id === agentId ? { ...agent, modelId } : agent,
      ),
    })),
  setAgentModeId: (agentId, modeId) =>
    set((state) => ({
      agents: state.agents.map((agent) =>
        agent.id === agentId ? { ...agent, modeId } : agent,
      ),
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
    set((state) => ({
      agents: state.agents.filter((agent) => agent.id !== id),
    })),
}));
