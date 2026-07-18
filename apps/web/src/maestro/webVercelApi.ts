import { supabase } from '../lib/supabase';
import {
  isVercelActiveDeployment,
  parseVercelDeployments,
  type VercelActiveDeployment,
} from './vercelTypes';

const TOKEN_STORAGE_KEY = 'nexus-web-vercel-token';

type VercelDeploymentMeta = {
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
};

type VercelDeploymentRecord = {
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
};

type VercelProjectRecord = {
  id?: string;
  name?: string;
  framework?: string | null;
  avatar?: string | null;
};

const projectCache = new Map<string, VercelProjectRecord>();

export function readWebVercelToken(): string | null {
  try {
    const value = localStorage.getItem(TOKEN_STORAGE_KEY)?.trim() ?? '';
    return value || null;
  } catch {
    return null;
  }
}

export function writeWebVercelToken(token: string | null): void {
  try {
    if (!token?.trim()) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      return;
    }
    localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
  } catch {
    return;
  }
}

async function invokeEdgeProxy(action: string, token: string, deploymentUid?: string) {
  const { data, error } = await supabase.functions.invoke('vercel-proxy', {
    body: { action, token, deploymentUid },
  });
  if (error) {
    throw error;
  }
  return data as {
    ok?: boolean;
    deployment?: VercelActiveDeployment | null;
    deployments?: VercelActiveDeployment[];
    logs?: string;
    error?: string;
  };
}

async function proxyRequestRaw(token: string, path: string): Promise<string> {
  const response = await fetch(`/vercel-api${path}`, {
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

async function proxyRequestJson<T>(token: string, path: string): Promise<T> {
  const raw = await proxyRequestRaw(token, path);
  if (!raw.trim()) {
    return {} as T;
  }
  return JSON.parse(raw) as T;
}

function normalizeDeploymentState(
  state: string | undefined,
  readyState: string | undefined,
): VercelActiveDeployment['state'] {
  const candidates = [state, readyState]
    .map((value) => value?.trim().toUpperCase())
    .filter(Boolean) as string[];
  const terminalStates: VercelActiveDeployment['state'][] = [
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
      const project = await proxyRequestJson<VercelProjectRecord>(token, path);
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
    state: normalizeDeploymentState(deployment.state, deployment.readyState),
    url: deployment.url ?? null,
    framework: project?.framework ?? null,
    createdAt: readTimestamp(deployment.createdAt ?? deployment.created) ?? Date.now(),
    buildingAt: readTimestamp(deployment.buildingAt),
    readyAt: readTimestamp(deployment.ready),
    commitUrl: buildCommitUrl(deployment.meta),
    projectAvatarUrl: resolveProjectAvatarUrl(project, projectId),
  };
}

async function listViaProxy(token: string): Promise<VercelActiveDeployment[]> {
  const response = await proxyRequestJson<{ deployments?: VercelDeploymentRecord[] }>(
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

export async function validateWebVercelToken(token: string): Promise<boolean> {
  const trimmed = token.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const edge = await invokeEdgeProxy('validate', trimmed);
    if (edge?.ok) {
      return true;
    }
  } catch {
  }
  try {
    await proxyRequestJson(trimmed, '/v2/user');
    return true;
  } catch {
    return false;
  }
}

export async function fetchWebVercelActive(
  token: string,
): Promise<{ deployment: VercelActiveDeployment | null; deployments: VercelActiveDeployment[] }> {
  const trimmed = token.trim();
  try {
    const edge = await invokeEdgeProxy('active', trimmed);
    if (edge?.error) {
      throw new Error(edge.error);
    }
    const deployments = parseVercelDeployments(edge?.deployments);
    const deployment = isVercelActiveDeployment(edge?.deployment)
      ? edge.deployment
      : (deployments[0] ?? null);
    return { deployment, deployments };
  } catch {
  }
  const deployments = await listViaProxy(trimmed);
  return { deployment: deployments[0] ?? null, deployments };
}

export async function fetchWebVercelDeployments(token: string): Promise<VercelActiveDeployment[]> {
  const trimmed = token.trim();
  try {
    const edge = await invokeEdgeProxy('list', trimmed);
    if (edge?.error) {
      throw new Error(edge.error);
    }
    return parseVercelDeployments(edge?.deployments);
  } catch {
  }
  return listViaProxy(trimmed);
}

export async function fetchWebVercelDeploymentLogs(
  token: string,
  deploymentUid: string,
): Promise<string> {
  const trimmed = token.trim();
  const uid = deploymentUid.trim();
  if (!trimmed || !uid) {
    return '';
  }
  try {
    const edge = await invokeEdgeProxy('logs', trimmed, uid);
    if (typeof edge?.logs === 'string') {
      return edge.logs;
    }
  } catch {
  }
  const raw = await proxyRequestRaw(
    trimmed,
    `/v3/deployments/${encodeURIComponent(uid)}/events?limit=-1&direction=forward`,
  );
  return raw;
}
