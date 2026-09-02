import { notifyPush } from './notifyPush';
import { getServiceSupabaseClient } from './webPushSend';

const OFFLINE_AFTER_MS = 5 * 60_000;
const OFFLINE_NOTIFY_MAX_AGE_MS = 30 * 60_000;
const VERCEL_API_BASE = 'https://api.vercel.com';
const RENDER_API_BASE = 'https://api.render.com';
const RENDER_SERVICES_LIMIT = 20;
const RENDER_DEPLOYS_PER_SERVICE = 5;
const RENDER_MAX_LISTED = 20;

type DeployState = 'READY' | 'ERROR' | string;

interface ActiveDeployment {
  uid: string;
  projectName: string;
  branch: string;
  state: DeployState;
  createdAt: number;
  readyAt: number | null;
}

type RenderState =
  | 'created'
  | 'queued'
  | 'build_in_progress'
  | 'update_in_progress'
  | 'pre_deploy_in_progress'
  | 'live'
  | 'deactivated'
  | 'build_failed'
  | 'update_failed'
  | 'pre_deploy_failed'
  | 'canceled'
  | string;

interface RenderActiveDeployment {
  uid: string;
  credentialId: string;
  projectName: string;
  branch: string;
  state: RenderState;
  createdAt: number;
  readyAt: number | null;
}

interface DeploySnapshotLike {
  active_deployment?: unknown;
  deployments?: unknown;
  updated_at?: unknown;
}

function presenceDedupeKey(deviceId: string, state: 'online' | 'offline'): string {
  return `device:${deviceId}:${state}`;
}

function lastSeenAgeMs(lastSeenAt: string | null | undefined): number | null {
  if (!lastSeenAt) {
    return null;
  }
  const lastSeenMs = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(lastSeenMs)) {
    return null;
  }
  return Date.now() - lastSeenMs;
}

function shouldNotifyMacOnline(lastSeenAt: string | null | undefined): boolean {
  const ageMs = lastSeenAgeMs(lastSeenAt);
  return ageMs == null || ageMs >= OFFLINE_AFTER_MS;
}

function shouldNotifyMacOffline(lastSeenAt: string | null | undefined): boolean {
  const ageMs = lastSeenAgeMs(lastSeenAt);
  if (ageMs == null) {
    return false;
  }
  return ageMs >= OFFLINE_AFTER_MS && ageMs <= OFFLINE_NOTIFY_MAX_AGE_MS;
}

function normalizeState(state?: string, readyState?: string): DeployState {
  const candidates = [state, readyState]
    .map((value) => value?.trim().toUpperCase())
    .filter(Boolean);
  for (const item of [
    'ERROR',
    'READY',
    'BUILDING',
    'QUEUED',
    'CANCELED',
    'BLOCKED',
    'INITIALIZING',
  ]) {
    if (candidates.includes(item)) {
      return item;
    }
  }
  return 'QUEUED';
}

async function listActiveDeployments(token: string): Promise<{
  deployment: ActiveDeployment | null;
  deployments: ActiveDeployment[];
}> {
  type DeploymentRecord = {
    uid?: string;
    name?: string;
    state?: string;
    readyState?: string;
    created?: number;
    createdAt?: number;
    ready?: number;
    meta?: { githubCommitRef?: string };
  };

  let teamIds: string[] = [];
  try {
    const teamsResponse = await fetch(`${VERCEL_API_BASE}/v2/teams?limit=100`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
    if (teamsResponse.ok) {
      const teamsJson = (await teamsResponse.json()) as { teams?: Array<{ id?: string }> };
      teamIds = (teamsJson.teams ?? []).map((team) => team.id?.trim() ?? '').filter(Boolean);
    }
  } catch {
    teamIds = [];
  }

  const paths = [
    '/v6/deployments?limit=20',
    ...teamIds.map((teamId) => `/v6/deployments?limit=20&teamId=${encodeURIComponent(teamId)}`),
  ];
  const records = new Map<string, DeploymentRecord>();
  for (const path of paths) {
    try {
      const response = await fetch(`${VERCEL_API_BASE}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
      if (!response.ok) {
        continue;
      }
      const json = (await response.json()) as { deployments?: DeploymentRecord[] };
      for (const deployment of json.deployments ?? []) {
        const uid = deployment.uid?.trim();
        if (uid) {
          records.set(uid, deployment);
        }
      }
    } catch {
      continue;
    }
  }

  const deployments = [...records.values()]
    .map((deployment) => {
      const uid = deployment.uid?.trim();
      if (!uid) {
        return null;
      }
      const created = deployment.createdAt ?? deployment.created ?? Date.now();
      const ready = deployment.ready;
      return {
        uid,
        projectName: deployment.name?.trim() || 'Projeto',
        branch: deployment.meta?.githubCommitRef?.trim() || '—',
        state: normalizeState(deployment.state, deployment.readyState),
        createdAt: created < 1_000_000_000_000 ? created * 1000 : created,
        readyAt:
          typeof ready === 'number' && Number.isFinite(ready) && ready > 0
            ? ready < 1_000_000_000_000
              ? ready * 1000
              : ready
            : null,
      } satisfies ActiveDeployment;
    })
    .filter((item): item is ActiveDeployment => item !== null)
    .sort((left, right) => right.createdAt - left.createdAt);
  return { deployment: deployments[0] ?? null, deployments };
}

async function resolveDevicePushRecipients(
  ownerId: string,
  workspaceId: string,
): Promise<string[]> {
  const admin = getServiceSupabaseClient();
  const recipientIds = new Set<string>([ownerId]);
  if (!admin) {
    return [...recipientIds];
  }
  const { data: members } = await admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId);
  for (const member of members ?? []) {
    recipientIds.add(String(member.user_id));
  }
  return [...recipientIds];
}

export async function notifyMacOnline(device: {
  id: string;
  name?: string | null;
  owner_id: string;
  workspace_id: string;
  last_seen_at?: string | null;
}): Promise<void> {
  if (!shouldNotifyMacOnline(device.last_seen_at)) {
    return;
  }
  const deviceId = String(device.id);
  const ownerId = String(device.owner_id);
  const name = String(device.name || 'Mac');
  const recipientIds = await resolveDevicePushRecipients(ownerId, String(device.workspace_id));
  for (const userId of recipientIds) {
    await notifyPush({
      userId,
      kind: 'device',
      title: 'Mac online',
      body: `${name} ficou online`,
      dedupeKey: presenceDedupeKey(deviceId, 'online'),
      clearDedupeKeys: [presenceDedupeKey(deviceId, 'offline')],
      data: { deviceId, name },
    });
  }
}

async function checkDevicesOffline(skipDeviceId?: string): Promise<void> {
  const admin = getServiceSupabaseClient();
  if (!admin) {
    return;
  }
  const cutoff = new Date(Date.now() - OFFLINE_AFTER_MS).toISOString();
  let query = admin
    .from('devices')
    .select('id, name, owner_id, workspace_id, status, last_seen_at')
    .eq('status', 'online')
    .lt('last_seen_at', cutoff);
  if (skipDeviceId) {
    query = query.neq('id', skipDeviceId);
  }
  const { data: devices } = await query;

  for (const device of devices ?? []) {
    const deviceId = String(device.id);
    const ownerId = String(device.owner_id);
    const name = String(device.name || 'Mac');
    const { data: updated, error } = await admin
      .from('devices')
      .update({ status: 'offline', updated_at: new Date().toISOString() })
      .eq('id', deviceId)
      .eq('status', 'online')
      .select('id');
    if (error || !updated?.length) {
      continue;
    }

    if (!shouldNotifyMacOffline(device.last_seen_at)) {
      continue;
    }

    const recipientIds = await resolveDevicePushRecipients(ownerId, String(device.workspace_id));
    for (const userId of recipientIds) {
      await notifyPush({
        userId,
        kind: 'device',
        title: 'Mac offline',
        body: `${name} ficou offline`,
        dedupeKey: presenceDedupeKey(deviceId, 'offline'),
        clearDedupeKeys: [presenceDedupeKey(deviceId, 'online')],
        data: { deviceId, name },
      });
    }
  }
}

function readSnapshotTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function collectSnapshotStates(snapshot: DeploySnapshotLike | null): Map<string, string> {
  const map = new Map<string, string>();
  const items: unknown[] = [];
  if (Array.isArray(snapshot?.deployments)) {
    items.push(...snapshot.deployments);
  }
  if (snapshot?.active_deployment) {
    items.push(snapshot.active_deployment);
  }
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const record = item as { uid?: unknown; credentialId?: unknown; state?: unknown };
    const uid = typeof record.uid === 'string' ? record.uid.trim() : '';
    const state = typeof record.state === 'string' ? record.state.trim() : '';
    if (!uid || !state) {
      continue;
    }
    const credentialId = typeof record.credentialId === 'string' ? record.credentialId.trim() : '';
    const key = credentialId ? `${credentialId}:${uid}` : uid;
    if (!map.has(key)) {
      map.set(key, state);
    }
  }
  return map;
}

function shouldNotifyFinishedDeploy(input: {
  hadSnapshot: boolean;
  previousState: string | undefined;
  isTerminal: boolean;
  currentState: string;
  createdAt: number;
  readyAt: number | null;
  previousUpdatedAt: number | null;
}): boolean {
  if (!input.hadSnapshot || !input.isTerminal) {
    return false;
  }
  if (input.previousState) {
    return input.previousState !== input.currentState;
  }
  const finishedAt = input.readyAt && input.readyAt > 0 ? input.readyAt : input.createdAt;
  if (input.previousUpdatedAt == null) {
    return false;
  }
  return finishedAt >= input.previousUpdatedAt - 60_000;
}

function isVercelTerminal(state: string): boolean {
  const normalized = state.trim().toUpperCase();
  return normalized === 'READY' || normalized === 'ERROR' || normalized === 'BLOCKED';
}

function isRenderTerminal(state: string): boolean {
  const normalized = state.trim().toLowerCase();
  return (
    normalized === 'live' ||
    normalized === 'build_failed' ||
    normalized === 'update_failed' ||
    normalized === 'pre_deploy_failed'
  );
}

function isRenderInProgress(state: string): boolean {
  return (
    state === 'created' ||
    state === 'queued' ||
    state === 'build_in_progress' ||
    state === 'update_in_progress' ||
    state === 'pre_deploy_in_progress'
  );
}

function deployTitle(provider: 'vercel' | 'render', state: string): string {
  const platform = provider === 'vercel' ? 'Vercel' : 'Render';
  const failed =
    provider === 'vercel' ? state.toUpperCase() !== 'READY' : state.toLowerCase() !== 'live';
  return failed ? `Deploy ${platform} com erro` : `Deploy ${platform} pronto`;
}

function deployBody(projectName: string, branch: string): string {
  return `${projectName}${branch !== '—' ? ` · ${branch}` : ''}`;
}

async function pollVercelDeploys(): Promise<void> {
  const admin = getServiceSupabaseClient();
  if (!admin) {
    return;
  }
  const { data: tokens } = await admin.from('user_vercel_tokens').select('user_id, token');
  for (const row of tokens ?? []) {
    const userId = String((row as { user_id: string }).user_id);
    const token = String((row as { token: string }).token ?? '').trim();
    if (!userId || !token) {
      continue;
    }
    const { count } = await admin
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    const hasPush = Boolean(count);

    try {
      const { data: previous } = await admin
        .from('vercel_deploy_snapshots')
        .select('active_deployment, deployments, updated_at')
        .eq('user_id', userId)
        .maybeSingle();
      const previousSnapshot = (previous as DeploySnapshotLike | null) ?? null;
      const previousStates = collectSnapshotStates(previousSnapshot);
      const previousUpdatedAt = readSnapshotTimestamp(previousSnapshot?.updated_at);
      const hadSnapshot = previousSnapshot != null;
      const { deployment, deployments } = await listActiveDeployments(token);
      await admin.from('vercel_deploy_snapshots').upsert(
        {
          user_id: userId,
          active_deployment: deployment,
          deployments,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
      if (!hasPush) {
        continue;
      }
      for (const item of deployments) {
        if (
          !shouldNotifyFinishedDeploy({
            hadSnapshot,
            previousState: previousStates.get(item.uid),
            isTerminal: isVercelTerminal(item.state),
            currentState: item.state,
            createdAt: item.createdAt,
            readyAt: item.readyAt,
            previousUpdatedAt,
          })
        ) {
          continue;
        }
        await notifyPush({
          userId,
          kind: 'deploy',
          title: deployTitle('vercel', item.state),
          body: deployBody(item.projectName, item.branch),
          dedupeKey: `deploy:${item.uid}:${item.state}`,
          data: { kind: 'deploy', provider: 'vercel', uid: item.uid, state: item.state },
        });
      }
    } catch {
      continue;
    }
  }
}

async function listRenderDeploymentsForToken(
  credentialId: string,
  token: string,
): Promise<RenderActiveDeployment[]> {
  type ServiceRecord = {
    id?: string;
    name?: string;
    branch?: string;
  };
  type DeployRecord = {
    id?: string;
    status?: string;
    createdAt?: string;
    finishedAt?: string;
  };

  const servicesResponse = await fetch(
    `${RENDER_API_BASE}/v1/services?limit=${RENDER_SERVICES_LIMIT}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    },
  );
  if (!servicesResponse.ok) {
    const error = new Error(`Render API error ${servicesResponse.status}`) as Error & {
      statusCode?: number;
    };
    error.statusCode = servicesResponse.status;
    throw error;
  }
  const servicesJson = (await servicesResponse.json()) as Array<{ service?: ServiceRecord }>;
  const services = (Array.isArray(servicesJson) ? servicesJson : [])
    .map((item) => item.service)
    .filter((service): service is ServiceRecord => Boolean(service?.id));

  const grouped = await Promise.all(
    services.map(async (service) => {
      const serviceId = service.id?.trim();
      if (!serviceId) {
        return [] as RenderActiveDeployment[];
      }
      try {
        const deploysResponse = await fetch(
          `${RENDER_API_BASE}/v1/services/${encodeURIComponent(serviceId)}/deploys?limit=${RENDER_DEPLOYS_PER_SERVICE}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/json',
            },
          },
        );
        if (!deploysResponse.ok) {
          return [] as RenderActiveDeployment[];
        }
        const deploysJson = (await deploysResponse.json()) as Array<{ deploy?: DeployRecord }>;
        return (Array.isArray(deploysJson) ? deploysJson : [])
          .map((entry) => entry.deploy)
          .filter((deploy): deploy is DeployRecord => Boolean(deploy?.id))
          .map((deploy) => {
            const uid = deploy.id?.trim() ?? '';
            const createdAt = readSnapshotTimestamp(deploy.createdAt) ?? Date.now();
            return {
              uid,
              credentialId,
              projectName: service.name?.trim() || 'Serviço',
              branch: service.branch?.trim() || '—',
              state: (deploy.status?.trim().toLowerCase() || 'queued') as RenderState,
              createdAt,
              readyAt: readSnapshotTimestamp(deploy.finishedAt),
            } satisfies RenderActiveDeployment;
          })
          .filter((item) => Boolean(item.uid));
      } catch {
        return [] as RenderActiveDeployment[];
      }
    }),
  );

  const unique = new Map<string, RenderActiveDeployment>();
  for (const deployment of grouped.flat()) {
    unique.set(`${deployment.credentialId}:${deployment.uid}`, deployment);
  }
  return [...unique.values()]
    .sort((left, right) => {
      const leftActive = isRenderInProgress(left.state) ? 1 : 0;
      const rightActive = isRenderInProgress(right.state) ? 1 : 0;
      if (leftActive !== rightActive) {
        return rightActive - leftActive;
      }
      return right.createdAt - left.createdAt;
    })
    .slice(0, RENDER_MAX_LISTED);
}

async function pollRenderDeploys(): Promise<void> {
  const admin = getServiceSupabaseClient();
  if (!admin) {
    return;
  }
  const { data: tokens } = await admin
    .from('user_render_tokens')
    .select('user_id, credential_id, label, token');
  const byUser = new Map<string, Array<{ credentialId: string; token: string }>>();
  for (const row of tokens ?? []) {
    const userId = String((row as { user_id: string }).user_id);
    const credentialId = String((row as { credential_id: string }).credential_id ?? '').trim();
    const token = String((row as { token: string }).token ?? '').trim();
    if (!userId || !credentialId || !token) {
      continue;
    }
    const list = byUser.get(userId) ?? [];
    list.push({ credentialId, token });
    byUser.set(userId, list);
  }

  for (const [userId, credentials] of byUser) {
    const { count } = await admin
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    const hasPush = Boolean(count);

    try {
      const { data: previous } = await admin
        .from('render_deploy_snapshots')
        .select('active_deployment, deployments, updated_at')
        .eq('user_id', userId)
        .maybeSingle();
      const previousSnapshot = (previous as DeploySnapshotLike | null) ?? null;
      const previousStates = collectSnapshotStates(previousSnapshot);
      const previousUpdatedAt = readSnapshotTimestamp(previousSnapshot?.updated_at);
      const hadSnapshot = previousSnapshot != null;

      const grouped = await Promise.all(
        credentials.map(async (credential) => {
          try {
            return await listRenderDeploymentsForToken(credential.credentialId, credential.token);
          } catch {
            return [] as RenderActiveDeployment[];
          }
        }),
      );
      const unique = new Map<string, RenderActiveDeployment>();
      for (const deployment of grouped.flat()) {
        unique.set(`${deployment.credentialId}:${deployment.uid}`, deployment);
      }
      const deployments = [...unique.values()].sort((left, right) => {
        const leftActive = isRenderInProgress(left.state) ? 1 : 0;
        const rightActive = isRenderInProgress(right.state) ? 1 : 0;
        if (leftActive !== rightActive) {
          return rightActive - leftActive;
        }
        return right.createdAt - left.createdAt;
      });
      const deployment = deployments[0] ?? null;

      await admin.from('render_deploy_snapshots').upsert(
        {
          user_id: userId,
          active_deployment: deployment,
          deployments,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

      if (!hasPush) {
        continue;
      }

      for (const item of deployments) {
        const key = `${item.credentialId}:${item.uid}`;
        if (
          !shouldNotifyFinishedDeploy({
            hadSnapshot,
            previousState: previousStates.get(key) ?? previousStates.get(item.uid),
            isTerminal: isRenderTerminal(item.state),
            currentState: item.state,
            createdAt: item.createdAt,
            readyAt: item.readyAt,
            previousUpdatedAt,
          })
        ) {
          continue;
        }
        await notifyPush({
          userId,
          kind: 'deploy',
          title: deployTitle('render', item.state),
          body: deployBody(item.projectName, item.branch),
          dedupeKey: `deploy:render:${item.credentialId}:${item.uid}:${item.state}`,
          data: { kind: 'deploy', provider: 'render', uid: item.uid, state: item.state },
        });
      }
    } catch {
      continue;
    }
  }
}

export async function runPushMaintenance(skipDeviceId?: string): Promise<void> {
  await checkDevicesOffline(skipDeviceId);
  await pollVercelDeploys();
  await pollRenderDeploys();
}
