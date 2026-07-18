import { notifyPush } from './notifyPush';
import { getServiceSupabaseClient } from './webPushSend';

const OFFLINE_AFTER_MS = 45_000;
const VERCEL_API_BASE = 'https://api.vercel.com';

type DeployState = 'READY' | 'ERROR' | string;

interface ActiveDeployment {
  uid: string;
  projectName: string;
  branch: string;
  state: DeployState;
  createdAt: number;
}

function hourBucket(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  return `${year}${month}${day}${hour}`;
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
  const response = await fetch(`${VERCEL_API_BASE}/v6/deployments?limit=20`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Vercel API ${response.status}`);
  }
  const json = (await response.json()) as {
    deployments?: Array<{
      uid?: string;
      name?: string;
      state?: string;
      readyState?: string;
      created?: number;
      createdAt?: number;
      meta?: { githubCommitRef?: string };
    }>;
  };
  const deployments = (json.deployments ?? [])
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

async function checkDevicesOffline(): Promise<void> {
  const admin = getServiceSupabaseClient();
  if (!admin) {
    return;
  }
  const cutoff = new Date(Date.now() - OFFLINE_AFTER_MS).toISOString();
  const { data: devices } = await admin
    .from('devices')
    .select('id, name, owner_id, workspace_id, status, last_seen_at')
    .eq('status', 'online')
    .lt('last_seen_at', cutoff);

  const bucket = hourBucket();
  for (const device of devices ?? []) {
    const deviceId = String(device.id);
    const ownerId = String(device.owner_id);
    const name = String(device.name || 'Mac');
    const { error } = await admin
      .from('devices')
      .update({ status: 'offline', updated_at: new Date().toISOString() })
      .eq('id', deviceId)
      .eq('status', 'online');
    if (error) {
      continue;
    }

    const recipientIds = new Set<string>([ownerId]);
    const { data: members } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', device.workspace_id);
    for (const member of members ?? []) {
      recipientIds.add(String(member.user_id));
    }

    for (const userId of recipientIds) {
      await notifyPush({
        userId,
        kind: 'device',
        title: 'Mac offline',
        body: `${name} ficou offline`,
        dedupeKey: `device:${deviceId}:offline:${bucket}`,
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
    if (!count) {
      continue;
    }
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

export async function runPushMaintenance(): Promise<void> {
  await checkDevicesOffline();
  await pollVercelDeploys();
}
