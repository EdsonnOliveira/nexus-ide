import https from 'node:https';

export type VercelDeploymentState =
  | 'READY'
  | 'ERROR'
  | 'BUILDING'
  | 'QUEUED'
  | 'INITIALIZING'
  | 'CANCELED'
  | 'BLOCKED';

export interface VercelActiveDeployment {
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

const VERCEL_API_BASE = 'https://api.vercel.com';
const REQUEST_TIMEOUT_MS = 20_000;

interface VercelApiError extends Error {
  statusCode?: number;
}

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

interface VercelProjectLinkRecord {
  type?: string;
  org?: string;
  repo?: string;
  repoId?: number;
  repoOwnerId?: number;
  gitCredentialId?: string;
  productionBranch?: string;
  sourceless?: boolean;
  createdAt?: number;
  updatedAt?: number;
  deployHooks?: unknown[];
}

interface VercelProjectRecord {
  id?: string;
  name?: string;
  framework?: string | null;
  avatar?: string | null;
  link?: VercelProjectLinkRecord | null;
}

const projectCache = new Map<string, VercelProjectRecord>();

function requestRaw(token: string, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, VERCEL_API_BASE);

    const request = https.request(
      url,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json, application/stream+json',
        },
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');

          if ((response.statusCode ?? 500) >= 400) {
            const error = new Error(`Vercel API error ${response.statusCode}`) as VercelApiError;
            error.statusCode = response.statusCode;
            reject(error);
            return;
          }

          resolve(raw);
        });
      },
    );

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error('Vercel API timeout'));
    });

    request.on('error', reject);
    request.end();
  });
}

function requestJson<T>(token: string, path: string): Promise<T> {
  return requestRaw(token, path).then((raw) => {
    if (!raw.trim()) {
      return {} as T;
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error('Invalid Vercel API response');
    }
  });
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
    // fall through to NDJSON parsing
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

function buildVercelAvatarHashUrl(hash: string, size = 64): string {
  return `https://vercel.com/api/www/avatar/${hash}?s=${size}&format=png`;
}

function buildVercelProjectAvatarUrl(projectId: string, size = 64): string {
  return `https://vercel.com/api/www/avatar?projectId=${encodeURIComponent(projectId)}&s=${size}&format=png`;
}

function resolveProjectAvatarUrl(
  project: VercelProjectRecord | null,
  fallbackProjectId?: string,
): string | null {
  const avatarHash = project?.avatar?.trim();
  if (avatarHash) {
    return buildVercelAvatarHashUrl(avatarHash);
  }

  const projectId = project?.id?.trim() || fallbackProjectId?.trim();
  if (projectId) {
    return buildVercelProjectAvatarUrl(projectId);
  }

  return null;
}

async function fetchProjectRecord(
  token: string,
  projectId: string,
  teamId?: string,
): Promise<VercelProjectRecord | null> {
  const paths = teamId
    ? [
        `/v9/projects/${encodeURIComponent(projectId)}?teamId=${encodeURIComponent(teamId)}`,
        `/v9/projects/${encodeURIComponent(projectId)}`,
      ]
    : [`/v9/projects/${encodeURIComponent(projectId)}`];

  for (const path of paths) {
    try {
      return await requestJson<VercelProjectRecord>(token, path);
    } catch {
      continue;
    }
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

  const project = await fetchProjectRecord(token, projectId, teamId);

  if (project) {
    projectCache.set(cacheKey, project);
  }

  return project;
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
  const commitSha = readCommitSha(deployment.meta);
  const framework = project?.framework ?? null;

  return {
    uid,
    projectId,
    projectName: project?.name?.trim() || deployment.name?.trim() || 'Projeto',
    branch: readBranch(deployment.meta),
    commitSha,
    commitMessage: readCommitMessage(deployment.meta),
    state,
    url: deployment.url ?? null,
    framework,
    createdAt: readTimestamp(deployment.createdAt ?? deployment.created) ?? Date.now(),
    buildingAt: readTimestamp(deployment.buildingAt),
    readyAt: readTimestamp(deployment.ready),
    commitUrl: buildCommitUrl(deployment.meta),
    projectAvatarUrl: resolveProjectAvatarUrl(project, projectId),
  };
}

export async function validateVercelToken(token: string): Promise<boolean> {
  const trimmed = token.trim();

  if (!trimmed) {
    return false;
  }

  try {
    await requestJson<{ user?: { id?: string } }>(trimmed, '/v2/user');
    return true;
  } catch {
    return false;
  }
}

export async function listRecentVercelDeployments(token: string): Promise<VercelActiveDeployment[]> {
  const trimmed = token.trim();

  if (!trimmed) {
    return [];
  }

  const response = await requestJson<{ deployments?: VercelDeploymentRecord[] }>(
    trimmed,
    '/v6/deployments?limit=20',
  );

  const deployments = response.deployments ?? [];
  const mapped = await Promise.all(deployments.map((deployment) => mapDeploymentRecord(trimmed, deployment)));

  return mapped
    .filter((deployment): deployment is VercelActiveDeployment => deployment !== null)
    .sort((left, right) => right.createdAt - left.createdAt);
}

export async function listActiveVercelDeployments(token: string): Promise<VercelActiveDeployment[]> {
  return listRecentVercelDeployments(token);
}

export function getPrimaryActiveVercelDeployment(
  deployments: VercelActiveDeployment[],
): VercelActiveDeployment | null {
  return deployments[0] ?? null;
}

export async function getVercelDeploymentLogs(token: string, deploymentUid: string): Promise<string> {
  const trimmedToken = token.trim();
  const uid = deploymentUid.trim();

  if (!trimmedToken || !uid) {
    return '';
  }

  const raw = await requestRaw(
    trimmedToken,
    `/v3/deployments/${encodeURIComponent(uid)}/events?limit=-1&direction=forward`,
  );

  return formatDeploymentEvents(raw);
}
