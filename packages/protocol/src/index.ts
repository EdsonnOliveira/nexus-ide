export const PROTOCOL_VERSION = 1 as const;

export type Unsubscribe = () => void;

export type CommandStatus =
  | 'pending'
  | 'claimed'
  | 'running'
  | 'waiting_user'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type CommandType =
  | 'agent_prompt'
  | 'agent_cancel'
  | 'terminal_create'
  | 'terminal_stdin'
  | 'terminal_resize'
  | 'terminal_interrupt'
  | 'terminal_close'
  | 'file_read'
  | 'file_read_image'
  | 'file_download'
  | 'file_write'
  | 'apply_file_patch'
  | 'git_status'
  | 'git_commit'
  | 'git_push'
  | 'scan_projects'
  | 'sync_local_state';

export type NexusEventType =
  | 'device.online'
  | 'device.offline'
  | 'device.capabilities.updated'
  | 'project.opened'
  | 'project.closed'
  | 'project.updated'
  | 'terminal.created'
  | 'terminal.output'
  | 'terminal.resized'
  | 'terminal.closed'
  | 'agent.started'
  | 'agent.message.delta'
  | 'agent.tool.started'
  | 'agent.tool.completed'
  | 'agent.waiting_user'
  | 'agent.completed'
  | 'agent.failed'
  | 'file.opened'
  | 'file.changed'
  | 'file.patch.applied'
  | 'file.conflict'
  | 'command.created'
  | 'command.claimed'
  | 'command.completed'
  | 'command.cancelled';

export interface NexusEventEnvelope<TPayload = Record<string, unknown>> {
  event_id: string;
  protocol_version: typeof PROTOCOL_VERSION;
  workspace_id: string;
  device_id?: string | null;
  project_id?: string | null;
  execution_id?: string | null;
  type: NexusEventType;
  sequence: number;
  timestamp: string;
  payload: TPayload;
}

export interface NexusCommand {
  id?: string;
  workspace_id: string;
  project_id?: string | null;
  target_device_id: string;
  agent_id?: string | null;
  terminal_session_id?: string | null;
  type: CommandType;
  payload: Record<string, unknown>;
  idempotency_key?: string | null;
  status?: CommandStatus;
}

export interface DeviceCapabilities {
  terminal: boolean;
  filesystem: boolean;
  git: boolean;
  docker: boolean;
  ios_simulator: boolean;
  android_emulator: boolean;
  xcode: boolean;
  node: boolean;
}

export interface RuntimeStatus {
  online: boolean;
  deviceId: string | null;
  workspaceId: string | null;
  hostname: string | null;
  name: string | null;
  lastSeenAt: string | null;
  capabilities: DeviceCapabilities;
  activeAgents: number;
  activeTerminals: number;
}

export interface DeviceRecord {
  id: string;
  workspace_id: string;
  owner_id: string;
  name: string;
  hostname: string | null;
  platform: string;
  architecture: string | null;
  runtime_version: string | null;
  app_version: string | null;
  status: string;
  last_seen_at: string | null;
  is_enabled: boolean;
  is_default: boolean;
  capabilities: DeviceCapabilities | Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CloudWorkspace {
  id: string;
  name: string;
  owner_id: string;
  local_id: string | null;
  color: string | null;
  icon: string | null;
  logo_url: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CloudProject {
  id: string;
  workspace_id: string;
  name: string;
  slug: string | null;
  color: string | null;
  icon: string | null;
  logo_url: string | null;
  local_id: string | null;
  sort_order: number;
  local_path: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DeviceProject {
  id: string;
  device_id: string;
  project_id: string;
  local_path: string;
  is_available: boolean;
  git_branch: string | null;
  git_remote_url: string | null;
  dependencies_status: string | null;
  last_scanned_at: string | null;
  last_opened_at: string | null;
  metadata: Record<string, unknown>;
}

export interface CommandApproval {
  id: string;
  command_id: string;
  workspace_id: string;
  reason: string;
  status: 'pending' | 'approved' | 'denied';
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface BrainDocument {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string;
  content: string;
  kind: string;
  created_at: string;
  updated_at: string;
}

export interface BrainMeeting {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string;
  notes: string;
  occurred_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BrainDecision {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string;
  body: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export function createEventEnvelope<TPayload extends Record<string, unknown>>(
  input: Omit<NexusEventEnvelope<TPayload>, 'protocol_version' | 'timestamp' | 'event_id'> & {
    event_id?: string;
    timestamp?: string;
  },
): NexusEventEnvelope<TPayload> {
  return {
    event_id: input.event_id ?? crypto.randomUUID(),
    protocol_version: PROTOCOL_VERSION,
    workspace_id: input.workspace_id,
    device_id: input.device_id ?? null,
    project_id: input.project_id ?? null,
    execution_id: input.execution_id ?? null,
    type: input.type,
    sequence: input.sequence,
    timestamp: input.timestamp ?? new Date().toISOString(),
    payload: input.payload,
  };
}

export const DEFAULT_CAPABILITIES: DeviceCapabilities = {
  terminal: true,
  filesystem: true,
  git: true,
  docker: false,
  ios_simulator: false,
  android_emulator: false,
  xcode: false,
  node: true,
};

export const DANGEROUS_COMMAND_PATTERNS = [
  /\bsudo\b/i,
  /\brm\s+-rf\b/i,
  /\bgit\s+push\s+.*--force\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /~\/\.ssh\b/i,
  /\bkeychain\b/i,
] as const;

export function isDangerousPayload(payload: Record<string, unknown>): boolean {
  const text = JSON.stringify(payload);
  return DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(text));
}

const WRAPPING_QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ['\u201c', '\u201d'],
  ['\u2018', '\u2019'],
];

export function sanitizeDeviceName(name: string | null | undefined): string {
  let result = (name ?? '').trim();

  let stripped = true;
  while (stripped && result.length >= 2) {
    stripped = false;
    for (const [open, close] of WRAPPING_QUOTE_PAIRS) {
      if (result.startsWith(open) && result.endsWith(close)) {
        result = result.slice(open.length, result.length - close.length).trim();
        stripped = true;
        break;
      }
    }
  }

  return result;
}
