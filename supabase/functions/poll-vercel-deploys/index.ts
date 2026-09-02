import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { CORS_HEADERS, jsonResponse } from '../_shared/cors.ts';
import {
  collectDeployStates,
  deployPushCopy,
  isVercelTerminalState,
  readSnapshotUpdatedAt,
  shouldNotifyDeploy,
  type DeploySnapshotLike,
} from '../_shared/deployPush.ts';
import { createServiceClient, invokeSendPush } from '../_shared/supabaseAdmin.ts';

const VERCEL_API_BASE = 'https://api.vercel.com';

type VercelDeploymentState =
  'READY' | 'ERROR' | 'BUILDING' | 'QUEUED' | 'INITIALIZING' | 'CANCELED' | 'BLOCKED';

interface VercelDeploymentRecord {
  uid?: string;
  name?: string;
  url?: string | null;
  state?: string;
  readyState?: string;
  created?: number;
  createdAt?: number;
  ready?: number;
  projectId?: string;
  meta?: {
    githubCommitRef?: string;
    githubCommitMessage?: string;
  };
}

interface ActiveDeployment {
  uid: string;
  projectName: string;
  branch: string;
  commitMessage: string;
  state: VercelDeploymentState;
  url: string | null;
  createdAt: number;
  readyAt: number | null;
}

function normalizeState(
  state: string | undefined,
  readyState: string | undefined,
): VercelDeploymentState {
  const candidates = [state, readyState]
    .map((value) => value?.trim().toUpperCase())
    .filter(Boolean) as string[];
  const known: VercelDeploymentState[] = [
    'ERROR',
    'BLOCKED',
    'CANCELED',
    'READY',
    'BUILDING',
    'QUEUED',
    'INITIALIZING',
  ];
  for (const item of known) {
    if (candidates.includes(item)) {
      return item;
    }
  }
  return 'QUEUED';
}

function readTimestamp(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

async function listActive(token: string): Promise<{
  deployment: ActiveDeployment | null;
  deployments: ActiveDeployment[];
}> {
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
  const records = new Map<string, VercelDeploymentRecord>();
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
      const json = (await response.json()) as { deployments?: VercelDeploymentRecord[] };
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
      const created = readTimestamp(deployment.createdAt ?? deployment.created) ?? Date.now();
      return {
        uid,
        projectName: deployment.name?.trim() || 'Projeto',
        branch: deployment.meta?.githubCommitRef?.trim() || '—',
        commitMessage: deployment.meta?.githubCommitMessage?.trim() || '',
        state: normalizeState(deployment.state, deployment.readyState),
        url: deployment.url ?? null,
        createdAt: created,
        readyAt: readTimestamp(deployment.ready),
      } satisfies ActiveDeployment;
    })
    .filter((item): item is ActiveDeployment => item !== null)
    .sort((left, right) => right.createdAt - left.createdAt);

  return { deployment: deployments[0] ?? null, deployments };
}

function authorizeCron(req: Request): boolean {
  const secret = Deno.env.get('NOTIFY_SECRET') ?? '';
  const headerSecret = req.headers.get('x-nexus-notify-secret') ?? '';
  if (secret && headerSecret === secret) {
    return true;
  }
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return Boolean(serviceRole && token === serviceRole);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
  if (!authorizeCron(req)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const admin = createServiceClient();
  const { data: tokens, error } = await admin.from('user_vercel_tokens').select('user_id, token');
  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  let notified = 0;
  let scanned = 0;

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

    scanned += 1;
    try {
      const { data: previous } = await admin
        .from('vercel_deploy_snapshots')
        .select('active_deployment, deployments, updated_at')
        .eq('user_id', userId)
        .maybeSingle();

      const previousSnapshot = (previous as DeploySnapshotLike | null) ?? null;
      const previousStates = collectDeployStates(previousSnapshot);
      const previousUpdatedAt = readSnapshotUpdatedAt(previousSnapshot);
      const hadSnapshot = previousSnapshot != null;

      const { deployment, deployments } = await listActive(token);
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
          !shouldNotifyDeploy({
            hadSnapshot,
            previousState: previousStates.get(item.uid),
            isTerminal: isVercelTerminalState(item.state),
            createdAt: item.createdAt,
            readyAt: item.readyAt,
            previousUpdatedAt,
            currentState: item.state,
          })
        ) {
          continue;
        }
        const copy = deployPushCopy({
          provider: 'vercel',
          state: item.state,
          projectName: item.projectName,
          branch: item.branch,
        });
        await invokeSendPush({
          userId,
          kind: 'deploy',
          title: copy.title,
          body: copy.body,
          dedupeKey: `deploy:${item.uid}:${item.state}`,
          data: {
            kind: 'deploy',
            provider: 'vercel',
            uid: item.uid,
            state: item.state,
          },
        });
        notified += 1;
      }
    } catch {
      continue;
    }
  }

  return jsonResponse({ ok: true, scanned, notified });
});
