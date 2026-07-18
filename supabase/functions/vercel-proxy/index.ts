import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const VERCEL_API_BASE = 'https://api.vercel.com';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-vercel-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function authorizeRequest(
  req: Request,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!url || !anon) {
    return { ok: false, status: 500, error: 'Missing Supabase env' };
  }

  const userClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error,
  } = await userClient.auth.getUser(accessToken);
  if (error || !user) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return { ok: true };
}

type VercelDeploymentState =
  | 'READY'
  | 'ERROR'
  | 'BUILDING'
  | 'QUEUED'
  | 'INITIALIZING'
  | 'CANCELED'
  | 'BLOCKED';

interface VercelDeploymentMeta {
  githubOrg?: string;
  githubRepo?: string;
  githubCommitOrg?: string;
  githubCommitRepo?: string;
  githubCommitRef?: string;
  githubCommitSha?: string;
  githubCommitMessage?: string;
  gitlabProjectPath?: string;
  gitlabCommitProjectPath?: string;
  gitlabCommitRef?: string;
  gitlabCommitSha?: string;
  gitlabCommitMessage?: string;
  bitbucketCommitWorkspace?: string;
  bitbucketCommitRepoSlug?: string;
  bitbucketRepo?: string;
  bitbucketCommitRef?: string;
  bitbucketCommitSha?: string;
  bitbucketCommitMessage?: string;
}

interface VercelDeploymentRecord {
  uid?: string;
  name?: string;
  url?: string | null;
  state?: string;
  readyState?: string;
  created?: number;
  createdAt?: number;
  buildingAt?: number;
  ready?: number;
  projectId?: string;
  teamId?: string;
  meta?: VercelDeploymentMeta;
}

interface VercelProjectRecord {
  id?: string;
  name?: string;
  framework?: string | null;
  avatar?: string | null;
}

interface VercelActiveDeployment {
  uid: string;
  projectId: string;
  projectName: string;
  branch: string;
  commitSha: string;
  commitMessage: string;
  state: VercelDeploymentState;
  url: string | null;
  framework: string | null;
  createdAt: number;
  buildingAt: number | null;
  readyAt: number | null;
  commitUrl: string | null;
  projectAvatarUrl: string | null;
}

const projectCache = new Map<string, VercelProjectRecord>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

async function vercelRequestRaw(token: string, path: string): Promise<string> {
  const response = await fetch(`${VERCEL_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json, application/stream+json',
    },
  });
  const raw = await response.text();
  if (!response.ok) {
    throw Object.assign(new Error(`Vercel API error ${response.status}`), {
      statusCode: response.status,
    });
  }
  return raw;
}

async function vercelRequestJson<T>(token: string, path: string): Promise<T> {
  const raw = await vercelRequestRaw(token, path);
  if (!raw.trim()) {
    return {} as T;
  }
  return JSON.parse(raw) as T;
}

function normalizeDeploymentState(
  state: string | undefined,
  readyState: string | undefined,
): VercelDeploymentState {
  const candidates = [state, readyState]
    .map((value) => value?.trim().toUpperCase())
    .filter(Boolean) as string[];
  const terminalStates: VercelDeploymentState[] = [
    'ERROR',
    'BLOCKED',
    'CANCELED',
    'READY',
    'BUILDING',
    'QUEUED',
    'INITIALIZING',
  ];
  for (const terminalState of terminalStates) {
    if (candidates.includes(terminalState)) {
      return terminalState;
    }
  }
  return 'QUEUED';
}

function readBranch(meta: VercelDeploymentMeta | undefined): string {
  return (
    meta?.githubCommitRef?.trim() ||
    meta?.gitlabCommitRef?.trim() ||
    meta?.bitbucketCommitRef?.trim() ||
    '—'
  );
}

function readCommitSha(meta: VercelDeploymentMeta | undefined): string {
  return (
    meta?.githubCommitSha?.trim() ||
    meta?.gitlabCommitSha?.trim() ||
    meta?.bitbucketCommitSha?.trim() ||
    ''
  );
}

function readCommitMessage(meta: VercelDeploymentMeta | undefined): string {
  return (
    meta?.githubCommitMessage?.trim() ||
    meta?.gitlabCommitMessage?.trim() ||
    meta?.bitbucketCommitMessage?.trim() ||
    ''
  );
}

function readTimestamp(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value.trim());
}

function buildCommitUrl(meta: VercelDeploymentMeta | undefined): string | null {
  if (!meta) {
    return null;
  }
  const githubSha = meta.githubCommitSha?.trim();
  if (githubSha) {
    const org = meta.githubCommitOrg?.trim() || meta.githubOrg?.trim();
    const repoValue = meta.githubCommitRepo?.trim() || meta.githubRepo?.trim();
    if (org && repoValue) {
      if (repoValue.includes('/')) {
        const [repoOrg, repoName] = repoValue.split('/');
        if (repoOrg && repoName) {
          return `https://github.com/${encodePathSegment(repoOrg)}/${encodePathSegment(repoName)}/commit/${encodePathSegment(githubSha)}`;
        }
      }
      return `https://github.com/${encodePathSegment(org)}/${encodePathSegment(repoValue)}/commit/${encodePathSegment(githubSha)}`;
    }
  }
  const gitlabSha = meta.gitlabCommitSha?.trim();
  if (gitlabSha) {
    const projectPath = meta.gitlabProjectPath?.trim() || meta.gitlabCommitProjectPath?.trim();
    if (projectPath) {
      const encodedPath = projectPath
        .split('/')
        .filter(Boolean)
        .map((segment) => encodeURIComponent(segment))
        .join('/');
      return `https://gitlab.com/${encodedPath}/-/commit/${encodeURIComponent(gitlabSha)}`;
    }
  }
  const bitbucketSha = meta.bitbucketCommitSha?.trim();
  if (bitbucketSha) {
    const workspace = meta.bitbucketCommitWorkspace?.trim();
    const repo = meta.bitbucketCommitRepoSlug?.trim() || meta.bitbucketRepo?.trim();
    if (workspace && repo) {
      return `https://bitbucket.org/${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(bitbucketSha)}`;
    }
  }
  return null;
}

function resolveProjectAvatarUrl(
  project: VercelProjectRecord | null,
  fallbackProjectId?: string,
): string | null {
  const avatarHash = project?.avatar?.trim();
  if (avatarHash) {
    return `https://vercel.com/api/www/avatar/${avatarHash}?s=64&format=png`;
  }
  const projectId = project?.id?.trim() || fallbackProjectId?.trim();
  if (projectId) {
    return `https://vercel.com/api/www/avatar?projectId=${encodeURIComponent(projectId)}&s=64&format=png`;
  }
  return null;
}

async function getProject(
  token: string,
  projectId: string,
  teamId?: string,
): Promise<VercelProjectRecord | null> {
  const cacheKey = `${teamId ?? ''}:${projectId}`;
  const cached = projectCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const paths = teamId
    ? [
        `/v9/projects/${encodeURIComponent(projectId)}?teamId=${encodeURIComponent(teamId)}`,
        `/v9/projects/${encodeURIComponent(projectId)}`,
      ]
    : [`/v9/projects/${encodeURIComponent(projectId)}`];
  for (const path of paths) {
    try {
      const project = await vercelRequestJson<VercelProjectRecord>(token, path);
      projectCache.set(cacheKey, project);
      return project;
    } catch {
      continue;
    }
  }
  return null;
}

async function mapDeploymentRecord(
  token: string,
  deployment: VercelDeploymentRecord,
): Promise<VercelActiveDeployment | null> {
  const uid = deployment.uid?.trim();
  if (!uid) {
    return null;
  }
  const state = normalizeDeploymentState(deployment.state, deployment.readyState);
  const projectId = deployment.projectId?.trim() ?? '';
  const teamId = deployment.teamId?.trim();
  const project = projectId ? await getProject(token, projectId, teamId) : null;
  return {
    uid,
    projectId,
    projectName: project?.name?.trim() || deployment.name?.trim() || 'Projeto',
    branch: readBranch(deployment.meta),
    commitSha: readCommitSha(deployment.meta),
    commitMessage: readCommitMessage(deployment.meta),
    state,
    url: deployment.url ?? null,
    framework: project?.framework ?? null,
    createdAt: readTimestamp(deployment.createdAt ?? deployment.created) ?? Date.now(),
    buildingAt: readTimestamp(deployment.buildingAt),
    readyAt: readTimestamp(deployment.ready),
    commitUrl: buildCommitUrl(deployment.meta),
    projectAvatarUrl: resolveProjectAvatarUrl(project, projectId),
  };
}

async function listDeployments(token: string): Promise<VercelActiveDeployment[]> {
  const response = await vercelRequestJson<{ deployments?: VercelDeploymentRecord[] }>(
    token,
    '/v6/deployments?limit=20',
  );
  const deployments = response.deployments ?? [];
  const mapped = await Promise.all(
    deployments.map((deployment) => mapDeploymentRecord(token, deployment)),
  );
  return mapped
    .filter((deployment): deployment is VercelActiveDeployment => deployment !== null)
    .sort((left, right) => right.createdAt - left.createdAt);
}

function readDeploymentEventText(event: unknown): string {
  if (typeof event === 'string') {
    return event;
  }
  if (!event || typeof event !== 'object') {
    return '';
  }
  const record = event as Record<string, unknown>;
  if (typeof record.text === 'string') {
    return record.text;
  }
  const payload = record.payload;
  if (payload && typeof payload === 'object') {
    const payloadRecord = payload as Record<string, unknown>;
    if (typeof payloadRecord.text === 'string') {
      return payloadRecord.text;
    }
  }
  return '';
}

function formatDeploymentEvents(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((event) => readDeploymentEventText(event)).join('');
    }
  } catch {
  }
  const lines: string[] = [];
  for (const line of trimmed.split('\n')) {
    const lineTrimmed = line.trim();
    if (!lineTrimmed) {
      continue;
    }
    try {
      const event = JSON.parse(lineTrimmed) as unknown;
      const text = readDeploymentEventText(event);
      if (text) {
        lines.push(text);
      }
    } catch {
      lines.push(line);
    }
  }
  return lines.join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const auth = await authorizeRequest(req);
  if (!auth.ok) {
    return jsonResponse({ error: auth.error }, auth.status);
  }

  let body: { action?: string; token?: string; deploymentUid?: string };
  try {
    body = (await req.json()) as { action?: string; token?: string; deploymentUid?: string };
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const token = (body.token ?? req.headers.get('x-vercel-token') ?? '').trim();
  if (!token) {
    return jsonResponse({ error: 'Missing Vercel token' }, 400);
  }

  const action = body.action?.trim() || 'active';

  try {
    if (action === 'validate') {
      await vercelRequestJson(token, '/v2/user');
      return jsonResponse({ ok: true });
    }

    if (action === 'list') {
      const deployments = await listDeployments(token);
      return jsonResponse({ deployments });
    }

    if (action === 'active') {
      const deployments = await listDeployments(token);
      return jsonResponse({ deployment: deployments[0] ?? null, deployments });
    }

    if (action === 'logs') {
      const uid = body.deploymentUid?.trim() ?? '';
      if (!uid) {
        return jsonResponse({ error: 'Missing deploymentUid' }, 400);
      }
      const raw = await vercelRequestRaw(
        token,
        `/v3/deployments/${encodeURIComponent(uid)}/events?limit=-1&direction=forward`,
      );
      return jsonResponse({ logs: formatDeploymentEvents(raw) });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (error) {
    const statusCode =
      error && typeof error === 'object' && 'statusCode' in error
        ? Number((error as { statusCode?: number }).statusCode)
        : 500;
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Vercel proxy failed' },
      statusCode >= 400 && statusCode < 600 ? statusCode : 500,
    );
  }
});
