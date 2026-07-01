import type { AgentActivity, AgentTurn, AgentUserMessage } from '@/types';
import { sanitizeResponseText } from '@/utils/agentTranscriptParser';
import { resolvePromptDisplayContent } from '@/utils/agentPromptAttachments';
import { computeAgentTurnSummaryFromActivities } from '@/utils/agentTurnSummary';

interface HistoryTranscriptContentPart {
  type?: string;
  text?: string;
  name?: string;
}

interface HistoryTranscriptLine {
  role?: string;
  message?: {
    content?: HistoryTranscriptContentPart[];
  };
}

const USER_QUERY_PATTERN = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/i;

function extractUserPrompt(text: string): string {
  const match = USER_QUERY_PATTERN.exec(text);

  if (match?.[1]) {
    return match[1].trim();
  }

  return text.trim();
}

function extractLineText(parts: HistoryTranscriptContentPart[]): string {
  return parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('')
    .trim();
}

function extractToolLabels(parts: HistoryTranscriptContentPart[]): string[] {
  return parts
    .filter((part) => part.type === 'tool_use' && part.name?.trim())
    .map((part) => part.name!.trim());
}

function createHistoryActivity(
  kind: AgentActivity['kind'],
  label: string,
  createdAt: number,
): AgentActivity {
  return {
    id: crypto.randomUUID(),
    kind,
    label,
    createdAt,
  };
}

function createHistoryUserMessage(content: string, createdAt: number): AgentUserMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content,
    createdAt,
  };
}

function buildCompletedTurn(
  userContent: string,
  responseTexts: string[],
  toolLabels: string[],
  startedAt: number,
): AgentTurn | null {
  const prompt = resolvePromptDisplayContent(extractUserPrompt(userContent));
  const hasImageReference = userContent.includes('.nexus/terminal-paste/');

  if (!prompt && !hasImageReference) {
    return null;
  }

  const activities: AgentActivity[] = [];
  const seenTools = new Set<string>();

  for (const label of toolLabels) {
    if (seenTools.has(label)) {
      continue;
    }

    seenTools.add(label);
    activities.push(createHistoryActivity('status', label, startedAt));
  }

  const response = sanitizeResponseText(responseTexts.join('\n\n').trim());

  if (response) {
    activities.push(createHistoryActivity('response', response, startedAt));
  }

  if (activities.length === 0) {
    return null;
  }

  return {
    id: crypto.randomUUID(),
    user: createHistoryUserMessage(prompt, startedAt),
    activities,
    running: false,
    startedAt,
    completedAt: startedAt + 1,
    summary: computeAgentTurnSummaryFromActivities(activities),
  };
}

export function parseCursorAgentHistoryTranscript(raw: string): AgentTurn[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const turns: AgentTurn[] = [];
  let currentUserPrompt = '';
  let responseTexts: string[] = [];
  let toolLabels: string[] = [];

  const flushTurn = () => {
    if (!currentUserPrompt) {
      responseTexts = [];
      toolLabels = [];
      return;
    }

    const startedAt = Date.now() - (turns.length + 1) * 1000;
    const turn = buildCompletedTurn(currentUserPrompt, responseTexts, toolLabels, startedAt);

    if (turn) {
      turns.push(turn);
    }

    currentUserPrompt = '';
    responseTexts = [];
    toolLabels = [];
  };

  for (const line of lines) {
    let parsed: HistoryTranscriptLine;

    try {
      parsed = JSON.parse(line) as HistoryTranscriptLine;
    } catch {
      continue;
    }

    const parts = parsed.message?.content ?? [];

    if (parsed.role === 'user') {
      flushTurn();
      currentUserPrompt = extractLineText(parts);
      continue;
    }

    if (parsed.role !== 'assistant' || !currentUserPrompt) {
      continue;
    }

    const text = extractLineText(parts);

    if (text) {
      responseTexts.push(text);
    }

    toolLabels.push(...extractToolLabels(parts));
  }

  flushTurn();

  return turns;
}
