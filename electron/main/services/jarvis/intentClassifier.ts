import { getDefaultOllamaModel, ollamaChat, ollamaChatText } from './ollamaClient';
import { jarvisVoice } from './jarvisVoicePhrases';

export type JarvisIntentMode = 'action' | 'question' | 'ping';

export interface JarvisIntent {
  mode: JarvisIntentMode;
  projectQuery: string | null;
  agentPrompt: string;
  ackPhrase: string;
  transcript: string;
}

function buildIntentSystem(projectNames: string[]): string {
  const projectsLine =
    projectNames.length > 0
      ? `Projetos disponíveis: ${projectNames.join(', ')}.`
      : 'Projetos disponíveis: (nenhum listado).';

  return `Você classifica comandos de voz para o IDE Nexus.
Responda SOMENTE JSON válido com este schema:
{"mode":"action"|"question"|"ping","projectQuery":string|null,"agentPrompt":string,"ackPhrase":string}

${projectsLine}

Regras:
- mode=ping quando o usuário só verifica se o assistente está ouvindo (ex: está me escutando?, me ouve?, oi).
- mode=action quando o usuário pede para fazer/alterar/criar/abrir algo no código.
- mode=question quando o usuário pergunta algo sobre o projeto/código.
- projectQuery é APENAS o nome curto do projeto da lista (ou o mais próximo dela). Nunca uma frase. null se não houver.
- Se o usuário citar um nome com erro de ditado (ex: fisqal), use o projeto mais parecido da lista (ex: Fiscal → "Fiscal" ou "fiscal").
- agentPrompt é o pedido limpo SEM a palavra Nexus e SEM referências ao projeto (sem "da fisqal", "no projeto X", "vá no projeto X").
- ackPhrase é curto, natural e humanizado em português. Exemplos: "Entendido.", "Beleza, deixa comigo.", "Certo.". Evite tom robótico.

Exemplos:
- "na nfse da fisqal o que é?" → {"mode":"question","projectQuery":"fiscal","agentPrompt":"O que é NFSe?","ackPhrase":"Beleza, deixa comigo."}
- "no projeto fiscal coloque o botão Documentação" → {"mode":"action","projectQuery":"fiscal","agentPrompt":"Coloque o botão Documentação","ackPhrase":"Entendido."}
- "você está me escutando?" → {"mode":"ping","projectQuery":null,"agentPrompt":"","ackPhrase":"Sim, estou te ouvindo."}`;
}

function stripCodeFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function normalizeWakeTranscript(transcript: string): string {
  return transcript
    .trim()
    .replace(/^[,\s.!?\[\]]+/, '')
    .replace(/\s+/g, ' ');
}

function normalizeToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
}

export function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));

  for (let i = 0; i < rows; i += 1) {
    matrix[i]![0] = i;
  }
  for (let j = 0; j < cols; j += 1) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        (matrix[i - 1]![j] ?? 0) + 1,
        (matrix[i]![j - 1] ?? 0) + 1,
        (matrix[i - 1]![j - 1] ?? 0) + cost,
      );
    }
  }

  return matrix[a.length]![b.length] ?? 99;
}

const COMMON_PROJECT_TYPOS: Record<string, string> = {
  fisqal: 'fiscal',
  fiscall: 'fiscal',
  fisical: 'fiscal',
  fical: 'fiscal',
};

export function correctProjectTypo(token: string): string {
  const normalized = normalizeToken(token);
  return COMMON_PROJECT_TYPOS[normalized] ?? token;
}

export function resolveClosestProjectName(
  query: string | null | undefined,
  projectNames: string[],
): string | null {
  if (!query?.trim() || projectNames.length === 0) {
    return query?.trim() || null;
  }

  const corrected = correctProjectTypo(query.trim());
  const needle = normalizeToken(corrected);
  if (!needle) {
    return null;
  }

  let bestName: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const name of projectNames) {
    const hay = normalizeToken(name);
    if (!hay) {
      continue;
    }

    if (hay === needle || hay.includes(needle) || needle.includes(hay)) {
      return name;
    }

    const distance = levenshtein(needle, hay);
    const threshold = Math.max(2, Math.min(3, Math.floor(hay.length / 3)));
    if (distance <= threshold && distance < bestScore) {
      bestScore = distance;
      bestName = name;
    }
  }

  return bestName ?? corrected;
}

export function isListeningCheck(transcript: string): boolean {
  const normalized = normalizeWakeTranscript(transcript)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  return (
    /escutand|ouvind|me ouve|ta me oi|esta me oi|esta ai|está aí|pode me ouvir|teste de voz|me escuta/.test(
      normalized,
    ) || /^(oi|ola|olá|hey|e ai|e aí)\b/.test(normalized)
  );
}

export function hasNexusWakeWord(transcript: string): boolean {
  const normalized = normalizeWakeTranscript(transcript)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (!normalized) {
    return false;
  }

  if (
    /(?:^|[\s,.:;!?])(nexus|necsus|nexos|nexo|nexis|negus|necosos|necocus|nesus|nexuz|nekus)\b/.test(
      normalized,
    )
  ) {
    return true;
  }

  if (/ne(?:x|cs|ques|co)?(?:\s*que)?\s*sus\b/.test(normalized)) {
    return true;
  }

  if (/ne\s+que\s+sus\b/.test(normalized)) {
    return true;
  }

  const tokens = normalized.split(/[\s,.:;!?]+/).filter(Boolean);
  for (const token of tokens.slice(0, 6)) {
    const cleaned = token.replace(/[^a-z]/g, '');
    if (!cleaned) {
      continue;
    }
    if (cleaned === 'nexus' || cleaned.startsWith('nexus') || cleaned.endsWith('nexus')) {
      return true;
    }
    if (levenshtein(cleaned, 'nexus') <= 2) {
      return true;
    }
  }

  const compact = normalized.replace(/\s+/g, '');
  return (
    compact.includes('nexus') ||
    compact.includes('necsus') ||
    compact.includes('nequesus') ||
    compact.includes('necosos') ||
    compact.startsWith('nexus') ||
    compact.startsWith('necsus') ||
    compact.startsWith('nequesus')
  );
}

export function stripWakeWord(transcript: string): string {
  return normalizeWakeTranscript(transcript)
    .replace(/^(nexus|necsus|nexos|nexo|nexis|negus|necosos|necocus|nesus)\b[,:\s-]*/i, '')
    .replace(/^ne(?:x|cs|ques|co)?(?:\s*que)?\s*sus\b[,:\s-]*/i, '')
    .replace(/^ne\s+que\s+sus\b[,:\s-]*/i, '')
    .trim();
}

function extractProjectMention(cleaned: string): { raw: string; matchText: string } | null {
  const patterns = [
    /(?:no|do|da|pro|para o|para a|vá no|va no|vai no|abra o|abre o)\s+projeto\s+([a-zA-Z0-9._-]+)/i,
    /projeto\s+([a-zA-Z0-9._-]+)/i,
    /\b(?:da|do|de)\s+([a-zA-Z0-9._-]{3,})\b/i,
    /\b(?:na|no)\s+([a-zA-Z0-9._-]{3,})\b/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    const raw = match?.[1]?.trim();
    if (!raw || !match?.[0]) {
      continue;
    }
    if (/^(nfse|nfe|nfs|api|app|web|ios|android|home|login)$/i.test(raw)) {
      continue;
    }
    return { raw, matchText: match[0] };
  }

  return null;
}

function isQuestionText(cleaned: string): boolean {
  return (
    /\b(o que[ée]?|oque|qual|como|por que|porque|explique|me diga|me explica|o que e)\b/i.test(
      cleaned,
    ) || cleaned.includes('?')
  );
}

function buildCleanQuestionPrompt(cleaned: string, projectMatchText: string | null): string {
  let prompt = cleaned;
  if (projectMatchText) {
    prompt = prompt.replace(projectMatchText, ' ');
  }
  prompt = prompt
    .replace(/\b(?:da|do|de|na|no|projeto)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[,.\s]+|[,.\s]+$/g, '')
    .trim();

  if (!prompt) {
    return cleaned;
  }

  const topicBefore = prompt.match(/^(.+?)\s+o\s+que\s+(?:[éee])?\s*\??$/i);
  if (topicBefore?.[1]) {
    const topic = topicBefore[1].replace(/[?.!,]+$/g, '').trim();
    if (topic && !/^(o|que|e|é)$/i.test(topic)) {
      return `O que é ${topic}?`;
    }
  }

  const oQueMatch = prompt.match(/\bo\s+que\s+(?:é|e)\s+(.+?)(?:\?|$)/i);
  if (oQueMatch?.[1]) {
    const topic = oQueMatch[1].replace(/[?.!,]+$/g, '').trim();
    if (topic && !/^(é|e)$/i.test(topic)) {
      return `O que é ${topic}?`;
    }
  }

  if (/^o que/i.test(prompt) && !/\?$/.test(prompt)) {
    return `${prompt}?`;
  }

  return prompt;
}

function fallbackIntent(transcript: string, projectNames: string[] = []): JarvisIntent {
  const cleaned = stripWakeWord(transcript);

  if (isListeningCheck(cleaned) || isListeningCheck(transcript)) {
    return {
      mode: 'ping',
      projectQuery: null,
      agentPrompt: '',
      ackPhrase: jarvisVoice.listeningOk(),
      transcript,
    };
  }

  const question = isQuestionText(cleaned);
  const mention = extractProjectMention(cleaned);
  const projectQuery = mention
    ? resolveClosestProjectName(mention.raw, projectNames) ?? correctProjectTypo(mention.raw)
    : null;
  const agentPrompt = buildCleanQuestionPrompt(cleaned, mention?.matchText ?? null);

  return {
    mode: question ? 'question' : 'action',
    projectQuery,
    agentPrompt: agentPrompt || cleaned,
    ackPhrase: jarvisVoice.ack(),
    transcript,
  };
}

export async function classifyJarvisIntent(
  transcript: string,
  model?: string,
  projectNames: string[] = [],
): Promise<JarvisIntent> {
  const cleaned = stripWakeWord(transcript);

  if (isListeningCheck(cleaned) || isListeningCheck(transcript)) {
    return {
      mode: 'ping',
      projectQuery: null,
      agentPrompt: '',
      ackPhrase: jarvisVoice.listeningOk(),
      transcript,
    };
  }

  try {
    const raw = await Promise.race([
      ollamaChat(
        [
          { role: 'system', content: buildIntentSystem(projectNames) },
          { role: 'user', content: cleaned || transcript },
        ],
        { model: model || getDefaultOllamaModel() },
      ),
      new Promise<string>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('Jarvis intent timeout'));
        }, 12_000);
        timer.unref?.();
      }),
    ]);
    const parsed = JSON.parse(stripCodeFences(raw)) as Partial<JarvisIntent>;
    const mode =
      parsed.mode === 'question' ? 'question' : parsed.mode === 'ping' ? 'ping' : 'action';
    const agentPrompt =
      typeof parsed.agentPrompt === 'string' && parsed.agentPrompt.trim()
        ? parsed.agentPrompt.trim()
        : cleaned;
    const projectQueryRaw =
      typeof parsed.projectQuery === 'string' && parsed.projectQuery.trim()
        ? parsed.projectQuery.trim()
        : null;
    const projectQueryCandidate =
      projectQueryRaw && projectQueryRaw.length <= 48 && !/\s{2,}/.test(projectQueryRaw)
        ? projectQueryRaw.split(/\s+/)[0] ?? null
        : null;
    const projectQuery = resolveClosestProjectName(projectQueryCandidate, projectNames);
    const ackPhraseRaw =
      typeof parsed.ackPhrase === 'string' && parsed.ackPhrase.trim()
        ? parsed.ackPhrase.trim()
        : '';
    const ackPhrase =
      ackPhraseRaw && ackPhraseRaw.length <= 60
        ? ackPhraseRaw
        : mode === 'ping'
          ? jarvisVoice.listeningOk()
          : jarvisVoice.ack();

    return {
      mode,
      projectQuery,
      agentPrompt,
      ackPhrase,
      transcript,
    };
  } catch {
    return fallbackIntent(transcript, projectNames);
  }
}

export async function summarizeForSpeech(
  answer: string,
  model?: string,
): Promise<string> {
  const trimmed = answer.trim();
  if (!trimmed) {
    return jarvisVoice.summaryEmpty();
  }

  try {
    const summary = await ollamaChatText(
      [
        {
          role: 'system',
          content:
            'Fale como um assistente humano e amigável em português do Brasil. Resuma em 1 a 3 frases curtas, naturais, fáceis de ouvir em voz alta. Sem markdown, sem listas, sem código, sem tom robótico.',
        },
        { role: 'user', content: trimmed.slice(0, 12_000) },
      ],
      { model: model || getDefaultOllamaModel(), temperature: 0.3 },
    );
    return summary.replace(/\s+/g, ' ').trim() || trimmed.slice(0, 400);
  } catch {
    return trimmed.replace(/\s+/g, ' ').slice(0, 400);
  }
}
