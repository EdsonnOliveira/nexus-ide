import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { CORS_HEADERS, jsonResponse } from '../_shared/cors.ts';
import {
  collectDeployStates,
  deployPushCopy,
  isRenderTerminalState,
  readSnapshotUpdatedAt,
  shouldNotifyDeploy,
  type DeploySnapshotLike,
} from '../_shared/deployPush.ts';
import { createServiceClient, invokeSendPush } from '../_shared/supabaseAdmin.ts';

const RENDER_API_BASE = 'https://api.render.com';
const SERVICES_LIMIT = 20;
const DEPLOYS_PER_SERVICE = 5;
const MAX_LISTED_DEPLOYS = 20;

type RenderDeploymentState =
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
  | 'canceled';

interface RenderServiceRecord {
  id?: string;
  name?: string;
  ownerId?: string;
  branch?: string;
  dashboardUrl?: string;
  serviceDetails?: { url?: string | null } | null;
}

interface RenderDeployRecord {
  id?: string;
  status?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt?: string;
  commit?: { id?: string; message?: string } | null;
}

interface ActiveDeployment {
  uid: string;
  credentialId: string;
  projectId: string;
  projectName: string;
  accountLabel: string;
  branch: string;
  state: RenderDeploymentState;
  url: string | null;
  dashboardUrl: string | null;
  createdAt: number;
  readyAt: number | null;
}

function normalizeState(status: string | undefined): RenderDeploymentState {
  const normalized = status?.trim().toLowerCase() ?? '';
  const known: RenderDeploymentState[] = [
    'created',
    'queued',
    'build_in_progress',
    'update_in_progress',
    'pre_deploy_in_progress',
    'live',
    'deactivated',
    'build_failed',
    'update_failed',
    'pre_deploy_failed',
    'canceled',
  ];
  if (known.includes(normalized as RenderDeploymentState)) {
    return normalized as RenderDeploymentState;
  }
  return 'queued';
}

function isInProgressState(state: RenderDeploymentState): boolean {
  return (
    state === 'created' ||
    state === 'queued' ||
    state === 'build_in_progress' ||
    state === 'update_in_progress' ||
    state === 'pre_deploy_in_progress'
  );
}

function readIsoTimestamp(value: string | undefined | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

async function requestJson<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`${RENDER_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    const error = new Error(`Render API error ${response.status}`) as Error & {
      statusCode?: number;
    };
    error.statusCode = response.status;
    throw error;
  }
  const raw = await response.text();
  if (!raw.trim()) {
    return {} as T;
  }
  return JSON.parse(raw) as T;
}

async function listServices(token: string): Promise<RenderServiceRecord[]> {
  const response = await requestJson<Array<{ service?: RenderServiceRecord }>>(
    token,
    `/v1/services?limit=${SERVICES_LIMIT}`,
  );
  return (Array.isArray(response) ? response : [])
    .map((item) => item.service)
    .filter((service): service is RenderServiceRecord => Boolean(service?.id));
}

async function listServiceDeploys(token: string, serviceId: string): Promise<RenderDeployRecord[]> {
  const response = await requestJson<Array<{ deploy?: RenderDeployRecord }>>(
    token,
    `/v1/services/${encodeURIComponent(serviceId)}/deploys?limit=${DEPLOYS_PER_SERVICE}`,
  );
  return (Array.isArray(response) ? response : [])
    .map((item) => item.deploy)
    .filter((deploy): deploy is RenderDeployRecord => Boolean(deploy?.id));
}

async function listDeploymentsForToken(
  credentialId: string,
  accountLabel: string,
  token: string,
): Promise<ActiveDeployment[]> {
  const services = await listServices(token);
  const grouped = await Promise.all(
    services.map(async (service) => {
      const serviceId = service.id?.trim();
      if (!serviceId) {
        return [] as ActiveDeployment[];
      }
      try {
        const deploys = await listServiceDeploys(token, serviceId);
        return deploys
          .map((deploy) => {
            const uid = deploy.id?.trim();
            if (!uid) {
              return null;
            }
            const createdAt = readIsoTimestamp(deploy.createdAt) ?? Date.now();
            return {
              uid,
              credentialId,
              projectId: serviceId,
              projectName: service.name?.trim() || 'Serviço',
              accountLabel,
              branch: service.branch?.trim() || '—',
              state: normalizeState(deploy.status),
              url: service.serviceDetails?.url?.trim() || null,
              dashboardUrl: service.dashboardUrl?.trim() || null,
              createdAt,
              readyAt: readIsoTimestamp(deploy.finishedAt),
            } satisfies ActiveDeployment;
          })
          .filter((item): item is ActiveDeployment => item !== null);
      } catch (error) {
        const statusCode =
          error && typeof error === 'object' && 'statusCode' in error
            ? Number((error as { statusCode?: number }).statusCode)
            : undefined;
        if (statusCode === 401) {
          throw error;
        }
        return [];
      }
    }),
  );

  const unique = new Map<string, ActiveDeployment>();
  for (const deployment of grouped.flat()) {
    const key = `${deployment.credentialId}:${deployment.uid}`;
    if (!unique.has(key)) {
      unique.set(key, deployment);
    }
  }

  return [...unique.values()]
    .sort((left, right) => {
      const leftActive = isInProgressState(left.state) ? 1 : 0;
      const rightActive = isInProgressState(right.state) ? 1 : 0;
      if (leftActive !== rightActive) {
        return rightActive - leftActive;
      }
      return right.createdAt - left.createdAt;
    })
    .slice(0, MAX_LISTED_DEPLOYS);
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
    .from('user_render_tokens')
    .select('user_id, credential_id, label, token');
  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  const byUser = new Map<string, Array<{ credentialId: string; label: string; token: string }>>();
  for (const row of tokens ?? []) {
    const userId = String((row as { user_id: string }).user_id);
    const credentialId = String((row as { credential_id: string }).credential_id ?? '').trim();
    const token = String((row as { token: string }).token ?? '').trim();
    const label = String((row as { label: string }).label ?? '').trim() || 'Conta Render';
    if (!userId || !credentialId || !token) {
      continue;
    }
    const list = byUser.get(userId) ?? [];
    list.push({ credentialId, label, token });
    byUser.set(userId, list);
  }

  let notified = 0;
  let scanned = 0;

  for (const [userId, credentials] of byUser) {
    const { count } = await admin
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    const hasPush = Boolean(count);

    scanned += 1;
    try {
      const { data: previous } = await admin
        .from('render_deploy_snapshots')
        .select('active_deployment, deployments, updated_at')
        .eq('user_id', userId)
        .maybeSingle();

      const previousSnapshot = (previous as DeploySnapshotLike | null) ?? null;
      const previousStates = collectDeployStates(previousSnapshot);
      const previousUpdatedAt = readSnapshotUpdatedAt(previousSnapshot);
      const hadSnapshot = previousSnapshot != null;

      const grouped = await Promise.all(
        credentials.map(async (credential) => {
          try {
            return await listDeploymentsForToken(
              credential.credentialId,
              credential.label,
              credential.token,
            );
          } catch {
            return [] as ActiveDeployment[];
          }
        }),
      );
      const unique = new Map<string, ActiveDeployment>();
      for (const deployment of grouped.flat()) {
        unique.set(`${deployment.credentialId}:${deployment.uid}`, deployment);
      }
      const deployments = [...unique.values()].sort((left, right) => {
        const leftActive = isInProgressState(left.state) ? 1 : 0;
        const rightActive = isInProgressState(right.state) ? 1 : 0;
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
          !shouldNotifyDeploy({
            hadSnapshot,
            previousState: previousStates.get(key) ?? previousStates.get(item.uid),
            isTerminal: isRenderTerminalState(item.state),
            createdAt: item.createdAt,
            readyAt: item.readyAt,
            previousUpdatedAt,
            currentState: item.state,
          })
        ) {
          continue;
        }
        const copy = deployPushCopy({
          provider: 'render',
          state: item.state,
          projectName: item.projectName,
          branch: item.branch,
        });
        await invokeSendPush({
          userId,
          kind: 'deploy',
          title: copy.title,
          body: copy.body,
          dedupeKey: `deploy:render:${item.credentialId}:${item.uid}:${item.state}`,
          data: {
            kind: 'deploy',
            provider: 'render',
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
