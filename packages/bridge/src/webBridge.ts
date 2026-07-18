import {
  createNexusSupabaseClient,
  createCommand,
  decideApproval,
  getPrimaryWorkspace,
  isDeviceOnline,
  createDevicePairing,
  listDevices,
  listPendingApprovals,
  listPendingPairings,
  listProjects,
  listWorkspaces,
  requestLocalSync,
  type NexusSupabaseConfig,
} from '@nexus/supabase';
import {
  DEFAULT_CAPABILITIES,
  isDangerousPayload,
  type CloudProject,
  type CloudWorkspace,
  type CommandApproval,
  type DeviceCapabilities,
  type DeviceRecord,
  type NexusCommand,
  type RuntimeStatus,
  type Unsubscribe,
} from '@nexus/protocol';
import type { NexusBridge } from './types';

function asCapabilities(value: unknown): DeviceCapabilities {
  if (!value || typeof value !== 'object') {
    return DEFAULT_CAPABILITIES;
  }
  return { ...DEFAULT_CAPABILITIES, ...(value as DeviceCapabilities) };
}

export function createWebBridge(config: NexusSupabaseConfig): NexusBridge {
  const client = createNexusSupabaseClient(config);
  let cachedWorkspaceId: string | null = null;

  async function resolveWorkspaceId(): Promise<string> {
    if (cachedWorkspaceId) {
      return cachedWorkspaceId;
    }
    const membership = await getPrimaryWorkspace(client);
    const workspaceId = membership?.workspace_id;
    if (!workspaceId) {
      throw new Error('Workspace não encontrado. Faça login novamente.');
    }
    cachedWorkspaceId = workspaceId;
    return workspaceId;
  }

  return {
    async executeCommand(command: NexusCommand): Promise<string> {
      const {
        data: { user },
      } = await client.auth.getUser();
      if (!user) {
        throw new Error('Usuário não autenticado');
      }

      const workspaceId = command.workspace_id || (await resolveWorkspaceId());

      if (isDangerousPayload(command.payload)) {
        const inserted = await createCommand(client, {
          workspace_id: workspaceId,
          project_id: command.project_id ?? null,
          created_by: user.id,
          target_device_id: command.target_device_id,
          agent_id: command.agent_id ?? null,
          terminal_session_id: command.terminal_session_id ?? null,
          type: command.type,
          payload: command.payload,
          status: 'waiting_user',
          idempotency_key: command.idempotency_key ?? null,
        });

        const { error } = await client.from('command_approvals').insert({
          command_id: inserted.id,
          workspace_id: workspaceId,
          reason: 'Comando potencialmente perigoso',
          status: 'pending',
        });
        if (error) {
          throw error;
        }

        return inserted.id;
      }

      const inserted = await createCommand(client, {
        workspace_id: workspaceId,
        project_id: command.project_id ?? null,
        created_by: user.id,
        target_device_id: command.target_device_id,
        agent_id: command.agent_id ?? null,
        terminal_session_id: command.terminal_session_id ?? null,
        type: command.type,
        payload: command.payload,
        status: 'pending',
        idempotency_key: command.idempotency_key ?? null,
      });

      return inserted.id;
    },

    subscribeToExecution(id: string, onEvent: (payload: unknown) => void): Unsubscribe {
      const channel = client
        .channel(`execution:${id}`)
        .on('broadcast', { event: 'nexus' }, (message) => {
          onEvent(message.payload);
        })
        .subscribe();

      return () => {
        void client.removeChannel(channel);
      };
    },

    async getRuntimeStatus(): Promise<RuntimeStatus> {
      const workspaceId = await resolveWorkspaceId();
      const devices = await listDevices(client);
      const defaultDevice =
        devices.find((device) => device.is_default && isDeviceOnline(device.last_seen_at)) ??
        devices.find((device) => isDeviceOnline(device.last_seen_at)) ??
        devices[0] ??
        null;

      return {
        online: defaultDevice ? isDeviceOnline(defaultDevice.last_seen_at) : false,
        deviceId: defaultDevice?.id ?? null,
        workspaceId,
        hostname: defaultDevice?.hostname ?? null,
        name: defaultDevice?.name ?? null,
        lastSeenAt: defaultDevice?.last_seen_at ?? null,
        capabilities: asCapabilities(defaultDevice?.capabilities),
        activeAgents: 0,
        activeTerminals: 0,
      };
    },

    async listDevices(): Promise<DeviceRecord[]> {
      const devices = await listDevices(client);
      return devices.map((device) => ({
        ...device,
        capabilities: asCapabilities(device.capabilities),
        metadata: device.metadata ?? {},
      }));
    },

    async createDevicePairing(name: string, workspaceId?: string | null) {
      const {
        data: { user },
      } = await client.auth.getUser();
      if (!user) {
        throw new Error('Usuário não autenticado');
      }
      const targetWorkspaceId = workspaceId || (await resolveWorkspaceId());
      return createDevicePairing(client, {
        workspaceId: targetWorkspaceId,
        userId: user.id,
        name,
      });
    },

    async listPendingPairings() {
      return listPendingPairings(client);
    },

    async listWorkspaces(): Promise<CloudWorkspace[]> {
      const workspaces = await listWorkspaces(client);
      return workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        owner_id: workspace.owner_id,
        local_id: workspace.local_id,
        color: workspace.color,
        icon: workspace.icon,
        logo_url: workspace.logo_url,
        sort_order: workspace.sort_order ?? 0,
        created_at: workspace.created_at,
        updated_at: workspace.updated_at,
      }));
    },

    async listProjects(workspaceId?: string | null): Promise<CloudProject[]> {
      const projects = await listProjects(client, workspaceId ?? undefined);
      return projects.map((project) => ({
        id: project.id,
        workspace_id: project.workspace_id,
        name: project.name,
        slug: project.slug,
        color: project.color,
        icon: project.icon ?? null,
        logo_url: project.logo_url ?? null,
        local_id: project.local_id ?? null,
        sort_order: project.sort_order ?? 0,
        local_path: project.local_path ?? null,
        metadata: project.metadata ?? {},
        created_at: project.created_at,
        updated_at: project.updated_at,
      }));
    },

    async requestLocalSync(deviceId: string): Promise<string> {
      const {
        data: { user },
      } = await client.auth.getUser();
      if (!user) {
        throw new Error('Usuário não autenticado');
      }
      const workspaceId = await resolveWorkspaceId();
      return requestLocalSync(client, {
        workspaceId,
        deviceId,
        userId: user.id,
      });
    },

    async listApprovals(): Promise<CommandApproval[]> {
      const workspaceId = await resolveWorkspaceId();
      const rows = await listPendingApprovals(client, workspaceId);
      return rows.map((row) => ({
        id: row.id,
        command_id: row.command_id,
        workspace_id: row.workspace_id,
        reason: row.reason,
        status: row.status as CommandApproval['status'],
        decided_by: row.decided_by,
        decided_at: row.decided_at,
        created_at: row.created_at,
      }));
    },

    async decideApproval(approvalId: string, status: 'approved' | 'denied'): Promise<void> {
      const {
        data: { user },
      } = await client.auth.getUser();
      if (!user) {
        throw new Error('Usuário não autenticado');
      }
      const approval = await decideApproval(client, approvalId, status, user.id);
      if (status === 'approved') {
        await client.from('commands').update({ status: 'pending' }).eq('id', approval.command_id);
      } else {
        await client
          .from('commands')
          .update({ status: 'cancelled', completed_at: new Date().toISOString() })
          .eq('id', approval.command_id);
      }
    },

    async getWorkspaceId(): Promise<string | null> {
      try {
        return await resolveWorkspaceId();
      } catch {
        return null;
      }
    },
  };
}
