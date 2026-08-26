import { stripAnsi } from '@/utils/stripAnsi';

const ACTIVITY_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bPlanning next moves\b/i, label: 'Planejando próximo passo...' },
  { pattern: /\bPlanning\b/i, label: 'Planejando...' },
  { pattern: /\bThinking\b/i, label: 'Pensando...' },
  { pattern: /\bGenerating\b/i, label: 'Gerando...' },
  { pattern: /\bReading\b/i, label: 'Lendo...' },
  { pattern: /\bGrepping\b/i, label: 'Buscando no código...' },
  { pattern: /\bSearching\b/i, label: 'Buscando...' },
  { pattern: /\bExecuting\b/i, label: 'Executando...' },
  { pattern: /\bWorking\b/i, label: 'Trabalhando...' },
  { pattern: /\bRunning\b/i, label: 'Executando...' },
  { pattern: /\bFetching\b/i, label: 'Carregando...' },
  { pattern: /\bEdited\b/i, label: 'Editando...' },
  { pattern: /\bWrote\b/i, label: 'Escrevendo...' },
  { pattern: /\bExplor(?:ed|ing)\b/i, label: 'Explorando...' },
];

export function resolveAgentActivityLabel(rawOutput: string): string | null {
  const plain = stripAnsi(rawOutput).replace(/\r/g, '');
  const tail = plain.slice(-768);

  for (const { pattern, label } of ACTIVITY_PATTERNS) {
    if (pattern.test(tail)) {
      return label;
    }
  }

  return null;
}

const GENERIC_LIVE_STATUS_LABELS: Record<string, string> = {
  'planning next moves': 'Planejando próximo passo...',
  'planning next moves...': 'Planejando próximo passo...',
  planning: 'Planejando...',
  thinking: 'Pensando...',
  working: 'Trabalhando...',
  generating: 'Gerando...',
};

export function formatAgentLiveStatusLabel(raw: string): string {
  const trimmed = raw.trim();

  if (!trimmed) {
    return 'Trabalhando...';
  }

  return GENERIC_LIVE_STATUS_LABELS[trimmed.toLowerCase()] ?? trimmed;
}

const LIVE_FILE_STATUS_PATTERN = /^(Editing|Reading|Writing)\s+(.+)$/i;

export function parseAgentLiveFileStatus(
  label: string,
): { verb: string; fileName: string } | null {
  const trimmed = label.trim();
  const match = trimmed.match(LIVE_FILE_STATUS_PATTERN);

  if (!match) {
    return null;
  }

  const fileName = match[2].trim().split(/[/\\]/).pop() ?? match[2].trim();

  return {
    verb: match[1],
    fileName,
  };
}
