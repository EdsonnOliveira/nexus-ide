import type { WebAgentSkillHint } from './useWebAgentSkills';

const SKILL_SLASH_LIMIT = 12;

export interface WebSkillSlashContext {
  query: string;
  startIndex: number;
  endIndex: number;
}

export interface WebSkillSlashMatch {
  id: string;
  label: string;
  insertText: string;
}

export function parseWebSkillSlashContext(
  value: string,
  caretIndex: number,
): WebSkillSlashContext | null {
  const safeCaret = Math.max(0, Math.min(caretIndex, value.length));
  const before = value.slice(0, safeCaret);
  const slashMatch = /(?:^|\s)\/([^\s/]*)$/.exec(before);

  if (!slashMatch) {
    return null;
  }

  const triggerIndex = before.lastIndexOf('/');
  if (triggerIndex < 0) {
    return null;
  }

  return {
    query: slashMatch[1] ?? '',
    startIndex: triggerIndex,
    endIndex: safeCaret,
  };
}

function normalizeSkillSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle) {
    return true;
  }

  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) {
      index += 1;
    }
    if (index === needle.length) {
      return true;
    }
  }
  return index === needle.length;
}

function scoreSkillHint(hint: WebAgentSkillHint, query: string): number {
  const label = hint.label.toLowerCase();
  const normalizedLabel = normalizeSkillSearchText(hint.label);
  const normalizedQuery = normalizeSkillSearchText(query);

  if (!query) {
    return 1;
  }

  if (label === query) {
    return 100;
  }
  if (label.startsWith(query)) {
    return 90;
  }
  if (label.includes(query)) {
    return 70;
  }
  if (normalizedLabel.startsWith(normalizedQuery)) {
    return 60;
  }
  if (normalizedLabel.includes(normalizedQuery)) {
    return 40;
  }
  if (isSubsequence(normalizedQuery, normalizedLabel)) {
    return 20;
  }
  return 0;
}

export function filterWebSkillSlashMatches(
  skills: WebAgentSkillHint[],
  query: string,
  limit = SKILL_SLASH_LIMIT,
): WebSkillSlashMatch[] {
  const normalized = query.trim().toLowerCase();

  return skills
    .map((hint) => ({ hint, score: scoreSkillHint(hint, normalized) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.hint.label.localeCompare(right.hint.label);
    })
    .slice(0, limit)
    .map((entry) => ({
      id: entry.hint.id,
      label: entry.hint.label,
      insertText: `/${entry.hint.label} `,
    }));
}

export function applyWebSkillSlashMention(
  value: string,
  startIndex: number,
  endIndex: number,
  insertText: string,
): { nextValue: string; nextCaret: number } {
  const nextValue = `${value.slice(0, startIndex)}${insertText}${value.slice(endIndex)}`;
  return {
    nextValue,
    nextCaret: startIndex + insertText.length,
  };
}
