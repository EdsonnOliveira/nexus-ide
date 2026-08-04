import { createServer } from 'node:net';
import { existsSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  claimCommand,
  claimDevicePairing,
  createNexusSupabaseClient,
  getPrimaryWorkspace,
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
import { notifyMacOnline, runPushMaintenance } from './pushMaintenance';
import { syncMobileReleaseSnapshotFromDisk } from './syncMobileReleaseSnapshot';
import { publishDesktopAgentPanes } from './publishDesktopAgentPanes';

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
  const identity = loadOrCreateDeviceIdentity();
  const { data: existingDevice } = await client
    .from('devices')
    .select('workspace_id')
    .eq('id', identity.deviceId)
    .maybeSingle();

  if (existingDevice?.workspace_id) {
    return existingDevice.workspace_id as string;
  }

  const preferred = await getPrimaryWorkspace(client);
  if (preferred?.workspace_id) {
    return preferred.workspace_id;
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
    const { data: beforePair } = await client
      .from('devices')
      .select('id, name, owner_id, workspace_id, status')
      .eq('id', identity.deviceId)
      .maybeSingle();
    const claimed = await claimDevicePairing(client, {
      code: pairingCode,
      deviceId: identity.deviceId,
      name,
      hostname: os.hostname(),
      architecture: os.arch(),
      capabilities,
    });
    console.log(`[nexus-runtime] paired as ${claimed.name} (${claimed.id})`);
    if (beforePair?.status === 'offline') {
      void notifyMacOnline({
        id: claimed.id,
        name: claimed.name,
        owner_id: claimed.owner_id,
        workspace_id: claimed.workspace_id,
      });
    }
  } else {
    const { data: existing } = await client
      .from('devices')
      .select('*')
      .eq('id', identity.deviceId)
      .maybeSingle();

    if (existing) {
      const wasOffline = existing.status === 'offline';
      const { error: updateError } = await client
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
      if (!updateError && wasOffline) {
        void notifyMacOnline({
          id: existing.id,
          name,
          owner_id: existing.owner_id,
          workspace_id: existing.workspace_id,
        });
      }
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
  publishBeforeList: () => Promise<unknown>,
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
        void (async () => {
          try {
            void publishBeforeList().catch((error) => {
              console.error('[nexus-runtime] publish before list failed', error);
            });
            const bundles = await listOpenSessions();
            writeSafe({
              type: 'open_agent_sessions',
              bundles: bundles.filter((bundle) => bundle.session.source !== 'desktop_pane'),
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            writeSafe({ type: 'error', message });
          }
        })();
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
    () => listOpenAgentSessionBundles(client, null, null, deviceId),
    () => publishDesktopAgentPanes(client, deviceId, session.user.id),
  );

  const heartbeat = async () => {
    try {
      const { data: beforeHeartbeat } = await client
        .from('devices')
        .select('id, name, owner_id, workspace_id, status')
        .eq('id', deviceId)
        .maybeSingle();
      await touchHeartbeat(client, deviceId, {
        capabilities: detectCapabilities(),
        active_terminals: listActiveTerminalIds().length,
      });
      if (beforeHeartbeat?.status === 'offline') {
        void notifyMacOnline({
          id: beforeHeartbeat.id,
          name: beforeHeartbeat.name,
          owner_id: beforeHeartbeat.owner_id,
          workspace_id: beforeHeartbeat.workspace_id,
        });
      }
    } catch (error) {
      console.error('[nexus-runtime] heartbeat failed', error);
    }
  };

  let heartbeatInFlight = false;
  const runHeartbeat = async () => {
    if (heartbeatInFlight) {
      return;
    }
    heartbeatInFlight = true;
    try {
      await heartbeat();
    } finally {
      heartbeatInFlight = false;
    }
  };

  const runPublishPanes = () => {
    void publishDesktopAgentPanes(client, deviceId, session.user.id).catch((error) => {
      console.error('[nexus-runtime] publish panes failed', error);
    });
  };

  void runHeartbeat();
  setInterval(() => {
    void runHeartbeat();
  }, HEARTBEAT_MS);

  setTimeout(() => {
    runPublishPanes();
    setInterval(runPublishPanes, 60_000);
  }, 45_000);

  const FAST_INPUT_TYPES = new Set([
    'emulator_tap',
    'emulator_swipe',
    'emulator_press_home',
    'emulator_press_back',
    'emulator_press_app_switcher',
    'emulator_rotate',
    'emulator_type',
  ]);

  let pollInFlight = 0;
  const MAX_POLL_IN_FLIGHT = 3;

  const poll = async () => {
    if (pollInFlight >= MAX_POLL_IN_FLIGHT) {
      return;
    }
    pollInFlight += 1;
    let released = false;
    let deferRelease = false;
    const release = () => {
      if (released) {
        return;
      }
      released = true;
      pollInFlight -= 1;
    };
    try {
      const claimed = await claimCommand(client, deviceId, 90);
      if (!claimed?.id) {
        return;
      }
      console.log(`[nexus-runtime] claimed ${claimed.id} type=${claimed.type}`);
      const run = executeCommand(client, claimed, deviceId).then(() => {
        console.log(`[nexus-runtime] completed ${claimed.id}`);
      });
      if (FAST_INPUT_TYPES.has(String(claimed.type))) {
        deferRelease = true;
        void run
          .catch((error) => {
            console.error('[nexus-runtime] fast command failed', error);
          })
          .finally(release);
        return;
      }
      try {
        await run;
      } catch (error) {
        console.error('[nexus-runtime] command failed', claimed.id, error);
      }
    } catch (error) {
      console.error('[nexus-runtime] poll/execute failed', error);
    } finally {
      if (!deferRelease) {
        release();
      }
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

process.on('SIGTERM', () => {
  console.log('[nexus-runtime] shutting down');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[nexus-runtime] shutting down');
  process.exit(0);
});

main().catch((error) => {
  console.error('[nexus-runtime] fatal', error);
  process.exit(1);
});
