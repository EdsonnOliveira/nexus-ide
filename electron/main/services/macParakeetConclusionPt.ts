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

const TRANSLATION_CHUNK_MAX = 450;
const TRANSLATION_CHUNK_DELAY_MS = 120;
const translationCache = new Map<string, string>();

interface MyMemoryResponse {
  responseData?: {
    translatedText?: string;
  };
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

  if (PT_SECTION_MARKERS.some((marker) => normalized.includes(marker))) {
    return false;
  }

  if (EN_SECTION_MARKERS.some((marker) => normalized.includes(marker))) {
    return true;
  }

  const englishMatches = normalized.match(/\b(the|and|team|discussed|reviewed|meeting|will|should)\b/gi)?.length ?? 0;
  const portugueseMatches =
    normalized.match(/\b(o|a|os|as|equipe|reunião|decidiu|discutiu|deve|será|para|com)\b/gi)?.length ?? 0;

  return englishMatches > portugueseMatches + 1;
}

function splitForTranslation(text: string): string[] {
  if (text.length <= TRANSLATION_CHUNK_MAX) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > TRANSLATION_CHUNK_MAX) {
    let splitAt = remaining.lastIndexOf('\n\n', TRANSLATION_CHUNK_MAX);

    if (splitAt < TRANSLATION_CHUNK_MAX * 0.4) {
      splitAt = remaining.lastIndexOf('\n', TRANSLATION_CHUNK_MAX);
    }

    if (splitAt < TRANSLATION_CHUNK_MAX * 0.4) {
      splitAt = remaining.lastIndexOf(' ', TRANSLATION_CHUNK_MAX);
    }

    if (splitAt <= 0) {
      splitAt = TRANSLATION_CHUNK_MAX;
    }

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks.filter(Boolean);
}

async function fetchMyMemoryTranslation(text: string): Promise<string | null> {
  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', text);
  url.searchParams.set('langpair', 'en|pt-BR');

  const response = await fetch(url.toString());
  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as MyMemoryResponse;
  const translated = body.responseData?.translatedText?.trim();

  if (!translated || translated.toUpperCase().includes('QUERY LENGTH LIMIT')) {
    return null;
  }

  return translated;
}

async function translateChunks(chunks: string[]): Promise<string | null> {
  const translated: string[] = [];

  for (const chunk of chunks) {
    const nextChunk = await fetchMyMemoryTranslation(chunk);
    if (!nextChunk) {
      return null;
    }

    translated.push(nextChunk);

    if (chunks.length > 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, TRANSLATION_CHUNK_DELAY_MS);
      });
    }
  }

  return translated.join('\n\n');
}

export async function translateMacParakeetConclusionToPortuguese(text: string): Promise<string> {
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

  try {
    const translated = await translateChunks(splitForTranslation(trimmed));
    if (translated) {
      result = applyPortugueseSectionLabels(translated);
      translationCache.set(trimmed, result);
      return result;
    }
  } catch {
    // fall through to localized headers
  }

  result = applyPortugueseSectionLabels(trimmed);
  translationCache.set(trimmed, result);
  return result;
}
