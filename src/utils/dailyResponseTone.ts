export type DailyResponseTone = 'non-technical' | 'technical';

export const DAILY_RESPONSE_TONES: DailyResponseTone[] = ['non-technical', 'technical'];

export const DAILY_RESPONSE_TONE_LABELS: Record<DailyResponseTone, string> = {
  'non-technical': 'Não técnico',
  technical: 'Técnico',
};

export const DAILY_RESPONSE_TONE_HINTS: Record<DailyResponseTone, string> = {
  'non-technical': 'Linguagem simples, sem código nem caminhos de arquivo.',
  technical: 'Inclui código, arquivos e detalhes técnicos.',
};

export function buildDailyResponseTonePromptLine(tone: DailyResponseTone): string {
  if (tone === 'non-technical') {
    return 'Response style: Non-technical. Write for a general audience in plain language. Do not include code blocks, file paths, diffs, or technical implementation details.';
  }

  return 'Response style: Technical. Include relevant code snippets, file names, paths, diffs, and detailed technical changes where applicable.';
}
