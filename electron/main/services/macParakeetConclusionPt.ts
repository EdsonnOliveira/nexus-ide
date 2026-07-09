import { release } from 'node:os';

const PARAKEET_AI_API_URL = 'https://www.parakeet-ai.com';
const TRANSLATION_TIMEOUT_MS = 45_000;
const TRANSLATION_SESSION_TTL_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

const EN_SECTION_MARKERS = [
  'Discussion Topic',
  'Action Items',
  '## Summary',
  '## Details',
  'Decisions',
];

const PT_SECTION_MARKERS = [
  'Tópico de discussão',
  'Próximos passos',
  'Itens de ação',
  '## Resumo',
  '## Detalhes',
  'Decisões',
];

const translationCache = new Map<string, string>();

let translationSession: { id: string; expiresAt: number } | null = null;

export interface MacParakeetConclusionTranslationContext {
  sessionToken: string;
}

interface ParakeetChatSseEvent {
  type?: string;
  delta?: string;
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
    };
  };
}

interface ParakeetTranslationSession {
  id: string;
}

function applyPortugueseSectionLabels(text: string): string {
  return text
    .replace(/^#{1,6}\s*Details\b/gim, '## Detalhes')
    .replace(/^#{1,6}\s*Summary\b/gim, '## Resumo')
    .replace(/Discussion Topic:/gi, 'Tópico de discussão:')
    .replace(/^#{1,6}\s*Decisions\b/gim, '## Decisões')
    .replace(/^#{1,6}\s*Action Items\b/gim, '## Próximos passos')
    .replace(/\*\*Decisions\*\*/gi, '**Decisões**')
    .replace(/\*\*Action Items\*\*/gi, '**Próximos passos**');
}

export function needsPortugueseConclusionTranslation(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  const englishMatches = normalized.match(/\b(the|and|team|discussed|reviewed|meeting|will|should|caller|requests|testing|requirements|obtain|verify|using)\b/gi)?.length ?? 0;
  const portugueseMatches =
    normalized.match(/\b(o|a|os|as|equipe|reunião|decidiu|discutiu|deve|será|para|com|chamador|solicita|testes|requisitos|obter|verificar|usando)\b/gi)?.length ?? 0;

  if (englishMatches > portugueseMatches + 1) {
    return true;
  }

  if (PT_SECTION_MARKERS.some((marker) => normalized.includes(marker))) {
    return false;
  }

  return EN_SECTION_MARKERS.some((marker) => normalized.includes(marker));
}

function extractTranslatedTextFromSse(raw: string): string {
  let translated = '';

  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) {
      continue;
    }

    const payload = line.slice(6).trim();
    if (!payload || payload === '[DONE]') {
      continue;
    }

    try {
      const event = JSON.parse(payload) as ParakeetChatSseEvent;
      if (event.type === 'text-delta' && typeof event.delta === 'string') {
        translated += event.delta;
      }
    } catch {
      // ignore malformed SSE chunks
    }
  }

  return translated.trim();
}

function normalizeParakeetTranslatedText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }

  const headerMatch = trimmed.match(/^(?:#{1,6}\s|\*\*|[•\-]\s)/m);
  if (!headerMatch || headerMatch.index === undefined) {
    return trimmed;
  }

  if (headerMatch.index === 0) {
    return trimmed;
  }

  return trimmed.slice(headerMatch.index).trimStart();
}

async function mutateParakeetTrpc<T>(
  procedure: string,
  payload: unknown,
  sessionToken: string,
): Promise<T | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${PARAKEET_AI_API_URL}/api/trpc/${procedure}?batch=1`, {
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

    if (!response.ok || entry?.error?.json?.message || !entry?.result?.data?.json) {
      return null;
    }

    return entry.result.data.json;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function createParakeetTranslationSession(
  sessionToken: string,
): Promise<string | null> {
  const created = await mutateParakeetTrpc<ParakeetTranslationSession>(
    'callSession.create',
    {
      free: false,
      sessionMode: 'regular_call',
      mode: 'regular_call',
      title: 'Nexus tradução',
      description: '',
      resumeId: null,
      documentSelectionMode: 'all',
      selectedDocumentIds: [],
      language: 'pt',
      extraContext: '',
      aiModel: 'gpt-5-mini',
      autoGenerate: false,
      saveTranscription: false,
      createdFrom: 'desktop-app',
      autoStarted: true,
      activationParameters: {
        platform: 'desktop-app',
        osVersion: release(),
        appVersion: '3.6.14',
      },
    },
    sessionToken,
  );

  return created?.id?.trim() || null;
}

async function ensureParakeetTranslationSession(sessionToken: string): Promise<string | null> {
  const nowMs = Date.now();

  if (translationSession && translationSession.expiresAt > nowMs) {
    return translationSession.id;
  }

  const createdId = await createParakeetTranslationSession(sessionToken);
  if (!createdId) {
    translationSession = null;
    return null;
  }

  translationSession = {
    id: createdId,
    expiresAt: nowMs + TRANSLATION_SESSION_TTL_MS,
  };

  return createdId;
}

async function fetchParakeetAiTranslation(
  text: string,
  context: MacParakeetConclusionTranslationContext,
): Promise<string | null> {
  const callSessionId = await ensureParakeetTranslationSession(context.sessionToken);
  if (!callSessionId) {
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TRANSLATION_TIMEOUT_MS);

  try {
    const response = await fetch(`${PARAKEET_AI_API_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Cookie: `__Secure-next-auth.session-token=${context.sessionToken}; next-auth.session-token=${context.sessionToken}`,
        'x-parakeet-request-source': 'desktop-chat',
      },
      body: JSON.stringify({
        callSessionId,
        pendingTranscriptEntries: [],
        trigger: {
          kind: 'direct-message',
          triggeredUsingShortcut: false,
          isMobile: false,
          parts: [
            {
              type: 'text',
              text: `Traduza integralmente o texto abaixo para português brasileiro. Responda apenas com o texto traduzido, sem comentários, mantendo a formatação markdown:\n\n${text}`,
            },
          ],
        },
        sessionInfo: { transcriptClearedAt: null },
        adminConfig: { debug: false },
      }),
      signal: controller.signal,
    });

    if (response.status === 409) {
      translationSession = null;
      const retrySessionId = await ensureParakeetTranslationSession(context.sessionToken);
      if (!retrySessionId) {
        return null;
      }

      const retryResponse = await fetch(`${PARAKEET_AI_API_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Cookie: `__Secure-next-auth.session-token=${context.sessionToken}; next-auth.session-token=${context.sessionToken}`,
          'x-parakeet-request-source': 'desktop-chat',
        },
        body: JSON.stringify({
          callSessionId: retrySessionId,
          pendingTranscriptEntries: [],
          trigger: {
            kind: 'direct-message',
            triggeredUsingShortcut: false,
            isMobile: false,
            parts: [
              {
                type: 'text',
                text: `Traduza integralmente o texto abaixo para português brasileiro. Responda apenas com o texto traduzido, sem comentários, mantendo a formatação markdown:\n\n${text}`,
              },
            ],
          },
          sessionInfo: { transcriptClearedAt: null },
          adminConfig: { debug: false },
        }),
        signal: controller.signal,
      });

      if (!retryResponse.ok) {
        return null;
      }

      const retryRaw = await retryResponse.text();
      const retryTranslated = normalizeParakeetTranslatedText(extractTranslatedTextFromSse(retryRaw));
      return retryTranslated || null;
    }

    if (!response.ok) {
      return null;
    }

    const raw = await response.text();
    const translated = normalizeParakeetTranslatedText(extractTranslatedTextFromSse(raw));

    return translated || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function translateMacParakeetConclusionToPortuguese(
  text: string,
  context?: MacParakeetConclusionTranslationContext,
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }

  const cached = translationCache.get(trimmed);
  if (cached) {
    return cached;
  }

  let result = trimmed;

  if (!needsPortugueseConclusionTranslation(trimmed)) {
    result = applyPortugueseSectionLabels(trimmed);
    translationCache.set(trimmed, result);
    return result;
  }

  if (context?.sessionToken) {
    try {
      const translated = await fetchParakeetAiTranslation(trimmed, context);
      if (translated) {
        result = applyPortugueseSectionLabels(translated);
        translationCache.set(trimmed, result);
        return result;
      }
    } catch {
      // fall through to localized headers
    }
  }

  result = applyPortugueseSectionLabels(trimmed);
  translationCache.set(trimmed, result);
  return result;
}
