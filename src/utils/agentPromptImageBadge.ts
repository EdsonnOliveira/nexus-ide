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
  const mention = buildAgentPromptImageMention(imageNumber);

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
  const needsSpaceAfter = after.length > 0 && !/^[\s\n]/.test(after);
  const insertion = `${needsSpaceBefore ? ' ' : ''}${mention}${needsSpaceAfter ? ' ' : ''}`;

  return {
    nextDraft: `${before}${insertion}${after}`,
    nextCaret: selectionStart + insertion.length,
  };
}

export const AGENT_PROMPT_IMAGE_MENTION_REGEX = /\((?:imagem|img)\s+(\d+)\)/gi;

export type AgentPromptImageMentionSegment =
  | { kind: 'text'; value: string }
  | { kind: 'mention'; value: string; imageNumber: number };

export function splitAgentPromptImageMentions(text: string): AgentPromptImageMentionSegment[] {
  if (!text) {
    return [];
  }

  const segments: AgentPromptImageMentionSegment[] = [];
  const pattern = new RegExp(AGENT_PROMPT_IMAGE_MENTION_REGEX.source, AGENT_PROMPT_IMAGE_MENTION_REGEX.flags);
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const matchIndex = match.index ?? 0;

    if (matchIndex > lastIndex) {
      segments.push({
        kind: 'text',
        value: text.slice(lastIndex, matchIndex),
      });
    }

    const imageNumber = Number.parseInt(match[1] ?? '', 10);

    if (Number.isFinite(imageNumber) && imageNumber > 0) {
      segments.push({
        kind: 'mention',
        value: match[0],
        imageNumber,
      });
    } else {
      segments.push({
        kind: 'text',
        value: match[0],
      });
    }

    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({
      kind: 'text',
      value: text.slice(lastIndex),
    });
  }

  return segments;
}

export function hasAgentPromptImageMentions(text: string): boolean {
  AGENT_PROMPT_IMAGE_MENTION_REGEX.lastIndex = 0;
  return AGENT_PROMPT_IMAGE_MENTION_REGEX.test(text);
}
