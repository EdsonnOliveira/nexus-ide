import { notifyPush } from './notifyPush';
import { getServiceSupabaseClient } from './webPushSend';

const OFFLINE_AFTER_MS = 5 * 60_000;
const OFFLINE_NOTIFY_MAX_AGE_MS = 30 * 60_000;
const VERCEL_API_BASE = 'https://api.vercel.com';

type DeployState = 'READY' | 'ERROR' | string;

interface ActiveDeployment {
  uid: string;
  projectName: string;
  branch: string;
  state: DeployState;
  createdAt: number;
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
  const candidates = [state, readyState].map((value) => value?.trim().toUpperCase()).filter(Boolean);
  for (const item of ['ERROR', 'READY', 'BUILDING', 'QUEUED', 'CANCELED', 'BLOCKED', 'INITIALIZING']) {
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
      teamIds = (teamsJson.teams ?? [])
        .map((team) => team.id?.trim() ?? '')
        .filter(Boolean);
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
      return {
        uid,
        projectName: deployment.name?.trim() || 'Projeto',
        branch: deployment.meta?.githubCommitRef?.trim() || '—',
        state: normalizeState(deployment.state, deployment.readyState),
        createdAt: created < 1_000_000_000_000 ? created * 1000 : created,
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
        .select('active_deployment')
        .eq('user_id', userId)
        .maybeSingle();
      const previousActive = previous?.active_deployment as ActiveDeployment | null | undefined;
      const previousUid = previousActive?.uid ?? null;
      const previousState = previousActive?.state ?? null;
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
      if (
        hasPush &&
        deployment &&
        (deployment.state === 'READY' || deployment.state === 'ERROR') &&
        (deployment.uid !== previousUid || deployment.state !== previousState)
      ) {
        await notifyPush({
          userId,
          kind: 'deploy',
          title: deployment.state === 'READY' ? 'Deploy pronto' : 'Deploy com erro',
          body: `${deployment.projectName}${deployment.branch !== '—' ? ` · ${deployment.branch}` : ''}`,
          dedupeKey: `deploy:${deployment.uid}:${deployment.state}`,
          data: { uid: deployment.uid, state: deployment.state },
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
}
