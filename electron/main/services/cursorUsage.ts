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
  };
  displayMessage?: string;
  autoModelSelectedDisplayMessage?: string;
  namedModelSelectedDisplayMessage?: string;
}

interface CursorStripeApiResponse {
  individualMembershipType?: string;
  membershipType?: string;
}

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

function readCursorSessionToken(): string | null {
  const dbPath = resolveCursorStateDbPath();

  if (!dbPath) {
    return null;
  }

  const accessToken = readStateValue(dbPath, 'cursorAuth/accessToken');

  if (!accessToken) {
    return null;
  }

  return buildSessionToken(accessToken);
}

function requestJson<T>(url: string, sessionToken: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: 'GET',
        headers: {
          Cookie: `WorkosCursorSessionToken=${sessionToken}`,
          Accept: 'application/json',
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
    request.end();
  });
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
    percent: Math.max(0, Math.min(100, totalPercentUsed)),
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

  const sessionToken = readCursorSessionToken();

  if (!sessionToken) {
    cachedSnapshot = buildUnavailableSnapshot('not_authenticated');
    cacheExpiresAt = now + 60_000;
    return cachedSnapshot;
  }

  try {
    const [usagePayload, stripePayload] = await Promise.all([
      requestJson<CursorPeriodUsageApiResponse>(
        'https://cursor.com/api/dashboard/get-current-period-usage',
        sessionToken,
      ),
      requestJson<CursorStripeApiResponse>('https://cursor.com/api/auth/stripe', sessionToken).catch(
        () => ({} as CursorStripeApiResponse),
      ),
    ]);

    cachedSnapshot = parseUsageSnapshot(usagePayload, parseMembershipLabel(stripePayload));
    cacheExpiresAt = now + CACHE_TTL_MS;
    return cachedSnapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'cursor_usage_failed';
    cachedSnapshot = buildUnavailableSnapshot(message);
    cacheExpiresAt = now + 60_000;
    return cachedSnapshot;
  }
}
