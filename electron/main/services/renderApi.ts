import https from 'node:https';

export type RenderDeploymentState =
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

export interface RenderActiveDeployment {
  uid: string;
  credentialId: string;
  ownerId: string;
  projectId: string;
  projectName: string;
  accountLabel: string;
  branch: string;
  commitSha: string;
  commitMessage: string;
  state: RenderDeploymentState;
  url: string | null;
  dashboardUrl: string | null;
  createdAt: number;
  buildingAt: number | null;
  readyAt: number | null;
  commitUrl: string | null;
}

export interface RenderDeploymentLogsQuery {
  credentialId: string;
  ownerId: string;
  serviceId: string;
  createdAt: number;
  readyAt: number | null;
}

interface RenderApiError extends Error {
  statusCode?: number;
}

interface RenderOwnerRecord {
  id?: string;
  name?: string;
  email?: string;
}

interface RenderServiceDetailsRecord {
  url?: string | null;
}

interface RenderServiceRecord {
  id?: string;
  name?: string;
  ownerId?: string;
  type?: string;
  branch?: string;
  repo?: string;
  dashboardUrl?: string;
  serviceDetails?: RenderServiceDetailsRecord | null;
}

interface RenderDeployCommitRecord {
  id?: string;
  message?: string;
  createdAt?: string;
}

interface RenderDeployImageRecord {
  ref?: string;
  sha?: string;
}

interface RenderDeployRecord {
  id?: string;
  commit?: RenderDeployCommitRecord | null;
  image?: RenderDeployImageRecord | null;
  status?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface RenderLogRecord {
  message?: string;
}

const RENDER_API_BASE = 'https://api.render.com';
const REQUEST_TIMEOUT_MS = 20_000;
const SERVICES_LIMIT = 20;
const DEPLOYS_PER_SERVICE = 5;
const MAX_LISTED_DEPLOYS = 20;
const SERVICE_CACHE_TTL_MS = 60_000;

const serviceCache = new Map<string, { expiresAt: number; services: RenderServiceRecord[] }>();

function requestRaw(token: string, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, RENDER_API_BASE);

    const request = https.request(
      url,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
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
            const error = new Error(`Render API error ${response.statusCode}`) as RenderApiError;
            error.statusCode = response.statusCode;
            reject(error);
            return;
          }

          resolve(raw);
        });
      },
    );

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error('Render API timeout'));
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
      throw new Error('Invalid Render API response');
    }
  });
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

function normalizeDeploymentState(status: string | undefined): RenderDeploymentState {
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

function toHttpsGitHostUrl(repo: string): string | null {
  const cleaned = repo.replace(/\.git$/i, '');
  const sshMatch = cleaned.match(/^git@([^:]+):(.+)$/i);

  if (sshMatch) {
    const host = sshMatch[1]?.trim();
    const path = sshMatch[2]?.trim();

    if (!host || !path) {
      return null;
    }

    return `https://${host}/${path}`;
  }

  if (cleaned.startsWith('https://') || cleaned.startsWith('http://')) {
    return cleaned;
  }

  return null;
}

function buildCommitUrl(repo: string | undefined, sha: string): string | null {
  const trimmedRepo = repo?.trim();
  const trimmedSha = sha.trim();

  if (!trimmedRepo || !trimmedSha) {
    return null;
  }

  const httpsRepo = toHttpsGitHostUrl(trimmedRepo);

  if (!httpsRepo) {
    return null;
  }

  if (httpsRepo.includes('github.com')) {
    return `${httpsRepo}/commit/${encodeURIComponent(trimmedSha)}`;
  }

  if (httpsRepo.includes('gitlab.com')) {
    return `${httpsRepo}/-/commit/${encodeURIComponent(trimmedSha)}`;
  }

  if (httpsRepo.includes('bitbucket.org')) {
    return `${httpsRepo}/commits/${encodeURIComponent(trimmedSha)}`;
  }

  return null;
}

function readServiceUrl(service: RenderServiceRecord): string | null {
  const url = service.serviceDetails?.url?.trim();
  return url || null;
}

function mapDeployRecord(
  credentialId: string,
  accountLabel: string,
  service: RenderServiceRecord,
  deploy: RenderDeployRecord,
): RenderActiveDeployment | null {
  const uid = deploy.id?.trim();
  const projectId = service.id?.trim();

  if (!uid || !projectId) {
    return null;
  }

  const commitSha = deploy.commit?.id?.trim() || deploy.image?.sha?.trim() || '';
  const commitMessage =
    deploy.commit?.message?.trim() || deploy.image?.ref?.trim() || '';
  const createdAt = readIsoTimestamp(deploy.createdAt) ?? Date.now();
  const buildingAt = readIsoTimestamp(deploy.startedAt) ?? createdAt;
  const readyAt = readIsoTimestamp(deploy.finishedAt);

  return {
    uid,
    credentialId,
    ownerId: service.ownerId?.trim() ?? '',
    projectId,
    projectName: service.name?.trim() || 'Serviço',
    accountLabel,
    branch: service.branch?.trim() || '—',
    commitSha,
    commitMessage,
    state: normalizeDeploymentState(deploy.status),
    url: readServiceUrl(service),
    dashboardUrl: service.dashboardUrl?.trim() || null,
    createdAt,
    buildingAt,
    readyAt,
    commitUrl: buildCommitUrl(service.repo, commitSha),
  };
}

async function listOwners(token: string): Promise<RenderOwnerRecord[]> {
  const response = await requestJson<Array<{ owner?: RenderOwnerRecord }>>(token, '/v1/owners?limit=20');

  if (!Array.isArray(response)) {
    return [];
  }

  return response
    .map((item) => item.owner)
    .filter((owner): owner is RenderOwnerRecord => Boolean(owner?.id));
}

export async function resolveRenderAccountLabel(token: string): Promise<string> {
  try {
    const owners = await listOwners(token);
    const names = owners
      .map((owner) => owner.name?.trim() || owner.email?.trim() || '')
      .filter(Boolean);

    if (names.length === 0) {
      return 'Conta Render';
    }

    if (names.length === 1) {
      return names[0] ?? 'Conta Render';
    }

    return `${names[0] ?? 'Conta Render'} +${names.length - 1}`;
  } catch {
    return 'Conta Render';
  }
}

export async function validateRenderToken(token: string): Promise<boolean> {
  const trimmed = token.trim();

  if (!trimmed) {
    return false;
  }

  try {
    await listOwners(trimmed);
    return true;
  } catch {
    return false;
  }
}

async function listServices(token: string, credentialId: string): Promise<RenderServiceRecord[]> {
  const cached = serviceCache.get(credentialId);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.services;
  }

  const response = await requestJson<Array<{ service?: RenderServiceRecord }>>(
    token,
    `/v1/services?limit=${SERVICES_LIMIT}`,
  );
  const services = (Array.isArray(response) ? response : [])
    .map((item) => item.service)
    .filter((service): service is RenderServiceRecord => Boolean(service?.id));

  serviceCache.set(credentialId, {
    expiresAt: Date.now() + SERVICE_CACHE_TTL_MS,
    services,
  });

  return services;
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

export async function listRenderDeploymentsForToken(
  credentialId: string,
  accountLabel: string,
  token: string,
): Promise<RenderActiveDeployment[]> {
  const trimmed = token.trim();

  if (!trimmed) {
    return [];
  }

  const services = await listServices(trimmed, credentialId);
  const grouped = await Promise.all(
    services.map(async (service) => {
      const serviceId = service.id?.trim();

      if (!serviceId) {
        return [] as RenderActiveDeployment[];
      }

      try {
        const deploys = await listServiceDeploys(trimmed, serviceId);
        return deploys
          .map((deploy) => mapDeployRecord(credentialId, accountLabel, service, deploy))
          .filter((item): item is RenderActiveDeployment => item !== null);
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

  return grouped.flat();
}

export function mergeRenderDeployments(
  deployments: RenderActiveDeployment[],
): RenderActiveDeployment[] {
  const unique = new Map<string, RenderActiveDeployment>();

  for (const deployment of deployments) {
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

export function getPrimaryActiveRenderDeployment(
  deployments: RenderActiveDeployment[],
): RenderActiveDeployment | null {
  return deployments[0] ?? null;
}

function toIso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export async function getRenderDeploymentLogs(
  token: string,
  query: RenderDeploymentLogsQuery,
): Promise<string> {
  const trimmedToken = token.trim();
  const ownerId = query.ownerId.trim();
  const serviceId = query.serviceId.trim();

  if (!trimmedToken || !ownerId || !serviceId) {
    return '';
  }

  const startMs = Math.max(0, query.createdAt - 5 * 60_000);
  const endMs = (query.readyAt ?? Date.now()) + 5 * 60_000;
  const params = new URLSearchParams({
    ownerId,
    resource: serviceId,
    type: 'build',
    limit: '100',
    direction: 'forward',
    startTime: toIso(startMs),
    endTime: toIso(endMs),
  });

  try {
    const response = await requestJson<{ logs?: RenderLogRecord[] }>(
      trimmedToken,
      `/v1/logs?${params.toString()}`,
    );
    const lines = (response.logs ?? [])
      .map((entry) => entry.message?.trim() ?? '')
      .filter(Boolean);

    if (lines.length > 0) {
      return lines.join('\n');
    }
  } catch {
    return '';
  }

  return '';
}
