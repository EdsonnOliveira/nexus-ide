export type MissionStatus =
  | 'draft'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type MissionNodeStatus =
  | 'pending'
  | 'waiting'
  | 'running'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'cancelled';

export type MissionEdgeType =
  | 'handoff'
  | 'dependency'
  | 'parallel'
  | 'validation'
  | 'trigger'
  | 'shared_discovery';

export type MissionEdgeCondition =
  | 'on_success'
  | 'on_completion'
  | 'on_failure'
  | 'always'
  | 'after_approval'
  | 'custom';

export type MissionFailureStrategy =
  | 'stop'
  | 'continue'
  | 'retry'
  | 'request_user'
  | 'route_to_agent';

export type MissionBudgetStrategy = 'speed' | 'balanced' | 'economy';

export type MissionSubagentPolicy = 'never' | 'ask' | 'auto';

export type MissionInboxKind =
  | 'approval'
  | 'choice'
  | 'permission'
  | 'conflict'
  | 'spawn_request'
  | 'info';

export type AgentExecutionStepStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface MissionHandoffPayload {
  summary?: boolean;
  discoveries?: boolean;
  relatedFiles?: boolean;
  changedFiles?: boolean;
  diff?: boolean;
  logs?: boolean;
  commands?: boolean;
  conversation?: boolean;
  testResults?: boolean;
}

export interface MissionBudget {
  maxAgents?: number;
  maxTokens?: number;
  maxCostUsd?: number;
  maxDurationMs?: number;
  strategy: MissionBudgetStrategy;
}

export interface AgentExecutionStep {
  id: string;
  label: string;
  status: AgentExecutionStepStatus;
  startedAt?: string;
  completedAt?: string;
}

export interface ContextReference {
  id: string;
  kind: 'mission' | 'handoff' | 'discovery' | 'capsule' | 'project' | 'file' | 'task';
  label: string;
  sourceNodeId?: string;
}

export interface ContextCapsule {
  id: string;
  missionId: string;
  title: string;
  content: string;
  sourceNodeId?: string;
  createdAt: string;
  tags?: string[];
}

export interface MissionDiscovery {
  id: string;
  missionId: string;
  sourceNodeId: string;
  content: string;
  createdAt: string;
  sharedWithNodeIds: string[];
}

export type MissionQaEvidenceKind = 'text' | 'image' | 'video';

export interface MissionQaEvidence {
  id: string;
  kind: MissionQaEvidenceKind;
  title: string;
  content?: string;
  path?: string;
  createdAt: string;
}

export type MissionNodeKind =
  | 'mission'
  | 'agent'
  | 'browser'
  | 'emulator'
  | 'terminal'
  | 'api'
  | 'automation';

export type MissionAutomationConfigValue = string | number | boolean | null;

export interface MissionAutomationConfig {
  category: string;
  nodeType: string;
  provider?: string;
  action?: string;
  config: Record<string, MissionAutomationConfigValue>;
  output?: Record<string, unknown>;
}

export interface MissionAgentNode {
  id: string;
  kind?: MissionNodeKind;
  agentTemplateId: string;
  projectId: string;
  paneId: string | null;
  roleId: string;
  name?: string;
  objective: string;
  identity?: string;
  status: MissionNodeStatus;
  progress: number;
  aiProvider?: 'cursor' | 'claude' | 'opencode' | 'antigravity';
  model?: string;
  iteration: number;
  maxIterations: number;
  attempt: number;
  maxAttempts: number;
  position: { x: number; y: number };
  size?: { width: number; height: number };
  startedAt?: string;
  completedAt?: string;
  currentStep?: AgentExecutionStep;
  checklist: AgentExecutionStep[];
  contextRefs: ContextReference[];
  worktreePath?: string | null;
  worktreeBranch?: string | null;
  lastError?: string;
  injectedContext?: string;
  flowInstanceId?: string;
  automation?: MissionAutomationConfig;
  evidences?: MissionQaEvidence[];
  transcriptTurns?: unknown[];
  transcriptFollowUps?: unknown[];
  transcriptCapturedAt?: string;
}

export interface MissionEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: MissionEdgeType;
  condition: MissionEdgeCondition;
  payload: MissionHandoffPayload;
  timeoutMs?: number;
  failureStrategy?: MissionFailureStrategy;
  label?: string;
}

export interface MissionResultSummary {
  editedFileCount: number;
  projectIds: string[];
  testPassedCount?: number;
  alertCount: number;
  decisionCount: number;
  responseLead?: string;
}

export interface MissionAttachment {
  id: string;
  name: string;
  kind: 'image' | 'file';
  path: string;
  mimeType?: string;
}

export interface MissionSourceTaskRef {
  projectId: string;
  projectName: string;
  taskId: string;
  title: string;
}

export interface MissionInboxItem {
  id: string;
  missionId: string;
  nodeId?: string;
  kind: MissionInboxKind;
  title: string;
  message: string;
  createdAt: string;
  resolvedAt?: string;
  actions?: Array<{ id: string; label: string }>;
}

export interface Mission {
  id: string;
  title: string;
  description?: string;
  objective?: string;
  status: MissionStatus;
  progress: number;
  nodes: MissionAgentNode[];
  edges: MissionEdge[];
  maxParallelAgents: number;
  maxIterations: number;
  subagentPolicy: MissionSubagentPolicy;
  maxSubagents: number;
  budget: MissionBudget;
  capsules: ContextCapsule[];
  discoveries: MissionDiscovery[];
  inbox: MissionInboxItem[];
  attachments?: MissionAttachment[];
  sourceTasks?: MissionSourceTaskRef[];
  defaultProjectId?: string | null;
  result?: MissionResultSummary;
  sourcePaneId?: string | null;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  viewport?: { x: number; y: number; zoom: number };
}

export interface AgentRole {
  id: string;
  name: string;
  description: string;
  instructions: string;
  permissions: string[];
  tools: string[];
  expectedOutput?: string;
  preferredMode?: 'agent' | 'ask' | 'plan';
  builtin: boolean;
}

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  instructions: string;
  defaultObjective?: string;
  defaultRoleId: string;
  tools: string[];
  permissions: string[];
  model: string;
  builtin: boolean;
}

export interface MissionFlowTemplateNode {
  id: string;
  kind?: MissionNodeKind;
  agentTemplateId: string;
  roleId: string;
  name?: string;
  objective: string;
  identity?: string;
  position: { x: number; y: number };
  size?: { width: number; height: number };
  automation?: MissionAutomationConfig;
}

export interface MissionFlowTemplateEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: MissionEdgeType;
  condition: MissionEdgeCondition;
  payload: MissionHandoffPayload;
  label?: string;
}

export interface MissionFlowTemplate {
  id: string;
  name: string;
  description?: string;
  nodes: MissionFlowTemplateNode[];
  edges: MissionFlowTemplateEdge[];
  createdAt: string;
  updatedAt: string;
}

export interface MissionStoreState {
  missions: Mission[];
  customRoles: AgentRole[];
  customTemplates: AgentTemplate[];
  flowTemplates: MissionFlowTemplate[];
}

export interface CreateMissionInput {
  title: string;
  description?: string;
  objective?: string;
  nodes?: MissionAgentNode[];
  edges?: MissionEdge[];
  sourcePaneId?: string | null;
  maxParallelAgents?: number;
  budget?: Partial<MissionBudget>;
  subagentPolicy?: MissionSubagentPolicy;
  attachments?: MissionAttachment[];
  sourceTasks?: MissionSourceTaskRef[];
  defaultProjectId?: string | null;
  capsules?: ContextCapsule[];
}

export const DEFAULT_HANDOFF_PAYLOAD: MissionHandoffPayload = {
  summary: true,
  discoveries: true,
  relatedFiles: true,
  changedFiles: true,
  diff: true,
  logs: false,
  commands: true,
  conversation: false,
  testResults: true,
};

export const DEFAULT_MISSION_BUDGET: MissionBudget = {
  maxTokens: 1_000_000,
  maxCostUsd: 5,
  strategy: 'balanced',
};
