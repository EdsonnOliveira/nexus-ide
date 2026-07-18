import { createServer } from 'node:net';
import { existsSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  claimCommand,
  claimDevicePairing,
  createNexusSupabaseClient,
  listOpenAgentSessionBundles,
  touchHeartbeat,
  type AgentSessionBundle,
} from '@nexus/supabase';
import { DEFAULT_CAPABILITIES } from '@nexus/protocol';
import { loadRuntimeEnv } from './env';
import {
  defaultDeviceName,
  detectCapabilities,
  loadOrCreateDeviceIdentity,
} from './deviceIdentity';
import { executeCommand } from './commandExecutor';
import { listActiveTerminalIds } from './terminalSessions';
import { createFileAuthStorage } from './sessionStorage';
import { runPushMaintenance } from './pushMaintenance';
import { syncMobileReleaseSnapshotFromDisk } from './syncMobileReleaseSnapshot';

const HEARTBEAT_MS = 15_000;
const POLL_MS = 2_000;
const PUSH_MAINTENANCE_MS = 60_000;

async function ensureAuth(
  client: ReturnType<typeof createNexusSupabaseClient>,
  email: string | null,
  password: string | null,
) {
  const {
    data: { session },
  } = await client.auth.getSession();
  if (session) {
    return session;
  }

  if (!email || !password) {
    throw new Error(
      'Runtime sem sessão. Defina NEXUS_RUNTIME_EMAIL e NEXUS_RUNTIME_PASSWORD no .env.local',
    );
  }

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    const signUp = await client.auth.signUp({ email, password });
    if (signUp.error) {
      throw signUp.error;
    }
    return signUp.data.session;
  }
  return data.session;
}

async function ensureWorkspace(client: ReturnType<typeof createNexusSupabaseClient>) {
  const { data, error } = await client
    .from('workspace_members')
    .select('workspace_id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data?.workspace_id) {
    throw new Error('Workspace não encontrado para o usuário');
  }
  return data.workspace_id;
}

async function ensureDevice(
  client: ReturnType<typeof createNexusSupabaseClient>,
  workspaceId: string,
  ownerId: string,
  deviceName: string | null,
  pairingCode: string | null,
) {
  const identity = loadOrCreateDeviceIdentity();
  const capabilities = detectCapabilities();
  const name = defaultDeviceName(deviceName);

  if (pairingCode) {
    const claimed = await claimDevicePairing(client, {
      code: pairingCode,
      deviceId: identity.deviceId,
      name,
      hostname: os.hostname(),
      architecture: os.arch(),
      capabilities,
    });
    console.log(`[nexus-runtime] paired as ${claimed.name} (${claimed.id})`);
  } else {
    const { data: existing } = await client
      .from('devices')
      .select('*')
      .eq('id', identity.deviceId)
      .maybeSingle();

    if (existing) {
      await client
        .from('devices')
        .update({
          name,
          hostname: os.hostname(),
          architecture: os.arch(),
          runtime_version: '1.0.0',
          capabilities,
          status: 'online',
          last_seen_at: new Date().toISOString(),
          is_enabled: true,
        })
        .eq('id', identity.deviceId);
    } else {
      await client.from('devices').insert({
        id: identity.deviceId,
        workspace_id: workspaceId,
        owner_id: ownerId,
        name,
        hostname: os.hostname(),
        platform: 'macos',
        architecture: os.arch(),
        runtime_version: '1.0.0',
        status: 'online',
        last_seen_at: new Date().toISOString(),
        is_enabled: true,
        is_default: true,
        capabilities,
      });
    }
  }

  await client.from('device_credentials').upsert({
    device_id: identity.deviceId,
    public_key: identity.publicKey,
    fingerprint: identity.fingerprint,
    last_rotated_at: new Date().toISOString(),
  });

  return identity.deviceId;
}

function startLocalSocket(
  socketPath: string,
  getStatus: () => Record<string, unknown>,
  listOpenSessions: () => Promise<AgentSessionBundle[]>,
): void {
  if (existsSync(socketPath)) {
    unlinkSync(socketPath);
  }

  const server = createServer((socket) => {
    socket.on('error', () => {});

    const writeSafe = (payload: unknown) => {
      if (socket.destroyed) {
        return;
      }

      try {
        socket.write(`${JSON.stringify(payload)}\n`);
      } catch {
      }
    };

    socket.on('data', (buffer) => {
      const text = buffer.toString('utf8').trim();
      if (text === 'ping' || text === '{"type":"ping"}') {
        writeSafe({ type: 'pong', ...getStatus() });
        return;
      }

      if (text === 'status' || text.includes('"type":"status"')) {
        writeSafe({ type: 'status', ...getStatus() });
        return;
      }

      if (text === 'open_agent_sessions' || text.includes('"type":"open_agent_sessions"')) {
        void listOpenSessions()
          .then((bundles) => {
            writeSafe({ type: 'open_agent_sessions', bundles });
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            writeSafe({ type: 'error', message });
          });
        return;
      }

      writeSafe({ type: 'error', message: 'unknown' });
    });
  });

  server.listen(socketPath);
  console.log(`[nexus-runtime] socket ${socketPath}`);
}

async function main(): Promise<void> {
  const env = loadRuntimeEnv();
  const client = createNexusSupabaseClient({
    url: env.url,
    anonKey: env.anonKey,
    storageKey: 'nexus-runtime-auth',
    storage: createFileAuthStorage(),
  });

  const session = await ensureAuth(client, env.email, env.password);
  if (!session?.user) {
    throw new Error('Falha ao autenticar runtime');
  }

  const workspaceId = await ensureWorkspace(client);
  const deviceId = await ensureDevice(
    client,
    workspaceId,
    session.user.id,
    env.deviceName,
    env.pairingCode,
  );

  const stateDir = path.join(os.homedir(), '.nexus', 'runtime');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    path.join(stateDir, 'state.json'),
    JSON.stringify({ deviceId, workspaceId, startedAt: new Date().toISOString() }, null, 2),
  );

  console.log(`[nexus-runtime] device=${deviceId} workspace=${workspaceId}`);

  startLocalSocket(
    env.socketPath,
    () => ({
      online: true,
      deviceId,
      workspaceId,
      hostname: os.hostname(),
      name: defaultDeviceName(env.deviceName),
      lastSeenAt: new Date().toISOString(),
      capabilities: { ...DEFAULT_CAPABILITIES, ...detectCapabilities() },
      activeAgents: 0,
      activeTerminals: listActiveTerminalIds().length,
    }),
    () => listOpenAgentSessionBundles(client, workspaceId),
  );

  const heartbeat = async () => {
    try {
      await touchHeartbeat(client, deviceId, {
        capabilities: detectCapabilities(),
        active_terminals: listActiveTerminalIds().length,
      });
    } catch (error) {
      console.error('[nexus-runtime] heartbeat failed', error);
    }
  };

  await heartbeat();
  setInterval(() => {
    void heartbeat();
  }, HEARTBEAT_MS);

  const poll = async () => {
    try {
      const claimed = await claimCommand(client, deviceId, 90);
      if (!claimed?.id) {
        return;
      }
      console.log(`[nexus-runtime] claimed ${claimed.id} type=${claimed.type}`);
      await executeCommand(client, claimed, deviceId);
      console.log(`[nexus-runtime] completed ${claimed.id}`);
    } catch (error) {
      console.error('[nexus-runtime] poll/execute failed', error);
    }
  };

  setInterval(() => {
    void poll();
  }, POLL_MS);

  void runPushMaintenance();
  setInterval(() => {
    void runPushMaintenance().catch((error) => {
      console.error('[nexus-runtime] push maintenance failed', error);
    });
  }, PUSH_MAINTENANCE_MS);

  const syncMobileSnapshot = async () => {
    try {
      await syncMobileReleaseSnapshotFromDisk(client, session.user.id, deviceId);
    } catch (error) {
      console.error('[nexus-runtime] mobile snapshot sync failed', error);
    }
  };

  void syncMobileSnapshot();
  setInterval(() => {
    void syncMobileSnapshot();
  }, 5_000);

  client
    .channel(`device-commands:${deviceId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'commands',
        filter: `target_device_id=eq.${deviceId}`,
      },
      () => {
        void poll();
      },
    )
    .subscribe();

  console.log('[nexus-runtime] ready');
}

main().catch((error) => {
  console.error('[nexus-runtime] fatal', error);
  process.exit(1);
});
