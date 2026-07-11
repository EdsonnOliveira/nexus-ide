import { copyFileSync, mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, platform, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { shell } from 'electron';
import { DatabaseSync } from 'node:sqlite';
import type {
  MacParakeetSourceType,
  MacParakeetStartCallResult,
  MacParakeetTranscriptionDetail,
  MacParakeetTranscriptionItem,
  MacParakeetTranscriptionsSnapshot,
  MacParakeetTranscriptSegment,
} from '../../types';
import {
  applyMacParakeetTitleOverride,
  setMacParakeetTitleOverride,
} from './macParakeetTitleStore';
import {
  applyAutoCalendarTitlesToTranscriptions,
  refreshAutoCalendarTitlesForItems,
} from './macParakeetCalendarTitleMatch';
import {
  type MacParakeetConclusionTranslationContext,
  translateMacParakeetConclusionToPortuguese,
} from './macParakeetConclusionPt';

const PARAKEET_AI_API_URL = 'https://www.parakeet-ai.com';
const PARAKEET_AI_DATA_DIR = join(homedir(), 'Library', 'Application Support', 'parakeetai-desktop');
const PARAKEET_AI_COOKIES_PATH = join(PARAKEET_AI_DATA_DIR, 'Cookies');
const PARAKEET_AI_BUNDLE_ID = 'org.parakeetai.ParakeetAI';
const PARAKEET_AI_PROTOCOL = 'parakeetai';
const PARAKEET_AI_DEFAULT_APP_VERSION = '3.6.14';
const HOME_DASHBOARD_PARAKEET_LIMIT = 12;
const PARAKEET_AI_PAGE_SIZE = 50;
const PARAKEET_AI_MAX_LIST_PAGES = 6;
const SNIPPET_FALLBACK_LENGTH = 120;
const REQUEST_TIMEOUT_MS = 15_000;

const VALID_SOURCE_TYPES = new Set<MacParakeetSourceType>(['interview', 'regular_call']);

interface ParakeetAiCallSession {
  id: string;
  mode: string;
  title: string;
  description?: string | null;
  shortDescription?: string | null;
  notes?: string | null;
  createdAt: string;
  activatedAt?: string | null;
  planSessionEndedAt?: string | null;
  lastPingedAt?: string | null;
  isEndedOrExpired?: boolean;
  saveTranscription?: boolean;
  deleted?: boolean;
  language?: string | null;
  extraContext?: string | null;
  aiModel?: string | null;
  autoGenerate?: boolean | null;
  documentSelectionMode?: string | null;
  resumeId?: string | null;
}

interface ParakeetAiSessionDefaults {
  language: string;
  aiModel: string;
  extraContext: string;
  documentSelectionMode: string;
  autoGenerate: boolean;
  saveTranscription: boolean;
}

interface ParakeetAiTranscriptionChunk {
  id?: string;
  content?: string;
  speaker?: string;
  type?: string;
  createdAt?: string;
}

const SPEECH_MERGE_GAP_MS = 15_000;
const LIVE_PING_THRESHOLD_MS = 120_000;
const SNAPSHOT_CACHE_TTL_MS = 30_000;
const DETAIL_CACHE_TTL_MS = 120_000;

interface SnapshotCacheEntry {
  key: string;
  expiresAt: number;
  snapshot: MacParakeetTranscriptionsSnapshot;
}

interface SessionsCacheEntry {
  expiresAt: number;
  sessions: ParakeetAiCallSession[];
}

interface DetailCacheEntry {
  expiresAt: number;
  detail: MacParakeetTranscriptionDetail;
}

let snapshotCache: SnapshotCacheEntry | null = null;
let sessionsCache: SessionsCacheEntry | null = null;
const detailCache = new Map<string, DetailCacheEntry>();

function cacheCallSessions(sessions: ParakeetAiCallSession[], ttlMs = SNAPSHOT_CACHE_TTL_MS): void {
  sessionsCache = {
    expiresAt: Date.now() + ttlMs,
    sessions,
  };
}

function readCachedCallSession(id: string): ParakeetAiCallSession | null {
  const cached = sessionsCache;
  if (!cached || cached.expiresAt <= Date.now()) {
    return null;
  }

  return cached.sessions.find((session) => session.id === id) ?? null;
}

function readCachedTranscriptionDetail(id: string): MacParakeetTranscriptionDetail | null {
  const cached = detailCache.get(id);
  if (!cached || cached.expiresAt <= Date.now()) {
    detailCache.delete(id);
    return null;
  }

  if (cached.detail.segments.length === 0 || cached.detail.conclusion === undefined) {
    return null;
  }

  return applyMacParakeetTitleOverride(cached.detail);
}

function cacheTranscriptionDetail(id: string, detail: MacParakeetTranscriptionDetail): void {
  detailCache.set(id, {
    expiresAt: Date.now() + DETAIL_CACHE_TTL_MS,
    detail,
  });
}

function clearTranscriptionDetailCache(): void {
  detailCache.clear();
}

function buildSnapshotCacheKey(sourceType: MacParakeetSourceType | null): string {
  return sourceType ?? 'all';
}

interface TrpcBatchResponse<T> {
  result?: {
    data?: {
      json?: T;
    };
  };
  error?: {
    json?: {
      message?: string;
      data?: {
        httpStatus?: number;
        code?: string;
      };
    };
  };
}

interface TrpcFetchOutcome<T> {
  data: T | null;
  unauthorized: boolean;
}

function isTrpcUnauthorizedEntry(entry: TrpcBatchResponse<unknown> | undefined): boolean {
  const error = entry?.error?.json;

  return (
    error?.message === 'UNAUTHORIZED' ||
    error?.data?.httpStatus === 401 ||
    error?.data?.code === 'UNAUTHORIZED'
  );
}

function emptySnapshot(
  overrides: Partial<MacParakeetTranscriptionsSnapshot> = {},
): MacParakeetTranscriptionsSnapshot {
  return {
    platformSupported: platform() === 'darwin',
    installed: false,
    available: false,
    transcriptions: [],
    ...overrides,
  };
}

function resolveParakeetAiAppPath(): string | null {
  if (platform() !== 'darwin') {
    return null;
  }

  try {
    const entries = readdirSync('/Applications');

    for (const entry of entries) {
      if (!entry.endsWith('.app')) {
        continue;
      }

      const plistPath = join('/Applications', entry, 'Contents/Info.plist');
      if (!existsSync(plistPath)) {
        continue;
      }

      try {
        const output = execFileSync(
          '/usr/bin/plutil',
          ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plistPath],
          { encoding: 'utf8' },
        ).trim();

        if (output === PARAKEET_AI_BUNDLE_ID) {
          return join('/Applications', entry);
        }
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function isMacParakeetInstalled(): boolean {
  if (platform() !== 'darwin') {
    return false;
  }

  return existsSync(PARAKEET_AI_DATA_DIR) || resolveParakeetAiAppPath() !== null;
}

function readParakeetAiSessionToken(): string | null {
  if (!existsSync(PARAKEET_AI_COOKIES_PATH)) {
    return null;
  }

  const readTokenFromPath = (cookiesPath: string): string | null => {
    try {
      const db = new DatabaseSync(cookiesPath, { readonly: true });

      try {
        const row = db
          .prepare(
            `SELECT value FROM cookies
             WHERE host_key LIKE '%parakeet-ai.com%'
               AND name = '__Secure-next-auth.session-token'
             LIMIT 1`,
          )
          .get() as { value?: string | Buffer } | undefined;

        const rawValue = row?.value;
        const token =
          typeof rawValue === 'string'
            ? rawValue.trim()
            : rawValue instanceof Buffer
              ? rawValue.toString('utf8').trim()
              : '';

        return token || null;
      } finally {
        db.close();
      }
    } catch {
      return null;
    }
  };

  const directToken = readTokenFromPath(PARAKEET_AI_COOKIES_PATH);
  if (directToken) {
    return directToken;
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'nexus-parakeet-cookies-'));
  const tempCookiesPath = join(tempDir, 'Cookies');

  try {
    copyFileSync(PARAKEET_AI_COOKIES_PATH, tempCookiesPath);
    return readTokenFromPath(tempCookiesPath);
  } catch {
    return null;
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore temp cleanup failures
    }
  }
}

function buildTrpcInput(payload: unknown): string {
  return encodeURIComponent(JSON.stringify({ '0': { json: payload } }));
}

async function fetchTrpcOnce<T>(
  procedure: string,
  payload: unknown,
  sessionToken: string,
): Promise<TrpcFetchOutcome<T>> {
  const url = `${PARAKEET_AI_API_URL}/api/trpc/${procedure}?batch=1&input=${buildTrpcInput(payload)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Cookie: `__Secure-next-auth.session-token=${sessionToken}; next-auth.session-token=${sessionToken}`,
      },
      signal: controller.signal,
    });

    const body = (await response.json()) as TrpcBatchResponse<T>[];
    const entry = body[0];

    if (response.status === 401 || isTrpcUnauthorizedEntry(entry)) {
      return { data: null, unauthorized: true };
    }

    if (!response.ok || !entry?.result?.data?.json) {
      return { data: null, unauthorized: false };
    }

    return { data: entry.result.data.json, unauthorized: false };
  } catch {
    return { data: null, unauthorized: false };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function mutateTrpcOnce<T>(
  procedure: string,
  payload: unknown,
  sessionToken: string,
): Promise<TrpcFetchOutcome<T>> {
  const url = `${PARAKEET_AI_API_URL}/api/trpc/${procedure}?batch=1`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Cookie: `__Secure-next-auth.session-token=${sessionToken}; next-auth.session-token=${sessionToken}`,
      },
      body: JSON.stringify({ '0': { json: payload } }),
      signal: controller.signal,
    });

    const body = (await response.json()) as TrpcBatchResponse<T>[];
    const entry = body[0];

    if (response.status === 401 || isTrpcUnauthorizedEntry(entry)) {
      return { data: null, unauthorized: true };
    }

    if (!response.ok || !entry?.result?.data?.json) {
      return { data: null, unauthorized: false };
    }

    return { data: entry.result.data.json, unauthorized: false };
  } catch {
    return { data: null, unauthorized: false };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchTrpc<T>(
  procedure: string,
  payload: unknown,
  sessionToken?: string | null,
): Promise<TrpcFetchOutcome<T>> {
  const token = sessionToken ?? readParakeetAiSessionToken();
  if (!token) {
    return { data: null, unauthorized: false };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await fetchTrpcOnce<T>(procedure, payload, token);
    if (result.data !== null) {
      return result;
    }

    if (result.unauthorized) {
      return result;
    }

    if (attempt === 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }
  }

  return { data: null, unauthorized: false };
}

async function mutateTrpc<T>(
  procedure: string,
  payload: unknown,
  sessionToken?: string | null,
): Promise<TrpcFetchOutcome<T>> {
  const token = sessionToken ?? readParakeetAiSessionToken();
  if (!token) {
    return { data: null, unauthorized: false };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await mutateTrpcOnce<T>(procedure, payload, token);
    if (result.data !== null) {
      return result;
    }

    if (result.unauthorized) {
      return result;
    }

    if (attempt === 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }
  }

  return { data: null, unauthorized: false };
}

function resolveParakeetSessionDefaults(
  sessions: ParakeetAiCallSession[],
): ParakeetAiSessionDefaults {
  const latest = sessions.find((session) => !session.deleted) ?? null;

  return {
    language: latest?.language?.trim() || 'pt',
    aiModel: latest?.aiModel?.trim() || 'gpt-5-mini',
    extraContext: latest?.extraContext ?? '',
    documentSelectionMode: latest?.documentSelectionMode?.trim() || 'all',
    autoGenerate: latest?.autoGenerate ?? false,
    saveTranscription: latest?.saveTranscription ?? true,
  };
}

function buildParakeetSessionDeepLink(callSessionId: string, authToken: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      callSessionId,
      authToken,
    }),
    'utf8',
  ).toString('base64');

  return `${PARAKEET_AI_PROTOCOL}://session?payload=${encodeURIComponent(payload)}`;
}

async function openParakeetSessionDeepLink(callSessionId: string, authToken: string): Promise<void> {
  const deepLink = buildParakeetSessionDeepLink(callSessionId, authToken);

  try {
    await shell.openExternal(deepLink);
  } catch {
    await openMacParakeetApp();
  }
}

function parseCreatedAtMs(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSourceType(value: string | undefined): MacParakeetSourceType {
  if (value && VALID_SOURCE_TYPES.has(value as MacParakeetSourceType)) {
    return value as MacParakeetSourceType;
  }

  return 'regular_call';
}

function resolveDurationMs(session: ParakeetAiCallSession): number | null {
  const startMs = parseCreatedAtMs(session.activatedAt ?? session.createdAt);
  const endMs = parseCreatedAtMs(session.planSessionEndedAt ?? session.lastPingedAt ?? undefined);

  if (!startMs || !endMs || endMs <= startMs) {
    return null;
  }

  return endMs - startMs;
}

function isCallSessionLive(session: ParakeetAiCallSession, nowMs = Date.now()): boolean {
  if (session.planSessionEndedAt) {
    return false;
  }

  if (session.isEndedOrExpired === true) {
    return false;
  }

  const activatedAtMs = parseCreatedAtMs(session.activatedAt ?? undefined);
  if (!activatedAtMs) {
    return false;
  }

  const lastPingedAtMs = parseCreatedAtMs(session.lastPingedAt ?? undefined);
  if (!lastPingedAtMs || nowMs - lastPingedAtMs > LIVE_PING_THRESHOLD_MS) {
    return false;
  }

  return true;
}

function stripMarkdownForSnippet(source: string): string {
  return source
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\s---+\s*/g, ' ')
    .replace(/^[\s]*[-*+•·]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractParakeetSummaryText(source: string): string {
  const normalized = source.replace(/\r/g, '\n').trim();
  const summaryMatch = normalized.match(/##\s*Summary\s*([\s\S]*?)(?:\n---\n|\n##\s|\s---\s##\s|$)/i);

  if (summaryMatch?.[1]?.trim()) {
    return summaryMatch[1].trim();
  }

  const summaryIndex = normalized.search(/##\s*Summary\b/i);

  if (summaryIndex >= 0) {
    const afterSummary = normalized.slice(summaryIndex).replace(/^##\s*Summary\s*/i, '');
    const sectionEnd = afterSummary.search(/\n---\n|\n##\s/);
    const section = sectionEnd >= 0 ? afterSummary.slice(0, sectionEnd) : afterSummary;
    return section.trim();
  }

  return normalized.replace(/^##\s*Details[\s\S]*?(?=##\s*Summary\b|$)/i, '').trim();
}

function formatParakeetSnippet(source: string): string {
  const extracted = extractParakeetSummaryText(source);
  const plain = stripMarkdownForSnippet(extracted);

  if (!plain) {
    return '';
  }

  if (plain.length <= SNIPPET_FALLBACK_LENGTH) {
    return plain;
  }

  return `${plain.slice(0, SNIPPET_FALLBACK_LENGTH).trimEnd()}…`;
}

function resolveConclusion(session: ParakeetAiCallSession): string | null {
  const candidates = [session.notes, session.description, session.shortDescription];

  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return null;
}

function buildConclusionTranslationContext(
  sessionToken?: string | null,
): MacParakeetConclusionTranslationContext | undefined {
  const token = sessionToken ?? readParakeetAiSessionToken();
  if (!token) {
    return undefined;
  }

  return {
    sessionToken: token,
  };
}

async function resolveLocalizedConclusion(
  session: ParakeetAiCallSession,
  sessionToken?: string | null,
): Promise<string | null> {
  const conclusion = resolveConclusion(session);
  if (!conclusion) {
    return null;
  }

  return translateMacParakeetConclusionToPortuguese(
    conclusion,
    buildConclusionTranslationContext(sessionToken),
  );
}

async function ensurePortugueseConclusion(
  detail: MacParakeetTranscriptionDetail,
  id?: string,
  sessionToken?: string | null,
): Promise<MacParakeetTranscriptionDetail> {
  if (!detail.conclusion?.trim()) {
    return detail;
  }

  const conclusion = await translateMacParakeetConclusionToPortuguese(
    detail.conclusion,
    buildConclusionTranslationContext(sessionToken),
  );
  if (conclusion === detail.conclusion) {
    return detail;
  }

  const nextDetail = {
    ...detail,
    conclusion,
  };

  if (id) {
    cacheTranscriptionDetail(id, nextDetail);
  }

  return nextDetail;
}

function resolveSnippet(session: ParakeetAiCallSession): string {
  const candidates = [session.shortDescription, session.description, session.notes];

  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed) {
      continue;
    }

    const formatted = formatParakeetSnippet(trimmed);
    if (formatted) {
      return formatted;
    }
  }

  return '';
}

async function resolveLocalizedSnippet(
  session: ParakeetAiCallSession,
  sessionToken?: string | null,
): Promise<string> {
  const snippet = resolveSnippet(session);
  if (!snippet) {
    return '';
  }

  const source = snippet.endsWith('…') ? snippet.slice(0, -1).trimEnd() : snippet;
  const translated = await translateMacParakeetConclusionToPortuguese(
    source,
    buildConclusionTranslationContext(sessionToken),
  );

  if (translated.length <= SNIPPET_FALLBACK_LENGTH) {
    return translated;
  }

  return `${translated.slice(0, SNIPPET_FALLBACK_LENGTH).trimEnd()}…`;
}

function mapCallSession(session: ParakeetAiCallSession): MacParakeetTranscriptionItem {
  const subtitle = session.shortDescription?.trim() || session.description?.trim() || null;

  return applyMacParakeetTitleOverride({
    id: session.id,
    createdAt: parseCreatedAtMs(session.createdAt),
    title: session.title?.trim() || 'Sessão',
    snippet: resolveSnippet(session),
    durationMs: resolveDurationMs(session),
    sourceType: normalizeSourceType(session.mode),
    channelName: subtitle,
    isFavorite: false,
    isLive: isCallSessionLive(session),
  });
}

async function mapCallSessionLocalized(
  session: ParakeetAiCallSession,
  sessionToken?: string | null,
): Promise<MacParakeetTranscriptionItem> {
  const item = mapCallSession(session);
  const snippet = await resolveLocalizedSnippet(session, sessionToken);

  if (!snippet || snippet === item.snippet) {
    return item;
  }

  return {
    ...item,
    snippet,
  };
}

function buildTranscriptText(chunks: ParakeetAiTranscriptionChunk[]): string {
  return chunks
    .map((chunk) => chunk.content?.trim())
    .filter((content): content is string => Boolean(content))
    .join('\n\n');
}

function resolveIsSelfSpeaker(type: string | undefined): boolean {
  const normalizedType = type?.trim().toLowerCase();

  return (
    normalizedType === 'microphone' ||
    normalizedType === 'mic' ||
    normalizedType === 'combined'
  );
}

function resolveSpeakerLabel(
  speaker: string | undefined,
  type: string | undefined,
  sourceType: MacParakeetSourceType,
): string {
  if (resolveIsSelfSpeaker(type)) {
    return 'Você';
  }

  const speakerNumber = Number.parseInt(speaker ?? '', 10);
  const remoteSpeakerPrefix = sourceType === 'interview' ? 'Entrevistador' : 'Pessoa';

  if (Number.isFinite(speakerNumber)) {
    return `${remoteSpeakerPrefix} ${speakerNumber}`;
  }

  if (speaker?.trim()) {
    return `${remoteSpeakerPrefix} ${speaker.trim()}`;
  }

  return remoteSpeakerPrefix;
}

function isQuestionContent(content: string): boolean {
  return /[?？]\s*$/.test(content.trim()) || content.includes('?');
}

function buildSpeechSegments(
  chunks: ParakeetAiTranscriptionChunk[],
  sourceType: MacParakeetSourceType,
): MacParakeetTranscriptSegment[] {
  const segments: MacParakeetTranscriptSegment[] = [];

  for (const chunk of chunks) {
    const content = chunk.content?.trim();
    if (!content) {
      continue;
    }

    const createdAt = parseCreatedAtMs(chunk.createdAt);
    const isSelf = resolveIsSelfSpeaker(chunk.type);
    const speakerLabel = resolveSpeakerLabel(chunk.speaker, chunk.type, sourceType);
    const last = segments[segments.length - 1];

    if (
      last &&
      last.kind === 'speech' &&
      last.isSelf === isSelf &&
      last.speakerLabel === speakerLabel &&
      createdAt - last.createdAt <= SPEECH_MERGE_GAP_MS
    ) {
      last.content = `${last.content} ${content}`.trim();
      last.isQuestion = last.isQuestion || isQuestionContent(content);
      continue;
    }

    segments.push({
      id: chunk.id ?? `${createdAt}-${segments.length}`,
      kind: 'speech',
      createdAt,
      isSelf,
      speakerLabel,
      content,
      question: null,
      answer: null,
      isQuestion: isQuestionContent(content),
    });
  }

  return segments;
}

async function fetchTranscriptionChunks(
  callSessionId: string,
  sessionToken: string,
): Promise<ParakeetAiTranscriptionChunk[]> {
  const result = await fetchTrpc<ParakeetAiTranscriptionChunk[]>(
    'callSession.transcription.get',
    { callSessionId },
    sessionToken,
  );

  return result.data ?? [];
}

function isInternalParakeetHelperSession(session: ParakeetAiCallSession): boolean {
  const title = session.title?.trim().toLowerCase() ?? '';
  return title === 'nexus tradução' || title === 'nexus-translate' || title === 'nexus translate';
}

function isListableCallSession(
  session: ParakeetAiCallSession,
  sourceType: MacParakeetSourceType | null,
): boolean {
  if (session.deleted || isInternalParakeetHelperSession(session)) {
    return false;
  }

  if (!session.activatedAt) {
    return false;
  }

  if (sourceType && normalizeSourceType(session.mode) !== sourceType) {
    return false;
  }

  return true;
}

async function fetchCallSessionsPage(
  sessionToken: string,
  offset: number,
): Promise<{ sessions: ParakeetAiCallSession[]; hasMore: boolean; unauthorized: boolean }> {
  const result = await fetchTrpc<{
    data: ParakeetAiCallSession[];
    hasMore?: boolean;
  }>('callSession.getMany', { limit: PARAKEET_AI_PAGE_SIZE, offset }, sessionToken);

  if (result.unauthorized) {
    return { sessions: [], hasMore: false, unauthorized: true };
  }

  const sessions = result.data?.data ?? [];
  const hasMore = Boolean(result.data?.hasMore) && sessions.length > 0;

  return { sessions, hasMore, unauthorized: false };
}

async function fetchCallSessionsRaw(
  sessionToken: string,
): Promise<{ sessions: ParakeetAiCallSession[]; unauthorized: boolean }> {
  const { sessions, unauthorized } = await fetchCallSessionsPage(sessionToken, 0);

  if (unauthorized) {
    return { sessions: [], unauthorized: true };
  }

  cacheCallSessions(sessions);
  return { sessions, unauthorized: false };
}

async function fetchCallSessions(
  sourceType: MacParakeetSourceType | null,
  sessionToken: string,
): Promise<{ sessions: ParakeetAiCallSession[]; unauthorized: boolean }> {
  const listable: ParakeetAiCallSession[] = [];
  const fetched: ParakeetAiCallSession[] = [];
  let offset = 0;

  for (let page = 0; page < PARAKEET_AI_MAX_LIST_PAGES; page += 1) {
    const { sessions, hasMore, unauthorized } = await fetchCallSessionsPage(sessionToken, offset);

    if (unauthorized) {
      return { sessions: [], unauthorized: true };
    }

    if (sessions.length === 0) {
      break;
    }

    fetched.push(...sessions);

    for (const session of sessions) {
      if (isListableCallSession(session, sourceType)) {
        listable.push(session);
      }
    }

    if (listable.length >= HOME_DASHBOARD_PARAKEET_LIMIT || !hasMore) {
      break;
    }

    offset += sessions.length;
  }

  cacheCallSessions(fetched);
  return { sessions: listable, unauthorized: false };
}

async function fetchCallSessionById(
  callSessionId: string,
  sessionToken: string,
): Promise<ParakeetAiCallSession | null> {
  const cachedSession = readCachedCallSession(callSessionId);
  if (cachedSession) {
    return cachedSession;
  }

  const session = await fetchTrpc<ParakeetAiCallSession>(
    'callSession.get',
    { callSessionId },
    sessionToken,
  );

  if (session.unauthorized || !session.data?.id) {
    return null;
  }

  const resolvedSession = session.data;

  const cached = sessionsCache;
  if (cached && cached.expiresAt > Date.now()) {
    cacheCallSessions([
      ...cached.sessions.filter((entry) => entry.id !== resolvedSession.id),
      resolvedSession,
    ]);
  } else {
    cacheCallSessions([resolvedSession]);
  }

  return resolvedSession;
}

function readCachedCallSessionsList(): ParakeetAiCallSession[] {
  const cached = sessionsCache;
  if (!cached || cached.expiresAt <= Date.now()) {
    return [];
  }

  return cached.sessions;
}

export async function getMacParakeetTranscriptionsSnapshot(
  sourceType: MacParakeetSourceType | null = null,
  forceRefresh = false,
): Promise<MacParakeetTranscriptionsSnapshot> {
  if (platform() !== 'darwin') {
    return emptySnapshot({ platformSupported: false });
  }

  const installed = isMacParakeetInstalled();
  if (!installed) {
    return emptySnapshot({ installed: false });
  }

  const cacheKey = buildSnapshotCacheKey(sourceType);
  const nowMs = Date.now();
  const cached = snapshotCache;

  if (forceRefresh) {
    clearTranscriptionDetailCache();
    snapshotCache = null;
    sessionsCache = null;
  }

  if (
    !forceRefresh &&
    cached &&
    cached.key === cacheKey &&
    cached.expiresAt > nowMs
  ) {
    const refreshedTranscriptions = await refreshAutoCalendarTitlesForItems(
      cached.snapshot.transcriptions,
      readCachedCallSessionsList(),
    );

    const hasTitleChanges = refreshedTranscriptions.some(
      (item, index) => item.title !== cached.snapshot.transcriptions[index]?.title,
    );

    if (hasTitleChanges) {
      const nextSnapshot = {
        ...cached.snapshot,
        transcriptions: refreshedTranscriptions,
      };

      snapshotCache = {
        ...cached,
        snapshot: nextSnapshot,
      };

      return nextSnapshot;
    }

    return cached.snapshot;
  }

  const sessionToken = readParakeetAiSessionToken();
  if (!sessionToken) {
    return emptySnapshot({ installed: true, available: false });
  }

  try {
    const { sessions, unauthorized } = await fetchCallSessions(sourceType, sessionToken);

    if (unauthorized) {
      snapshotCache = null;
      sessionsCache = null;
      clearTranscriptionDetailCache();
      return emptySnapshot({ installed: true, available: false });
    }

    let transcriptions = await Promise.all(
      sessions
        .slice()
        .sort((left, right) => parseCreatedAtMs(right.createdAt) - parseCreatedAtMs(left.createdAt))
        .slice(0, HOME_DASHBOARD_PARAKEET_LIMIT)
        .map((session) => mapCallSessionLocalized(session, sessionToken)),
    );

    if (!forceRefresh) {
      transcriptions = await applyAutoCalendarTitlesToTranscriptions(sessions, transcriptions);
    }

    const snapshot = {
      platformSupported: true,
      installed: true,
      available: true,
      transcriptions,
    };

    snapshotCache = {
      key: cacheKey,
      expiresAt: nowMs + SNAPSHOT_CACHE_TTL_MS,
      snapshot,
    };

    return snapshot;
  } catch {
    if (cached && cached.key === cacheKey) {
      return cached.snapshot;
    }

    return emptySnapshot({ installed: true, available: false });
  }
}

export async function getMacParakeetTranscriptionDetail(
  id: string,
): Promise<MacParakeetTranscriptionDetail | null> {
  const trimmedId = id.trim();
  if (!trimmedId || platform() !== 'darwin') {
    return null;
  }

  const sessionToken = readParakeetAiSessionToken();
  if (!sessionToken) {
    return null;
  }

  const cachedDetail = readCachedTranscriptionDetail(trimmedId);
  if (cachedDetail) {
    return ensurePortugueseConclusion(cachedDetail, trimmedId, sessionToken);
  }

  const session = await fetchCallSessionById(trimmedId, sessionToken);
  if (!session || session.deleted || isInternalParakeetHelperSession(session)) {
    return null;
  }

  let chunks = await fetchTranscriptionChunks(trimmedId, sessionToken);
  if (chunks.length === 0) {
    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
    chunks = await fetchTranscriptionChunks(trimmedId, sessionToken);
  }

  const sourceType = normalizeSourceType(session.mode);
  const segments = buildSpeechSegments(chunks, sourceType);
  const speechTranscript = buildTranscriptText(chunks);
  const transcript =
    speechTranscript ||
    segments
      .map((segment) => segment.content.trim())
      .filter(Boolean)
      .join('\n\n');

  const localizedItem = await mapCallSessionLocalized(session, sessionToken);
  const [item] = await applyAutoCalendarTitlesToTranscriptions([session], [localizedItem]);

  const detail: MacParakeetTranscriptionDetail = {
    ...item,
    transcript,
    conclusion: await resolveLocalizedConclusion(session, sessionToken),
    segments,
    sourceUrl: `${PARAKEET_AI_API_URL}/dashboard`,
  };

  if (segments.length > 0) {
    cacheTranscriptionDetail(trimmedId, detail);
  }

  return detail;
}

export function renameMacParakeetTranscriptionTitle(
  id: string,
  title: string,
): { ok: true; title: string } | { ok: false } {
  const trimmedTitle = setMacParakeetTitleOverride(id, title);
  if (!trimmedTitle) {
    return { ok: false };
  }

  const cached = snapshotCache;
  if (cached) {
    snapshotCache = {
      ...cached,
      snapshot: {
        ...cached.snapshot,
        transcriptions: cached.snapshot.transcriptions.map((item) =>
          item.id === id.trim() ? { ...item, title: trimmedTitle } : item,
        ),
      },
    };
  }

  const cachedDetail = detailCache.get(id.trim());
  if (cachedDetail) {
    cachedDetail.detail = {
      ...cachedDetail.detail,
      title: trimmedTitle,
    };
  }

  return { ok: true, title: trimmedTitle };
}

export async function openMacParakeetApp(): Promise<void> {
  if (platform() !== 'darwin') {
    return;
  }

  const appPath = resolveParakeetAiAppPath();
  if (appPath) {
    await shell.openPath(appPath);
    return;
  }

  await shell.openExternal(`${PARAKEET_AI_API_URL}/dashboard`);
}

export async function startMacParakeetCallFromEvent(
  title: string,
): Promise<MacParakeetStartCallResult> {
  if (platform() !== 'darwin') {
    return { ok: false, reason: 'unsupported' };
  }

  if (!isMacParakeetInstalled()) {
    await openMacParakeetApp();
    return { ok: false, reason: 'not_installed' };
  }

  const sessionToken = readParakeetAiSessionToken();
  if (!sessionToken) {
    await openMacParakeetApp();
    return { ok: false, reason: 'unauthorized' };
  }

  const trimmedTitle = title.trim().slice(0, 255);
  if (!trimmedTitle) {
    return { ok: false, reason: 'invalid_title' };
  }

  const { sessions, unauthorized } = await fetchCallSessionsRaw(sessionToken);
  if (unauthorized) {
    await openMacParakeetApp();
    return { ok: false, reason: 'unauthorized' };
  }

  const defaults = resolveParakeetSessionDefaults(sessions);
  const created = await mutateTrpc<ParakeetAiCallSession>(
    'callSession.create',
    {
      free: false,
      sessionMode: 'regular_call',
      mode: 'regular_call',
      title: trimmedTitle,
      description: '',
      resumeId: null,
      documentSelectionMode: defaults.documentSelectionMode,
      selectedDocumentIds: [],
      language: defaults.language,
      extraContext: defaults.extraContext,
      aiModel: defaults.aiModel,
      autoGenerate: defaults.autoGenerate,
      saveTranscription: defaults.saveTranscription,
      createdFrom: 'desktop-app',
      autoStarted: true,
      activationParameters: {
        platform: 'desktop-app',
        os: 'macos',
        osVersion: release(),
        version: PARAKEET_AI_DEFAULT_APP_VERSION,
      },
    },
    sessionToken,
  );

  if (created.unauthorized) {
    await openMacParakeetApp();
    return { ok: false, reason: 'unauthorized' };
  }

  const callSessionId = created.data?.id?.trim();
  if (!callSessionId) {
    await openMacParakeetApp();
    return { ok: false, reason: 'create_failed' };
  }

  setMacParakeetTitleOverride(callSessionId, trimmedTitle);
  snapshotCache = null;
  cacheCallSessions([created.data as ParakeetAiCallSession, ...sessions], SNAPSHOT_CACHE_TTL_MS);

  await openParakeetSessionDeepLink(callSessionId, sessionToken);

  return {
    ok: true,
    callSessionId,
    title: trimmedTitle,
  };
}
