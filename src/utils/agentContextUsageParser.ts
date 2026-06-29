import { cleanAgentPtyChunk } from '@/utils/stripAnsi';
import { normalizeAgentTranscriptRawLine } from '@/utils/agentCliSession';

export interface AgentContextUsageCategory {
  id: string;
  label: string;
  tokens: number;
  displayTokens: string;
}

export interface AgentContextUsageSnapshot {
  percent: number;
  totalTokensUsed: number;
  contextWindowSize: number;
  totalTokensLabel: string;
  contextWindowLabel: string;
  categories: AgentContextUsageCategory[];
  updatedAt: number;
}

const DEFAULT_CONTEXT_WINDOW = 200_000;

const MODE_PERCENT_RE =
  /(?:Auto|Agent|Plan|Debug|Ask|Multitask)\s*(?:·\s*)?(\d+(?:\.\d+)?)\s*%/gi;

const PERCENT_FULL_RE = /(\d+(?:\.\d+)?)\s*%\s*Full\b/i;

const TOKENS_SUMMARY_RE = /~?\s*([\d.]+)\s*([KkMm])?\s*\/\s*([\d.]+)\s*([KkMm])?\s*Tokens?/i;

const CATEGORY_LINE_RE =
  /^(System prompt|Tool definitions|Rules|Skills|MCP|Subagent definitions|Summarized conversation|Conversation|Other)\b.*?([\d.]+)\s*([KkMm])?(?:\s|$)/i;

const CATEGORY_ID_BY_LABEL: Record<string, string> = {
  'System prompt': 'system_prompt',
  'Tool definitions': 'tools',
  Rules: 'rules',
  Skills: 'skills',
  MCP: 'mcp',
  'Subagent definitions': 'subagents',
  'Summarized conversation': 'summarized_conversation',
  Conversation: 'conversation',
  Other: 'uncategorized',
};

export const AGENT_CONTEXT_CATEGORY_COLORS: Record<string, string> = {
  system_prompt: '#8b8b8b',
  tools: '#a78bfa',
  rules: '#4ade80',
  skills: '#facc15',
  mcp: '#f472b6',
  subagents: '#60a5fa',
  summarized_conversation: '#fb7185',
  conversation: '#fb923c',
  uncategorized: '#6b7280',
};

function parseTokenCount(rawValue: string, suffix?: string): number {
  const value = Number.parseFloat(rawValue);

  if (!Number.isFinite(value)) {
    return 0;
  }

  const unit = suffix?.toUpperCase();

  if (unit === 'M') {
    return Math.round(value * 1_000_000);
  }

  if (unit === 'K') {
    return Math.round(value * 1_000);
  }

  return Math.round(value);
}

export function formatAgentContextTokens(count: number, compact = true): string {
  const safe = Math.max(0, Math.round(count));

  if (safe >= 1_000_000) {
    const value = safe / 1_000_000;
    return compact ? `${value >= 10 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, '')}M` : `${safe.toLocaleString('en-US')}`;
  }

  if (safe >= 1_000) {
    const value = safe / 1_000;
    return compact ? `${value >= 100 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, '')}K` : `${safe.toLocaleString('en-US')}`;
  }

  return String(safe);
}

function splitTailLines(tail: string): string[] {
  return tail
    .split(/\r?\n/)
    .map((line) => normalizeAgentTranscriptRawLine(cleanAgentPtyChunk(line)))
    .filter(Boolean);
}

export function parseAgentContextPercentFromTail(tail: string): number | null {
  const cleaned = cleanAgentPtyChunk(tail);
  let match: RegExpExecArray | null = null;
  let lastPercent: number | null = null;

  MODE_PERCENT_RE.lastIndex = 0;

  while ((match = MODE_PERCENT_RE.exec(cleaned)) !== null) {
    const parsed = Number.parseFloat(match[1] ?? '');

    if (Number.isFinite(parsed)) {
      lastPercent = Math.max(0, Math.min(100, parsed));
    }
  }

  if (lastPercent !== null) {
    return lastPercent;
  }

  const fullMatch = PERCENT_FULL_RE.exec(cleaned);

  if (fullMatch) {
    const parsed = Number.parseFloat(fullMatch[1] ?? '');

    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(100, parsed));
    }
  }

  return null;
}

function buildSnapshotFromParts(
  percent: number,
  totalTokensUsed: number,
  contextWindowSize: number,
  categories: AgentContextUsageCategory[],
): AgentContextUsageSnapshot {
  return {
    percent,
    totalTokensUsed,
    contextWindowSize,
    totalTokensLabel: `~${formatAgentContextTokens(totalTokensUsed)}`,
    contextWindowLabel: formatAgentContextTokens(contextWindowSize),
    categories,
    updatedAt: Date.now(),
  };
}

function estimateSnapshotFromPercent(percent: number): AgentContextUsageSnapshot {
  const contextWindowSize = DEFAULT_CONTEXT_WINDOW;
  const totalTokensUsed = Math.round((percent / 100) * contextWindowSize);

  return buildSnapshotFromParts(percent, totalTokensUsed, contextWindowSize, []);
}

export function parseAgentContextUsageFromTail(tail: string): AgentContextUsageSnapshot | null {
  const percent = parseAgentContextPercentFromTail(tail);

  if (percent === null) {
    return null;
  }

  const cleaned = cleanAgentPtyChunk(tail);
  const lines = splitTailLines(tail);
  let totalTokensUsed = 0;
  let contextWindowSize = DEFAULT_CONTEXT_WINDOW;
  const categories: AgentContextUsageCategory[] = [];

  const summaryMatch = TOKENS_SUMMARY_RE.exec(cleaned);

  if (summaryMatch) {
    totalTokensUsed = parseTokenCount(summaryMatch[1] ?? '0', summaryMatch[2]);
    contextWindowSize = parseTokenCount(summaryMatch[3] ?? '0', summaryMatch[4]) || DEFAULT_CONTEXT_WINDOW;
  } else {
    totalTokensUsed = Math.round((percent / 100) * contextWindowSize);
  }

  for (const line of lines) {
    const match = CATEGORY_LINE_RE.exec(line);

    if (!match) {
      continue;
    }

    const label = match[1] ?? '';
    const id = CATEGORY_ID_BY_LABEL[label] ?? label.toLowerCase().replace(/\s+/g, '_');
    const tokens = parseTokenCount(match[2] ?? '0', match[3]);

    if (tokens <= 0) {
      continue;
    }

    categories.push({
      id,
      label,
      tokens,
      displayTokens: formatAgentContextTokens(tokens),
    });
  }

  const resolvedPercent =
    categories.length > 0 && contextWindowSize > 0
      ? Math.max(0, Math.min(100, Math.round((totalTokensUsed / contextWindowSize) * 1000) / 10))
      : percent;

  return buildSnapshotFromParts(resolvedPercent, totalTokensUsed, contextWindowSize, categories);
}

export function mergeAgentContextUsageSnapshots(
  current: AgentContextUsageSnapshot | null,
  incoming: AgentContextUsageSnapshot | null,
): AgentContextUsageSnapshot | null {
  if (!incoming) {
    return current;
  }

  if (!current) {
    return incoming;
  }

  const categories =
    incoming.categories.length > 0 ? incoming.categories : current.categories;
  const totalTokensUsed =
    incoming.categories.length > 0 ? incoming.totalTokensUsed : current.totalTokensUsed;
  const contextWindowSize =
    incoming.contextWindowSize > 0 ? incoming.contextWindowSize : current.contextWindowSize;

  return buildSnapshotFromParts(incoming.percent, totalTokensUsed, contextWindowSize, categories);
}

export function buildFallbackAgentContextUsage(percent: number): AgentContextUsageSnapshot {
  return estimateSnapshotFromPercent(percent);
}
