import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import https from 'node:https';
import { DatabaseSync } from 'node:sqlite';
import { getCursorPeriodUsage } from './cursorUsage';

const execFileAsync = promisify(execFile);
const REQUEST_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

export type AiUsageProviderId =
  | 'cursor'
  | 'claude'
  | 'opencode'
  | 'gemini'
  | 'codex'
  | 'antigravity';

export interface AiProviderUsageItem {
  id: AiUsageProviderId;
  label: string;
  available: boolean;
  percent: number | null;
  detail: string | null;
}

export interface AiProviderUsageSnapshot {
  items: AiProviderUsageItem[];
  updatedAt: number;
}

const PROVIDERS: Array<{ id: AiUsageProviderId; label: string }> = [
  { id: 'cursor', label: 'Cursor' },
  { id: 'claude', label: 'Claude' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'codex', label: 'Codex' },
  { id: 'antigravity', label: 'Antigravity' },
];

let cachedSnapshot: AiProviderUsageSnapshot | null = null;
let cacheExpiresAt = 0;

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function readJsonFile(filePath: string): unknown {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function requestJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...headers,
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        const location = response.headers.location;
        const status = response.statusCode ?? 0;

        if (status >= 300 && status < 400 && typeof location === 'string' && location.length > 0) {
          response.resume();

          try {
            const nextUrl = new URL(location, url).toString();
            const currentHost = new URL(url).host;
            const nextHost = new URL(nextUrl).host;

            if (nextHost !== currentHost) {
              reject(new Error('usage_redirect_blocked'));
              return;
            }

            void requestJson<T>(nextUrl, headers).then(resolve).catch(reject);
          } catch {
            reject(new Error('usage_redirect_invalid'));
          }

          return;
        }

        const chunks: Buffer[] = [];

        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');

          if (status < 200 || status >= 300) {
            reject(new Error(`usage_http_${status}`));
            return;
          }

          try {
            resolve(JSON.parse(body) as T);
          } catch {
            reject(new Error('usage_invalid_json'));
          }
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error('usage_timeout'));
    });

    request.on('error', reject);
    request.end();
  });
}

function disconnected(id: AiUsageProviderId, label: string): AiProviderUsageItem {
  return {
    id,
    label,
    available: false,
    percent: null,
    detail: 'Não conectado',
  };
}

async function readClaudeAccessToken(): Promise<string | null> {
  const fromEnv = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();

  if (fromEnv) {
    return fromEnv;
  }

  try {
    const { stdout } = await execFileAsync('/usr/bin/security', [
      'find-generic-password',
      '-s',
      'Claude Code-credentials',
      '-w',
    ]);
    const raw = stdout.trim();

    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string } };
      const token = parsed.claudeAiOauth?.accessToken?.trim();

      if (token) {
        return token;
      }
    }

    if (raw.length > 0) {
      return raw;
    }
  } catch {
  }

  const filePayload = readJsonFile(join(homedir(), '.claude', '.credentials.json')) as {
    claudeAiOauth?: { accessToken?: string };
  } | null;
  const fileToken = filePayload?.claudeAiOauth?.accessToken?.trim();

  return fileToken && fileToken.length > 0 ? fileToken : null;
}

function toPercent(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return clampPercent(value <= 1 ? value * 100 : value);
}

function parseClaudeUsage(payload: unknown): { percent: number; detail: string } | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as {
    limits?: Array<{ name?: string; percent?: number }>;
    five_hour?: { utilization?: number };
    seven_day?: { utilization?: number };
  };

  const namedLimits = (record.limits ?? [])
    .map((item) => ({
      label: item.name?.trim() || 'Limite',
      percent:
        typeof item.percent === 'number' && Number.isFinite(item.percent)
          ? clampPercent(item.percent)
          : null,
    }))
    .filter((item): item is { label: string; percent: number } => item.percent !== null);

  if (namedLimits.length > 0) {
    return {
      percent: Math.max(...namedLimits.map((item) => item.percent)),
      detail: namedLimits.map((item) => `${item.label} ${Math.round(item.percent)}%`).join(' · '),
    };
  }

  const fiveHour = toPercent(record.five_hour?.utilization);
  const sevenDay = toPercent(record.seven_day?.utilization);
  const parts: string[] = [];

  if (fiveHour !== null) {
    parts.push(`5h ${Math.round(fiveHour)}%`);
  }

  if (sevenDay !== null) {
    parts.push(`Semanal ${Math.round(sevenDay)}%`);
  }

  if (parts.length === 0) {
    return null;
  }

  return {
    percent: Math.max(fiveHour ?? 0, sevenDay ?? 0),
    detail: parts.join(' · '),
  };
}

async function getClaudeUsage(): Promise<AiProviderUsageItem> {
  const token = await readClaudeAccessToken();

  if (!token) {
    return disconnected('claude', 'Claude');
  }

  try {
    const payload = await requestJson<unknown>('https://api.anthropic.com/api/oauth/usage', {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
    });
    const parsed = parseClaudeUsage(payload);

    if (!parsed) {
      return {
        id: 'claude',
        label: 'Claude',
        available: false,
        percent: null,
        detail: 'Sem dados de uso',
      };
    }

    return {
      id: 'claude',
      label: 'Claude',
      available: true,
      percent: parsed.percent,
      detail: parsed.detail,
    };
  } catch {
    return {
      id: 'claude',
      label: 'Claude',
      available: false,
      percent: null,
      detail: 'Falha ao ler uso',
    };
  }
}

function parseCodexUsage(payload: unknown): { percent: number; detail: string } | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as {
    rate_limit?: {
      primary_window?: { used_percent?: number };
      secondary_window?: { used_percent?: number };
      primary?: { used_percent?: number };
      secondary?: { used_percent?: number };
    };
  };

  const limit = record.rate_limit;
  const fiveHourRaw = limit?.primary_window?.used_percent ?? limit?.primary?.used_percent;
  const weeklyRaw = limit?.secondary_window?.used_percent ?? limit?.secondary?.used_percent;
  const fiveHour =
    typeof fiveHourRaw === 'number' && Number.isFinite(fiveHourRaw) ? clampPercent(fiveHourRaw) : null;
  const weekly =
    typeof weeklyRaw === 'number' && Number.isFinite(weeklyRaw) ? clampPercent(weeklyRaw) : null;
  const parts: string[] = [];

  if (fiveHour !== null) {
    parts.push(`5h ${Math.round(fiveHour)}%`);
  }

  if (weekly !== null) {
    parts.push(`Semanal ${Math.round(weekly)}%`);
  }

  if (parts.length === 0) {
    return null;
  }

  return {
    percent: Math.max(fiveHour ?? 0, weekly ?? 0),
    detail: parts.join(' · '),
  };
}

async function getCodexUsage(): Promise<AiProviderUsageItem> {
  const payload = readJsonFile(join(homedir(), '.codex', 'auth.json')) as {
    tokens?: { access_token?: string; account_id?: string };
  } | null;
  const accessToken = payload?.tokens?.access_token?.trim();
  const accountId = payload?.tokens?.account_id?.trim();

  if (!accessToken) {
    return disconnected('codex', 'Codex');
  }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };

    if (accountId) {
      headers['ChatGPT-Account-Id'] = accountId;
    }

    const usage = await requestJson<unknown>('https://chatgpt.com/backend-api/wham/usage', headers);
    const parsed = parseCodexUsage(usage);

    if (!parsed) {
      return {
        id: 'codex',
        label: 'Codex',
        available: false,
        percent: null,
        detail: 'Sem dados de uso',
      };
    }

    return {
      id: 'codex',
      label: 'Codex',
      available: true,
      percent: parsed.percent,
      detail: parsed.detail,
    };
  } catch {
    return {
      id: 'codex',
      label: 'Codex',
      available: false,
      percent: null,
      detail: 'Falha ao ler uso',
    };
  }
}

async function getCursorUsageItem(): Promise<AiProviderUsageItem> {
  try {
    const snapshot = await getCursorPeriodUsage();

    if (!snapshot.available) {
      if (snapshot.error === 'not_authenticated') {
        return disconnected('cursor', 'Cursor');
      }

      return {
        id: 'cursor',
        label: 'Cursor',
        available: false,
        percent: null,
        detail: 'Falha ao ler uso',
      };
    }

    const parts = [
      `Auto ${Math.round(snapshot.autoPercentUsed)}%`,
      `API ${Math.round(snapshot.apiPercentUsed)}%`,
    ];

    if (snapshot.membershipType) {
      parts.unshift(snapshot.membershipType);
    }

    return {
      id: 'cursor',
      label: 'Cursor',
      available: true,
      percent: clampPercent(
        Math.max(snapshot.autoPercentUsed, snapshot.apiPercentUsed, snapshot.percent),
      ),
      detail: parts.join(' · '),
    };
  } catch {
    return disconnected('cursor', 'Cursor');
  }
}

function readOpenCodeApiKeyFromAuthFile(): string | null {
  const paths = [
    join(homedir(), '.local', 'share', 'opencode', 'auth.json'),
    join(homedir(), '.config', 'opencode', 'auth.json'),
  ];

  for (const filePath of paths) {
    const payload = readJsonFile(filePath);

    if (!payload || typeof payload !== 'object') {
      continue;
    }

    const record = payload as Record<string, { type?: string; key?: string; access?: string }>;

    for (const providerId of ['opencode', 'opencode-go', 'zen']) {
      const entry = record[providerId];
      const key = entry?.key?.trim() || entry?.access?.trim();

      if (key) {
        return key;
      }
    }
  }

  return null;
}

function readOpenCodeApiKeyFromDb(): string | null {
  const dbPath = join(homedir(), '.local', 'share', 'opencode', 'opencode.db');

  if (!existsSync(dbPath)) {
    return null;
  }

  let db: DatabaseSync | null = null;

  try {
    db = new DatabaseSync(dbPath, { readonly: true });

    const credentialRows = db
      .prepare(
        "SELECT value FROM credential WHERE integration_id LIKE '%opencode%' OR label LIKE '%opencode%' OR label LIKE '%zen%'",
      )
      .all() as Array<{ value?: string }>;

    for (const row of credentialRows) {
      const raw = row.value?.trim();

      if (!raw) {
        continue;
      }

      if (!raw.startsWith('{')) {
        return raw;
      }

      try {
        const parsed = JSON.parse(raw) as { key?: string; access_token?: string; token?: string };
        const key = parsed.key?.trim() || parsed.access_token?.trim() || parsed.token?.trim();

        if (key) {
          return key;
        }
      } catch {
      }
    }

    const accountRow = db
      .prepare('SELECT access_token FROM account ORDER BY time_updated DESC LIMIT 1')
      .get() as { access_token?: string } | undefined;
    const accountToken = accountRow?.access_token?.trim();

    if (accountToken) {
      return accountToken;
    }
  } catch {
    return null;
  } finally {
    db?.close();
  }

  return null;
}

function readOpenCodeApiKey(): string | null {
  const fromEnv =
    process.env.OPENCODE_API_KEY?.trim() || process.env.OPENCODE_GO_API_KEY?.trim();

  if (fromEnv) {
    return fromEnv;
  }

  return readOpenCodeApiKeyFromAuthFile() ?? readOpenCodeApiKeyFromDb();
}

function parseOpenCodeUsage(payload: unknown): { percent: number; detail: string } | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as {
    usage?: {
      rolling?: { status?: string; percent?: number };
      weekly?: { status?: string; percent?: number };
      monthly?: { status?: string; percent?: number };
    };
  };
  const usage = record.usage;

  if (!usage) {
    return null;
  }

  const windows: Array<{ label: string; percent: number }> = [];

  for (const [key, label] of [
    ['rolling', '5h'],
    ['weekly', 'Semanal'],
    ['monthly', 'Mensal'],
  ] as const) {
    const window = usage[key];
    const percent =
      window && typeof window.percent === 'number' && Number.isFinite(window.percent)
        ? clampPercent(window.percent)
        : null;

    if (percent !== null && window?.status !== 'unavailable') {
      windows.push({ label, percent });
    }
  }

  if (windows.length === 0) {
    return null;
  }

  return {
    percent: Math.max(...windows.map((item) => item.percent)),
    detail: windows.map((item) => `${item.label} ${Math.round(item.percent)}%`).join(' · '),
  };
}

async function getOpenCodeUsage(): Promise<AiProviderUsageItem> {
  const apiKey = readOpenCodeApiKey();
  const dbPath = join(homedir(), '.local', 'share', 'opencode', 'opencode.db');
  const hasLocalData = existsSync(dbPath);

  if (!apiKey) {
    if (!hasLocalData) {
      return disconnected('opencode', 'OpenCode');
    }

    return {
      id: 'opencode',
      label: 'OpenCode',
      available: false,
      percent: null,
      detail: 'Plano grátis · conecte a API para ver cota',
    };
  }

  try {
    const payload = await requestJson<unknown>('https://opencode.ai/zen/go/v1/usage', {
      Authorization: `Bearer ${apiKey}`,
    });
    const parsed = parseOpenCodeUsage(payload);

    if (!parsed) {
      return {
        id: 'opencode',
        label: 'OpenCode',
        available: false,
        percent: null,
        detail: 'Sem dados de uso',
      };
    }

    return {
      id: 'opencode',
      label: 'OpenCode',
      available: true,
      percent: parsed.percent,
      detail: parsed.detail,
    };
  } catch {
    return {
      id: 'opencode',
      label: 'OpenCode',
      available: false,
      percent: null,
      detail: 'Falha ao ler uso',
    };
  }
}

function getGeminiUsage(): AiProviderUsageItem {
  const oauthPath = join(homedir(), '.gemini', 'oauth_creds.json');
  const settingsPath = join(homedir(), '.gemini', 'settings.json');

  if (!existsSync(oauthPath) && !existsSync(settingsPath)) {
    return disconnected('gemini', 'Gemini');
  }

  return {
    id: 'gemini',
    label: 'Gemini',
    available: false,
    percent: null,
    detail: 'Sem limite público',
  };
}

function getAntigravityUsage(): AiProviderUsageItem {
  const folder = join(homedir(), '.gemini', 'antigravity');

  if (!existsSync(folder)) {
    return disconnected('antigravity', 'Antigravity');
  }

  return {
    id: 'antigravity',
    label: 'Antigravity',
    available: false,
    percent: null,
    detail: 'Sem limite público',
  };
}

export async function getAiProviderUsage(force = false): Promise<AiProviderUsageSnapshot> {
  const now = Date.now();

  if (!force && cachedSnapshot && now < cacheExpiresAt) {
    return cachedSnapshot;
  }

  const [cursor, claude, codex, opencode] = await Promise.all([
    getCursorUsageItem(),
    getClaudeUsage(),
    getCodexUsage(),
    getOpenCodeUsage(),
  ]);

  const byId: Record<AiUsageProviderId, AiProviderUsageItem> = {
    cursor,
    claude,
    opencode,
    gemini: getGeminiUsage(),
    codex,
    antigravity: getAntigravityUsage(),
  };

  cachedSnapshot = {
    items: PROVIDERS.map((provider) => byId[provider.id]),
    updatedAt: now,
  };
  cacheExpiresAt = now + CACHE_TTL_MS;

  return cachedSnapshot;
}
