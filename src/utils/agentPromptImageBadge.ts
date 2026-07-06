import { PROJECT_COLORS } from '@/types';

export function getAgentPromptImageBadgeColor(imageNumber: number): string {
  const safeNumber = Math.max(1, Math.floor(imageNumber));
  return PROJECT_COLORS[(safeNumber - 1) % PROJECT_COLORS.length];
}

export function buildAgentPromptImageMention(imageNumber: number): string {
  return `(img ${Math.max(1, Math.floor(imageNumber))})`;
}

export function buildAgentPromptImageMentionAppendFragment(
  currentDraft: string,
  imageNumber: number,
): string {
  const mention = `${buildAgentPromptImageMention(imageNumber)} `;

  if (!currentDraft.trim()) {
    return mention;
  }

  return /[\s\n]$/.test(currentDraft) ? mention : ` ${mention}`;
}

export function buildAgentPromptImageMentionInsertion(
  draft: string,
  selectionStart: number,
  selectionEnd: number,
  imageNumber: number,
): { nextDraft: string; nextCaret: number } {
  const mention = buildAgentPromptImageMention(imageNumber);
  const before = draft.slice(0, selectionStart);
  const after = draft.slice(selectionEnd);
  const needsSpaceBefore = before.length > 0 && !/[\s\n]$/.test(before);
  const needsSpaceAfter = !/^[\s\n]/.test(after);
  const insertion = `${needsSpaceBefore ? ' ' : ''}${mention}${needsSpaceAfter ? ' ' : ''}`;

  return {
    nextDraft: `${before}${insertion}${after}`,
    nextCaret: selectionStart + insertion.length,
  };
}

export const AGENT_PROMPT_IMAGE_MENTION_REGEX = /\((?:imagem|img)\s+(\d+)\)/gi;

export const AGENT_PROMPT_PATH_MENTION_REGEX =
  /(?<=^|\s)@[^\s@]+(?:\s+(?:\(\d+\)\.[^\s@]+|[^\s@]+\.[^\s@]+))?/g;

export type AgentPromptImageMentionSegment =
  | { kind: 'text'; value: string }
  | { kind: 'mention'; value: string; imageNumber: number }
  | { kind: 'path-mention'; value: string; path: string };

interface AgentPromptMentionMatch {
  index: number;
  length: number;
  segment: Exclude<AgentPromptImageMentionSegment, { kind: 'text' }>;
}

export function getAgentPromptPathMentionBadgeColor(path: string): string {
  let hash = 0;

  for (let index = 0; index < path.length; index += 1) {
    hash = (hash * 31 + path.charCodeAt(index)) >>> 0;
  }

  return PROJECT_COLORS[hash % PROJECT_COLORS.length];
}

function collectAgentPromptMentionMatches(text: string): AgentPromptMentionMatch[] {
  const matches: AgentPromptMentionMatch[] = [];
  const imagePattern = new RegExp(
    AGENT_PROMPT_IMAGE_MENTION_REGEX.source,
    AGENT_PROMPT_IMAGE_MENTION_REGEX.flags,
  );

  for (const match of text.matchAll(imagePattern)) {
    const matchIndex = match.index ?? 0;
    const imageNumber = Number.parseInt(match[1] ?? '', 10);

    if (!Number.isFinite(imageNumber) || imageNumber <= 0) {
      continue;
    }

    matches.push({
      index: matchIndex,
      length: match[0].length,
      segment: {
        kind: 'mention',
        value: match[0],
        imageNumber,
      },
    });
  }

  const pathPattern = new RegExp(
    AGENT_PROMPT_PATH_MENTION_REGEX.source,
    AGENT_PROMPT_PATH_MENTION_REGEX.flags,
  );

  for (const match of text.matchAll(pathPattern)) {
    const mentionValue = match[0];

    if (!mentionValue.startsWith('@')) {
      continue;
    }

    matches.push({
      index: match.index ?? 0,
      length: mentionValue.length,
      segment: {
        kind: 'path-mention',
        value: mentionValue,
        path: mentionValue.slice(1),
      },
    });
  }

  matches.sort((left, right) => left.index - right.index || right.length - left.length);

  const filtered: AgentPromptMentionMatch[] = [];
  let lastEnd = 0;

  for (const match of matches) {
    if (match.index < lastEnd) {
      continue;
    }

    filtered.push(match);
    lastEnd = match.index + match.length;
  }

  return filtered;
}

function isPromptMentionSegment(
  segment: AgentPromptImageMentionSegment,
): segment is Exclude<AgentPromptImageMentionSegment, { kind: 'text' }> {
  return segment.kind !== 'text';
}

function collapseMentionGapSegments(
  segments: AgentPromptImageMentionSegment[],
): AgentPromptImageMentionSegment[] {
  const collapsed: AgentPromptImageMentionSegment[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];

    if (segment.kind === 'text' && /^\s+$/.test(segment.value)) {
      const previous = collapsed[collapsed.length - 1];
      const next = segments[index + 1];

      if (
        previous &&
        isPromptMentionSegment(previous) &&
        next &&
        isPromptMentionSegment(next)
      ) {
        continue;
      }
    }

    collapsed.push(segment);
  }

  return collapsed;
}

export function splitAgentPromptImageMentions(
  text: string,
  options?: { collapseMentionGaps?: boolean },
): AgentPromptImageMentionSegment[] {
  if (!text) {
    return [];
  }

  const mentionMatches = collectAgentPromptMentionMatches(text);

  if (mentionMatches.length === 0) {
    return [{ kind: 'text', value: text }];
  }

  const segments: AgentPromptImageMentionSegment[] = [];
  let lastIndex = 0;

  for (const match of mentionMatches) {
    if (match.index > lastIndex) {
      segments.push({
        kind: 'text',
        value: text.slice(lastIndex, match.index),
      });
    }

    segments.push(match.segment);
    lastIndex = match.index + match.length;
  }

  if (lastIndex < text.length) {
    segments.push({
      kind: 'text',
      value: text.slice(lastIndex),
    });
  }

  const collapseMentionGaps = options?.collapseMentionGaps ?? true;

  return collapseMentionGaps ? collapseMentionGapSegments(segments) : segments;
}

export function hasAgentPromptImageMentions(text: string): boolean {
  AGENT_PROMPT_IMAGE_MENTION_REGEX.lastIndex = 0;

  if (AGENT_PROMPT_IMAGE_MENTION_REGEX.test(text)) {
    return true;
  }

  AGENT_PROMPT_PATH_MENTION_REGEX.lastIndex = 0;
  return AGENT_PROMPT_PATH_MENTION_REGEX.test(text);
}
