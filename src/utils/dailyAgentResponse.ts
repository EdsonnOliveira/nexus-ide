import { splitAgentResponseForSummary } from '@/utils/agentTurnSummary';
import { normalizeMarkdownSource } from '@/utils/markdownPreview';
import { sanitizeResponseText } from '@/utils/agentTranscriptParser';
import type { AgentActivity } from '@/types';
import type { AgentStreamJsonParserState } from '@/utils/agentStreamJsonParser';

function findFinalMarkdownStart(content: string): number {
  const headingMatch = content.match(/(?:^|\n)(#{1,6}\s)/);

  if (headingMatch?.index !== undefined) {
    return headingMatch.index + (content[headingMatch.index] === '\n' ? 1 : 0);
  }

  const boldMatch = content.match(/(?:^|\n)(\*\*[^*\n]+\*\*)/);

  if (boldMatch?.index !== undefined) {
    return boldMatch.index + (content[boldMatch.index] === '\n' ? 1 : 0);
  }

  return -1;
}

export function extractDailyAgentFinalResponse(
  content: string,
  responseLead?: string | null,
): string {
  const trimmed = content.trim();

  if (!trimmed) {
    return '';
  }

  const split = splitAgentResponseForSummary(trimmed, responseLead ?? undefined);

  if (split?.rest.trim()) {
    return split.rest.trim();
  }

  const markdownStart = findFinalMarkdownStart(trimmed);

  if (markdownStart > 0) {
    return trimmed.slice(markdownStart).trim();
  }

  return trimmed;
}

export function resolveDailyAgentFinalResponse(
  parserState: AgentStreamJsonParserState,
): string {
  const responseTexts = parserState.activities
    .filter((activity) => activity.kind === 'response')
    .map((activity) =>
      sanitizeResponseText(normalizeMarkdownSource(activity.label)).trim(),
    )
    .filter(Boolean);

  const rawContent =
    responseTexts[responseTexts.length - 1] ?? parserState.pendingResponseText.trim();

  if (!rawContent) {
    return '';
  }

  return extractDailyAgentFinalResponse(rawContent, parserState.responseLead);
}

export function extractDailyAgentFinalResponseFromActivities(
  activities: AgentActivity[],
  pendingResponseText = '',
  responseLead?: string | null,
): string {
  const responseTexts = activities
    .filter((activity) => activity.kind === 'response')
    .map((activity) =>
      sanitizeResponseText(normalizeMarkdownSource(activity.label)).trim(),
    )
    .filter(Boolean);

  const rawContent = responseTexts[responseTexts.length - 1] ?? pendingResponseText.trim();

  if (!rawContent) {
    return '';
  }

  return extractDailyAgentFinalResponse(rawContent, responseLead);
}
