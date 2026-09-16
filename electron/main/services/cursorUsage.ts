import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import https from 'node:https';
import { DatabaseSync } from 'node:sqlite';

export interface CursorPeriodUsageSnapshot {
  available: boolean;
  percent: number;
  autoPercentUsed: number;
  apiPercentUsed: number;
  totalPercentUsed: number;
  displayMessage: string | null;
  autoModelSelectedDisplayMessage: string | null;
  namedModelSelectedDisplayMessage: string | null;
  billingCycleStartMs: number | null;
  billingCycleEndMs: number | null;
  membershipType: string | null;
  updatedAt: number;
  error: string | null;
}

interface CursorPeriodUsageApiResponse {
  billingCycleStart?: string;
  billingCycleEnd?: string;
  planUsage?: {
    autoPercentUsed?: number;
    apiPercentUsed?: number;
    totalPercentUsed?: number;
    includedSpend?: number;
    limit?: number;
  };
  displayMessage?: string;
  autoModelSelectedDisplayMessage?: string;
  namedModelSelectedDisplayMessage?: string;
}

interface CursorPlanInfoResponse {
  planInfo?: {
    planName?: string;
  };
}

interface CursorStripeApiResponse {
  individualMembershipType?: string;
  membershipType?: string;
}

const CURSOR_CONNECT_USAGE_URL =
  'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage';
const CURSOR_CONNECT_PLAN_URL = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetPlanInfo';
const CURSOR_DASHBOARD_USAGE_URL = 'https://cursor.com/api/dashboard/get-current-period-usage';
const CURSOR_STRIPE_URL = 'https://cursor.com/api/auth/stripe';

const REQUEST_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedSnapshot: CursorPeriodUsageSnapshot | null = null;
let cacheExpiresAt = 0;

function resolveCursorStateDbPath(): string | null {
  const home = homedir();
  let dbPath: string;

  if (platform() === 'darwin') {
    dbPath = join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  } else if (platform() === 'win32') {
    dbPath = join(
      process.env.APPDATA ?? join(home, 'AppData', 'Roaming'),
      'Cursor',
      'User',
      'globalStorage',
      'state.vscdb',
    );
  } else {
    dbPath = join(home, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }

  return existsSync(dbPath) ? dbPath : null;
}

function readStateValue(dbPath: string, key: string): string | null {
  let db: DatabaseSync | null = null;

  try {
    db = new DatabaseSync(dbPath, { readonly: true });
    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key) as
      | { value?: string }
      | undefined;

    return typeof row?.value === 'string' ? row.value : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function decodeJwtSub(accessToken: string): string | null {
  const parts = accessToken.split('.');

  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as { sub?: unknown };

    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

function buildSessionToken(accessToken: string): string | null {
  const sub = decodeJwtSub(accessToken);

  if (!sub) {
    return null;
  }

  return `${sub}::${accessToken}`;
}

function readCursorAccessToken(): string | null {
  const dbPath = resolveCursorStateDbPath();

  if (!dbPath) {
    return null;
  }

  const accessToken = readStateValue(dbPath, 'cursorAuth/accessToken');

  return accessToken && accessToken.length > 0 ? accessToken : null;
}

function readCachedMembershipType(): string | null {
  const dbPath = resolveCursorStateDbPath();

  if (!dbPath) {
    return null;
  }

  const raw = readStateValue(dbPath, 'cursorAuth/stripeMembershipType');

  if (!raw) {
    return null;
  }

  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function requestJson<T>(
  url: string,
  options: {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const method = options.method ?? 'GET';
    const request = https.request(
      url,
      {
        method,
        headers: {
          Accept: 'application/json',
          ...options.headers,
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');

          if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) {
            reject(new Error(`cursor_usage_http_${response.statusCode ?? 0}`));
            return;
          }

          try {
            resolve(JSON.parse(body) as T);
          } catch {
            reject(new Error('cursor_usage_invalid_json'));
          }
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error('cursor_usage_timeout'));
    });

    request.on('error', reject);

    if (options.body) {
      request.end(options.body);
      return;
    }

    request.end();
  });
}

async function fetchCursorUsagePayload(
  accessToken: string,
  sessionToken: string | null,
): Promise<CursorPeriodUsageApiResponse> {
  try {
    return await requestJson<CursorPeriodUsageApiResponse>(CURSOR_CONNECT_USAGE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
      },
      body: '{}',
    });
  } catch {
  }

  if (!sessionToken) {
    throw new Error('cursor_usage_failed');
  }

  try {
    return await requestJson<CursorPeriodUsageApiResponse>(CURSOR_DASHBOARD_USAGE_URL, {
      method: 'POST',
      headers: {
        Cookie: `WorkosCursorSessionToken=${sessionToken}`,
        'Content-Type': 'application/json',
        Origin: 'https://cursor.com',
      },
      body: '{}',
    });
  } catch {
  }

  return requestJson<CursorPeriodUsageApiResponse>(CURSOR_DASHBOARD_USAGE_URL, {
    headers: {
      Cookie: `WorkosCursorSessionToken=${sessionToken}`,
    },
  });
}

async function fetchCursorMembershipType(
  accessToken: string,
  sessionToken: string | null,
): Promise<string | null> {
  try {
    const planPayload = await requestJson<CursorPlanInfoResponse>(CURSOR_CONNECT_PLAN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
      },
      body: '{}',
    });
    const planName = planPayload.planInfo?.planName?.trim();

    if (planName) {
      return planName;
    }
  } catch {
  }

  if (sessionToken) {
    try {
      const stripePayload = await requestJson<CursorStripeApiResponse>(CURSOR_STRIPE_URL, {
        headers: {
          Cookie: `WorkosCursorSessionToken=${sessionToken}`,
        },
      });

      return parseMembershipLabel(stripePayload);
    } catch {
    }
  }

  return readCachedMembershipType();
}

function buildUnavailableSnapshot(error: string): CursorPeriodUsageSnapshot {
  return {
    available: false,
    percent: 0,
    autoPercentUsed: 0,
    apiPercentUsed: 0,
    totalPercentUsed: 0,
    displayMessage: null,
    autoModelSelectedDisplayMessage: null,
    namedModelSelectedDisplayMessage: null,
    billingCycleStartMs: null,
    billingCycleEndMs: null,
    membershipType: null,
    updatedAt: Date.now(),
    error,
  };
}

function parseMembershipLabel(payload: CursorStripeApiResponse): string | null {
  const raw = payload.individualMembershipType ?? payload.membershipType;

  if (!raw) {
    return null;
  }

  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function parseUsageSnapshot(
  usagePayload: CursorPeriodUsageApiResponse,
  membershipType: string | null,
): CursorPeriodUsageSnapshot {
  const autoPercentUsed = usagePayload.planUsage?.autoPercentUsed ?? 0;
  const apiPercentUsed = usagePayload.planUsage?.apiPercentUsed ?? 0;
  const totalPercentUsed = usagePayload.planUsage?.totalPercentUsed ?? 0;
  const billingCycleStartMs = Number.parseInt(usagePayload.billingCycleStart ?? '', 10);
  const billingCycleEndMs = Number.parseInt(usagePayload.billingCycleEnd ?? '', 10);

  return {
    available: true,
    percent: Math.max(0, Math.min(100, Math.max(autoPercentUsed, apiPercentUsed, totalPercentUsed))),
    autoPercentUsed,
    apiPercentUsed,
    totalPercentUsed,
    displayMessage: usagePayload.displayMessage ?? null,
    autoModelSelectedDisplayMessage: usagePayload.autoModelSelectedDisplayMessage ?? null,
    namedModelSelectedDisplayMessage: usagePayload.namedModelSelectedDisplayMessage ?? null,
    billingCycleStartMs: Number.isFinite(billingCycleStartMs) ? billingCycleStartMs : null,
    billingCycleEndMs: Number.isFinite(billingCycleEndMs) ? billingCycleEndMs : null,
    membershipType,
    updatedAt: Date.now(),
    error: null,
  };
}

export async function getCursorPeriodUsage(force = false): Promise<CursorPeriodUsageSnapshot> {
  const now = Date.now();

  if (!force && cachedSnapshot && now < cacheExpiresAt) {
    return cachedSnapshot;
  }

  const accessToken = readCursorAccessToken();

  if (!accessToken) {
    cachedSnapshot = buildUnavailableSnapshot('not_authenticated');
    cacheExpiresAt = now + 60_000;
    return cachedSnapshot;
  }

  const sessionToken = buildSessionToken(accessToken);

  try {
    const [usagePayload, membershipType] = await Promise.all([
      fetchCursorUsagePayload(accessToken, sessionToken),
      fetchCursorMembershipType(accessToken, sessionToken),
    ]);

    cachedSnapshot = parseUsageSnapshot(usagePayload, membershipType);
    cacheExpiresAt = now + CACHE_TTL_MS;
    return cachedSnapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'cursor_usage_failed';
    cachedSnapshot = buildUnavailableSnapshot(message);
    cacheExpiresAt = now + 60_000;
    return cachedSnapshot;
  }
}
