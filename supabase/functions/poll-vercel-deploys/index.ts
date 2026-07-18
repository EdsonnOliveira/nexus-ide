import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { CORS_HEADERS, jsonResponse } from '../_shared/cors.ts';
import { createServiceClient, invokeSendPush } from '../_shared/supabaseAdmin.ts';

const VERCEL_API_BASE = 'https://api.vercel.com';

type VercelDeploymentState =
  | 'READY'
  | 'ERROR'
  | 'BUILDING'
  | 'QUEUED'
  | 'INITIALIZING'
  | 'CANCELED'
  | 'BLOCKED';

interface VercelDeploymentRecord {
  uid?: string;
  name?: string;
  url?: string | null;
  state?: string;
  readyState?: string;
  created?: number;
  createdAt?: number;
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

async function listActive(token: string): Promise<{
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
  const json = (await response.json()) as { deployments?: VercelDeploymentRecord[] };
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
        commitMessage: deployment.meta?.githubCommitMessage?.trim() || '',
        state: normalizeState(deployment.state, deployment.readyState),
        url: deployment.url ?? null,
        createdAt: created < 1_000_000_000_000 ? created * 1000 : created,
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
  const { data: tokens, error } = await admin
    .from('user_vercel_tokens')
    .select('user_id, token');
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
        .select('active_deployment')
        .eq('user_id', userId)
        .maybeSingle();

      const previousActive = previous?.active_deployment as ActiveDeployment | null | undefined;
      const previousUid = previousActive?.uid ?? null;
      const previousState = previousActive?.state ?? null;

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

      if (
        hasPush &&
        deployment &&
        (deployment.state === 'READY' || deployment.state === 'ERROR') &&
        (deployment.uid !== previousUid || deployment.state !== previousState)
      ) {
        const title =
          deployment.state === 'READY' ? 'Deploy pronto' : 'Deploy com erro';
        const body = `${deployment.projectName}${deployment.branch !== '—' ? ` · ${deployment.branch}` : ''}`;
        await invokeSendPush({
          userId,
          kind: 'deploy',
          title,
          body,
          dedupeKey: `deploy:${deployment.uid}:${deployment.state}`,
          data: { uid: deployment.uid, state: deployment.state },
        });
        notified += 1;
      }
    } catch {
      continue;
    }
  }

  return jsonResponse({ ok: true, scanned, notified });
});
