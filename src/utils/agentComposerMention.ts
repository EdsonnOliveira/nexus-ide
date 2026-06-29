import type { ProjectDirectoryEntry, ProjectKind, TerminalCommandHint } from '@/types';
import {
  DEFAULT_EXPLORER_SEARCH_OPTIONS,
  type ExplorerSearchNode,
} from '@/utils/explorerSearch';
import { toProjectRelativePath } from '@/utils/explorerRelativePath';

export type ComposerMentionTrigger = '@' | '/';

export interface ComposerMentionMatch {
  id: string;
  kind: 'file' | 'directory' | 'skill';
  name: string;
  absolutePath?: string;
  label: string;
  subtitle: string;
  insertText: string;
  isProjectFolder?: boolean;
  projectKind?: ProjectKind | null;
}

export interface ComposerMentionContext {
  query: string;
  startIndex: number;
  endIndex: number;
  trigger: ComposerMentionTrigger;
}

const MENTION_SEARCH_LIMIT = 12;
const MENTION_ROOT_LIMIT = 8;
const SKILL_SLASH_LIMIT = 12;

export function parseComposerMentionContext(
  value: string,
  caretIndex: number,
): ComposerMentionContext | null {
  const safeCaret = Math.max(0, Math.min(caretIndex, value.length));
  const before = value.slice(0, safeCaret);
  const atMatch = /(?:^|\s)@([^\s@]*)$/.exec(before);
  const slashMatch = /(?:^|\s)\/([^\s/]*)$/.exec(before);

  let trigger: ComposerMentionTrigger | null = null;
  let query = '';
  let triggerIndex = -1;

  if (atMatch && slashMatch) {
    const atIndex = before.lastIndexOf('@');
    const slashIndex = before.lastIndexOf('/');

    if (slashIndex > atIndex) {
      trigger = '/';
      query = slashMatch[1] ?? '';
      triggerIndex = slashIndex;
    } else {
      trigger = '@';
      query = atMatch[1] ?? '';
      triggerIndex = atIndex;
    }
  } else if (slashMatch) {
    trigger = '/';
    query = slashMatch[1] ?? '';
    triggerIndex = before.lastIndexOf('/');
  } else if (atMatch) {
    trigger = '@';
    query = atMatch[1] ?? '';
    triggerIndex = before.lastIndexOf('@');
  }

  if (!trigger || triggerIndex < 0) {
    return null;
  }

  return {
    query,
    startIndex: triggerIndex,
    endIndex: safeCaret,
    trigger,
  };
}

export function applyComposerMention(
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

function flattenMentionSearchNodes(nodes: ExplorerSearchNode[], limit: number): ExplorerSearchNode[] {
  const results: ExplorerSearchNode[] = [];

  const walk = (entries: ExplorerSearchNode[]) => {
    for (const entry of entries) {
      if (results.length >= limit) {
        return;
      }

      results.push(entry);

      if (entry.children) {
        walk(entry.children);
      }
    }
  };

  walk(nodes);
  return results;
}

function toPathMentionMatch(projectPath: string, entry: ProjectDirectoryEntry): ComposerMentionMatch {
  const relativePath = toProjectRelativePath(projectPath, entry.path);

  return {
    id: `${entry.type}:${entry.path}`,
    kind: entry.type,
    name: entry.name,
    absolutePath: entry.path,
    label: relativePath,
    subtitle: entry.type === 'directory' ? 'Pasta' : 'Arquivo',
    insertText: `@${relativePath} `,
    isProjectFolder: false,
    projectKind: null,
  };
}

async function enrichDirectoryMentionMatches(matches: ComposerMentionMatch[]): Promise<ComposerMentionMatch[]> {
  const directoryPaths = matches
    .filter((match) => match.kind === 'directory' && match.absolutePath)
    .map((match) => match.absolutePath!);

  if (directoryPaths.length === 0) {
    return matches;
  }

  let kinds: Record<string, ProjectKind | null> = {};

  try {
    kinds = await window.nexus.files.detectProjectKinds(directoryPaths);
  } catch {
    kinds = {};
  }

  return matches.map((match) => {
    if (match.kind !== 'directory' || !match.absolutePath) {
      return match;
    }

    const projectKind = kinds[match.absolutePath] ?? null;

    return {
      ...match,
      isProjectFolder: projectKind !== null,
      projectKind,
    };
  });
}

function toSkillMentionMatch(hint: TerminalCommandHint): ComposerMentionMatch {
  const label = hint.label.trim();

  return {
    id: hint.id,
    kind: 'skill',
    name: label,
    label,
    subtitle: 'Skill',
    insertText: `/${label} `,
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

function getSkillSearchCandidates(hint: TerminalCommandHint): string[] {
  const label = hint.label.trim().toLowerCase();
  const idSlug = hint.id.replace(/^skill-/i, '').toLowerCase();
  const segments = label.split(/[\s\-_/]+/).filter(Boolean);

  return [
    label,
    idSlug,
    normalizeSkillSearchText(label),
    normalizeSkillSearchText(idSlug),
    ...segments,
    ...segments.map((segment) => normalizeSkillSearchText(segment)),
  ];
}

function scoreSkillHint(hint: TerminalCommandHint, query: string): number {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return 1;
  }

  const compactQuery = normalizeSkillSearchText(normalizedQuery);
  const candidates = getSkillSearchCandidates(hint);
  let bestScore = 0;

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (candidate === normalizedQuery || candidate === compactQuery) {
      bestScore = Math.max(bestScore, 100);
      continue;
    }

    if (candidate.startsWith(normalizedQuery) || candidate.startsWith(compactQuery)) {
      bestScore = Math.max(bestScore, 80);
      continue;
    }

    if (candidate.includes(normalizedQuery) || candidate.includes(compactQuery)) {
      bestScore = Math.max(bestScore, 60);
      continue;
    }

    if (isSubsequence(compactQuery, candidate)) {
      bestScore = Math.max(bestScore, 45);
    }
  }

  return bestScore;
}

function filterSkillHints(
  hints: TerminalCommandHint[],
  query: string,
  limit = SKILL_SLASH_LIMIT,
): TerminalCommandHint[] {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return hints.slice(0, limit);
  }

  return hints
    .map((hint) => ({ hint, score: scoreSkillHint(hint, normalized) }))
    .filter((entry) => entry.hint.hintKind === 'skill' && entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.hint.label.localeCompare(right.hint.label);
    })
    .slice(0, limit)
    .map((entry) => entry.hint);
}

async function searchComposerPathMentionMatches(
  projectPath: string,
  query: string,
): Promise<ComposerMentionMatch[]> {
  const trimmedQuery = query.trim();
  let pathMatches: ComposerMentionMatch[] = [];

  if (!trimmedQuery) {
    const entries = await window.nexus.files.listDirectoryEntries(projectPath);
    pathMatches = entries
      .slice(0, MENTION_ROOT_LIMIT)
      .map((entry) => toPathMentionMatch(projectPath, entry));
  } else {
    const nodes = await window.nexus.files.searchProjectTree(
      projectPath,
      trimmedQuery,
      DEFAULT_EXPLORER_SEARCH_OPTIONS,
    );
    const flattened = flattenMentionSearchNodes(nodes as ExplorerSearchNode[], MENTION_SEARCH_LIMIT);
    pathMatches = flattened.map((entry) =>
      toPathMentionMatch(projectPath, {
        name: entry.name,
        path: entry.path,
        type: entry.type,
      }),
    );
  }

  return enrichDirectoryMentionMatches(pathMatches);
}

export async function searchComposerMentionMatches(
  projectPath: string,
  query: string,
  skillHints: TerminalCommandHint[],
  trigger: ComposerMentionTrigger = '@',
): Promise<ComposerMentionMatch[]> {
  if (trigger === '/') {
    return filterSkillHints(skillHints, query).map(toSkillMentionMatch);
  }

  return await searchComposerPathMentionMatches(projectPath, query);
}
