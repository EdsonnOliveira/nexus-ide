import { stripAnsi } from '@/utils/stripAnsi';

const ACTIVITY_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
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
