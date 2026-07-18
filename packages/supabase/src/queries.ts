import type { NexusClient } from './client';

export interface WorkspaceMemberRow {
  workspace_id: string;
}

export interface DeviceRow {
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
  capabilities: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceRow {
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

export interface ProjectRow {
  id: string;
  workspace_id: string;
  name: string;
  slug: string | null;
  color: string | null;
  icon: string | null;
  logo_url: string | null;
  local_id: string | null;
  sort_order: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  local_path?: string | null;
}

export interface CommandRow {
  id: string;
  workspace_id: string;
  project_id: string | null;
  created_by: string;
  target_device_id: string;
  agent_id: string | null;
  terminal_session_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  status: string;
  idempotency_key: string | null;
  claimed_by_device_id: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  result: Record<string, unknown> | null;
  attempt_count: number;
  created_at: string;
}

export interface CommandInsert {
  id?: string;
  workspace_id: string;
  project_id?: string | null;
  created_by: string;
  target_device_id: string;
  agent_id?: string | null;
  terminal_session_id?: string | null;
  type: string;
  payload?: Record<string, unknown>;
  status?: string;
  idempotency_key?: string | null;
}

export interface ApprovalRow {
  id: string;
  command_id: string;
  workspace_id: string;
  reason: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface BrainDocumentRow {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string;
  content: string;
  kind: string;
  created_at: string;
  updated_at: string;
}

export interface BrainMeetingRow {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string;
  notes: string;
  occurred_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BrainDecisionRow {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string;
  body: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function getPrimaryWorkspace(client: NexusClient): Promise<WorkspaceMemberRow | null> {
  const devices = await listDevices(client);
  const preferredDevice =
    devices.find((device) => device.is_default && isDeviceOnline(device.last_seen_at)) ??
    devices.find((device) => isDeviceOnline(device.last_seen_at)) ??
    devices.find((device) => device.is_enabled) ??
    devices[0] ??
    null;

  if (preferredDevice?.workspace_id) {
    return { workspace_id: preferredDevice.workspace_id };
  }

  const { data, error } = await client
    .from('workspace_members')
    .select('workspace_id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as WorkspaceMemberRow | null;
}

export async function listDevices(
  client: NexusClient,
  workspaceId?: string,
): Promise<DeviceRow[]> {
  let query = client.from('devices').select('*').order('name', { ascending: true });

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []) as DeviceRow[];
}

export function generatePairingCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let index = 0; index < 6; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export async function createDevicePairing(
  client: NexusClient,
  input: { workspaceId: string; userId: string; name: string },
): Promise<{ id: string; code: string; expires_at: string; name: string }> {
  const code = generatePairingCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from('device_pairings')
    .insert({
      workspace_id: input.workspaceId,
      created_by: input.userId,
      name: input.name.trim() || 'Meu Mac',
      code,
      status: 'pending',
      expires_at: expiresAt,
    })
    .select('id, code, expires_at, name')
    .single();

  if (error) {
    throw error;
  }

  return data as { id: string; code: string; expires_at: string; name: string };
}

export async function listPendingPairings(
  client: NexusClient,
  workspaceId?: string,
): Promise<
  Array<{ id: string; code: string; name: string; expires_at: string; status: string }>
> {
  let query = client
    .from('device_pairings')
    .select('id, code, name, expires_at, status')
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return (data ?? []) as Array<{
    id: string;
    code: string;
    name: string;
    expires_at: string;
    status: string;
  }>;
}

export async function claimDevicePairing(
  client: NexusClient,
  input: {
    code: string;
    deviceId: string;
    name?: string | null;
    hostname?: string | null;
    architecture?: string | null;
    capabilities?: Record<string, unknown>;
  },
): Promise<DeviceRow> {
  const { data, error } = await client.rpc('claim_device_pairing', {
    p_code: input.code,
    p_device_id: input.deviceId,
    p_name: input.name ?? null,
    p_hostname: input.hostname ?? null,
    p_architecture: input.architecture ?? null,
    p_capabilities: input.capabilities ?? {},
  });

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new Error('Falha ao reivindicar código de pareamento');
  }

  return row as DeviceRow;
}

export async function listWorkspaces(client: NexusClient): Promise<WorkspaceRow[]> {
  const { data: memberships, error: membershipError } = await client
    .from('workspace_members')
    .select('workspace_id');

  if (membershipError) {
    throw membershipError;
  }

  const workspaceIds = (memberships ?? []).map((row) => row.workspace_id as string);
  if (workspaceIds.length === 0) {
    return [];
  }

  const { data, error } = await client
    .from('workspaces')
    .select('*')
    .in('id', workspaceIds)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as WorkspaceRow[];
}

export async function listProjects(client: NexusClient, workspaceId?: string): Promise<ProjectRow[]> {
  let query = client
    .from('projects')
    .select('*, device_projects(local_path, device_id, is_available)')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => {
    const record = row as ProjectRow & {
      device_projects?: Array<{ local_path?: string; is_available?: boolean }>;
    };
    const deviceProject = (record.device_projects ?? []).find((item) => item.is_available !== false);
    return {
      ...record,
      local_path: deviceProject?.local_path ?? null,
      metadata: record.metadata ?? {},
    };
  });
}

export async function requestLocalSync(
  client: NexusClient,
  input: {
    workspaceId: string;
    deviceId: string;
    userId: string;
  },
): Promise<string> {
  const command = await createCommand(client, {
    workspace_id: input.workspaceId,
    created_by: input.userId,
    target_device_id: input.deviceId,
    type: 'sync_local_state',
    payload: {},
    status: 'pending',
    idempotency_key: `sync:${input.deviceId}:${Date.now()}`,
  });
  return command.id;
}

export async function createCommand(client: NexusClient, input: CommandInsert): Promise<CommandRow> {
  const { data, error } = await client.from('commands').insert(input).select('*').single();

  if (error) {
    throw new Error(error.message || 'Falha ao criar comando');
  }

  return data as CommandRow;
}

export async function listPendingApprovals(
  client: NexusClient,
  workspaceId: string,
): Promise<ApprovalRow[]> {
  const { data, error } = await client
    .from('command_approvals')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as ApprovalRow[];
}

export async function decideApproval(
  client: NexusClient,
  approvalId: string,
  status: 'approved' | 'denied',
  userId: string,
): Promise<ApprovalRow> {
  const { data, error } = await client
    .from('command_approvals')
    .update({
      status,
      decided_by: userId,
      decided_at: new Date().toISOString(),
    })
    .eq('id', approvalId)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data as ApprovalRow;
}

export async function listBrainDocuments(
  client: NexusClient,
  workspaceId: string,
  projectId?: string,
): Promise<BrainDocumentRow[]> {
  let query = client.from('brain_documents').select('*').eq('workspace_id', workspaceId);
  if (projectId) {
    query = query.eq('project_id', projectId);
  }
  const { data, error } = await query.order('updated_at', { ascending: false });
  if (error) {
    throw error;
  }
  return (data ?? []) as BrainDocumentRow[];
}

export async function listBrainMeetings(
  client: NexusClient,
  workspaceId: string,
  projectId?: string,
): Promise<BrainMeetingRow[]> {
  let query = client.from('brain_meetings').select('*').eq('workspace_id', workspaceId);
  if (projectId) {
    query = query.eq('project_id', projectId);
  }
  const { data, error } = await query.order('updated_at', { ascending: false });
  if (error) {
    throw error;
  }
  return (data ?? []) as BrainMeetingRow[];
}

export async function listBrainDecisions(
  client: NexusClient,
  workspaceId: string,
  projectId?: string,
): Promise<BrainDecisionRow[]> {
  let query = client.from('brain_decisions').select('*').eq('workspace_id', workspaceId);
  if (projectId) {
    query = query.eq('project_id', projectId);
  }
  const { data, error } = await query.order('updated_at', { ascending: false });
  if (error) {
    throw error;
  }
  return (data ?? []) as BrainDecisionRow[];
}

export async function upsertBrainDocument(
  client: NexusClient,
  input: {
    workspace_id: string;
    project_id?: string | null;
    title: string;
    content?: string;
    kind?: string;
    created_by?: string | null;
  },
): Promise<BrainDocumentRow> {
  const { data, error } = await client.from('brain_documents').insert(input).select('*').single();
  if (error) {
    throw error;
  }
  return data as BrainDocumentRow;
}

export async function claimCommand(
  client: NexusClient,
  deviceId: string,
  leaseSeconds = 60,
): Promise<CommandRow | null> {
  const { data, error } = await client.rpc('claim_command', {
    p_device_id: deviceId,
    p_lease_seconds: leaseSeconds,
  });

  if (error) {
    throw error;
  }

  return (data as CommandRow | null) ?? null;
}

export async function touchHeartbeat(
  client: NexusClient,
  deviceId: string,
  payload: Record<string, unknown> = {},
): Promise<DeviceRow> {
  const { data, error } = await client.rpc('touch_device_heartbeat', {
    p_device_id: deviceId,
    p_payload: payload,
  });

  if (error) {
    throw error;
  }

  return data as DeviceRow;
}

export function isDeviceOnline(lastSeenAt: string | null, offlineAfterMs = 45_000): boolean {
  if (!lastSeenAt) {
    return false;
  }
  return Date.now() - new Date(lastSeenAt).getTime() < offlineAfterMs;
}

export interface VercelDeploySnapshotRow {
  user_id: string;
  active_deployment: unknown;
  deployments: unknown[];
  updated_at: string;
}

export async function getVercelDeploySnapshot(
  client: NexusClient,
  userId: string,
): Promise<VercelDeploySnapshotRow | null> {
  const { data, error } = await client
    .from('vercel_deploy_snapshots')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return (data as VercelDeploySnapshotRow | null) ?? null;
}

export async function upsertVercelDeploySnapshot(
  client: NexusClient,
  input: {
    user_id: string;
    active_deployment: unknown;
    deployments: unknown[];
  },
): Promise<VercelDeploySnapshotRow> {
  const { data, error } = await client
    .from('vercel_deploy_snapshots')
    .upsert(
      {
        user_id: input.user_id,
        active_deployment: input.active_deployment,
        deployments: input.deployments,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    .select('*')
    .single();
  if (error) {
    throw error;
  }
  return data as VercelDeploySnapshotRow;
}

export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
  updated_at: string;
}

export interface PushPreferencesRow {
  user_id: string;
  agent_enabled: boolean;
  deploy_enabled: boolean;
  device_enabled: boolean;
  updated_at: string;
}

export async function upsertPushSubscription(
  client: NexusClient,
  input: {
    user_id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    user_agent?: string | null;
  },
): Promise<PushSubscriptionRow> {
  const { data, error } = await client
    .from('push_subscriptions')
    .upsert(
      {
        user_id: input.user_id,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        user_agent: input.user_agent ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    )
    .select('*')
    .single();
  if (error) {
    throw error;
  }
  return data as PushSubscriptionRow;
}

export async function deletePushSubscription(
  client: NexusClient,
  userId: string,
  endpoint: string,
): Promise<void> {
  const { error } = await client
    .from('push_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('endpoint', endpoint);
  if (error) {
    throw error;
  }
}

export async function listPushSubscriptions(
  client: NexusClient,
  userId: string,
): Promise<PushSubscriptionRow[]> {
  const { data, error } = await client
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', userId);
  if (error) {
    throw error;
  }
  return (data as PushSubscriptionRow[]) ?? [];
}

export async function getPushPreferences(
  client: NexusClient,
  userId: string,
): Promise<PushPreferencesRow | null> {
  const { data, error } = await client
    .from('push_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return (data as PushPreferencesRow | null) ?? null;
}

export async function upsertPushPreferences(
  client: NexusClient,
  input: {
    user_id: string;
    agent_enabled: boolean;
    deploy_enabled: boolean;
    device_enabled: boolean;
  },
): Promise<PushPreferencesRow> {
  const { data, error } = await client
    .from('push_preferences')
    .upsert(
      {
        user_id: input.user_id,
        agent_enabled: input.agent_enabled,
        deploy_enabled: input.deploy_enabled,
        device_enabled: input.device_enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    .select('*')
    .single();
  if (error) {
    throw error;
  }
  return data as PushPreferencesRow;
}

export async function upsertUserVercelToken(
  client: NexusClient,
  userId: string,
  token: string,
): Promise<void> {
  const { error } = await client.from('user_vercel_tokens').upsert(
    {
      user_id: userId,
      token,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) {
    throw error;
  }
}

export async function deleteUserVercelToken(
  client: NexusClient,
  userId: string,
): Promise<void> {
  const { error } = await client.from('user_vercel_tokens').delete().eq('user_id', userId);
  if (error) {
    throw error;
  }
}

export interface AgentSessionRow {
  id: string;
  workspace_id: string;
  project_id: string | null;
  device_id: string | null;
  title: string | null;
  status: string;
  cursor_chat_id: string | null;
  model_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentExecutionRow {
  id: string;
  session_id: string;
  command_id: string | null;
  status: string;
  prompt: string | null;
  result: Record<string, unknown> | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface AgentMessageRow {
  id: string;
  session_id: string;
  execution_id: string | null;
  role: string;
  content: string;
  sequence: number;
  created_at: string;
}

export interface AgentSessionBundle {
  session: AgentSessionRow;
  project: ProjectRow | null;
  executions: AgentExecutionRow[];
  messages: AgentMessageRow[];
}

export async function createAgentSession(
  client: NexusClient,
  input: {
    id: string;
    workspace_id: string;
    project_id: string | null;
    device_id: string | null;
    title: string;
    created_by: string;
    model_id?: string | null;
  },
): Promise<AgentSessionRow> {
  const { data, error } = await client
    .from('agent_sessions')
    .insert({
      id: input.id,
      workspace_id: input.workspace_id,
      project_id: input.project_id,
      device_id: input.device_id,
      title: input.title,
      status: 'running',
      model_id: input.model_id ?? 'auto',
      created_by: input.created_by,
    })
    .select('*')
    .single();
  if (error) {
    throw error;
  }
  return data as AgentSessionRow;
}

export async function closeAgentSession(
  client: NexusClient,
  sessionId: string,
): Promise<void> {
  const { error } = await client
    .from('agent_sessions')
    .update({
      status: 'closed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);
  if (error) {
    throw error;
  }
}

export async function updateAgentSessionMeta(
  client: NexusClient,
  sessionId: string,
  patch: {
    cursor_chat_id?: string | null;
    model_id?: string | null;
    status?: string;
  },
): Promise<void> {
  const { error } = await client
    .from('agent_sessions')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);
  if (error) {
    throw error;
  }
}

export async function listOpenAgentSessionBundles(
  client: NexusClient,
  workspaceId: string,
  createdBy?: string | null,
): Promise<AgentSessionBundle[]> {
  let query = client
    .from('agent_sessions')
    .select('*')
    .eq('workspace_id', workspaceId)
    .neq('status', 'closed')
    .order('updated_at', { ascending: false });

  if (createdBy) {
    query = query.eq('created_by', createdBy);
  }

  const { data: sessions, error } = await query;
  if (error) {
    throw error;
  }

  const rows = (sessions as AgentSessionRow[] | null) ?? [];
  if (rows.length === 0) {
    return [];
  }

  const sessionIds = rows.map((row) => row.id);
  const projectIds = [
    ...new Set(rows.map((row) => row.project_id).filter((id): id is string => Boolean(id))),
  ];

  const [{ data: executions }, { data: messages }, { data: projects }, { data: deviceProjects }] =
    await Promise.all([
      client
        .from('agent_executions')
        .select('*')
        .in('session_id', sessionIds)
        .order('created_at', { ascending: true }),
      client
        .from('agent_messages')
        .select('*')
        .in('session_id', sessionIds)
        .order('sequence', { ascending: true }),
      projectIds.length > 0
        ? client.from('projects').select('*').in('id', projectIds)
        : Promise.resolve({ data: [] as ProjectRow[] }),
      projectIds.length > 0
        ? client
            .from('device_projects')
            .select('project_id, device_id, local_path, is_available')
            .in('project_id', projectIds)
        : Promise.resolve({
            data: [] as Array<{
              project_id: string;
              device_id: string;
              local_path: string | null;
              is_available?: boolean;
            }>,
          }),
    ]);

  const projectsById = new Map(
    ((projects as ProjectRow[] | null) ?? []).map((project) => [project.id, project]),
  );
  const deviceProjectsList =
    (deviceProjects as Array<{
      project_id: string;
      device_id: string;
      local_path: string | null;
      is_available?: boolean;
    }> | null) ?? [];
  const executionsBySession = new Map<string, AgentExecutionRow[]>();
  for (const execution of (executions as AgentExecutionRow[] | null) ?? []) {
    const list = executionsBySession.get(execution.session_id) ?? [];
    list.push(execution);
    executionsBySession.set(execution.session_id, list);
  }
  const messagesBySession = new Map<string, AgentMessageRow[]>();
  for (const message of (messages as AgentMessageRow[] | null) ?? []) {
    const list = messagesBySession.get(message.session_id) ?? [];
    list.push(message);
    messagesBySession.set(message.session_id, list);
  }

  return rows.map((session) => {
    const project = session.project_id ? projectsById.get(session.project_id) ?? null : null;
    const matchingDeviceProjects = deviceProjectsList.filter(
      (entry) => entry.project_id === session.project_id,
    );
    const preferredDeviceProject =
      matchingDeviceProjects.find((entry) => entry.device_id === session.device_id) ??
      matchingDeviceProjects.find((entry) => entry.is_available !== false) ??
      matchingDeviceProjects[0] ??
      null;

    return {
      session,
      project: project
        ? {
            ...project,
            local_path: preferredDeviceProject?.local_path ?? project.local_path ?? null,
          }
        : null,
      executions: executionsBySession.get(session.id) ?? [],
      messages: messagesBySession.get(session.id) ?? [],
    };
  });
}
