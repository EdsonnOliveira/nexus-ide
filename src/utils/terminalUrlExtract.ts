import { isLocalDevUrl } from '@/utils/browserSiteStatus';
import { normalizeBrowserUrl } from '@/utils/browserUrl';

export const TERMINAL_URL_HINT_LABEL_REFERENCE = 'http://localhost:3000';

export const TERMINAL_URL_HINT_MAX_COUNT = 1;

export const TERMINAL_URL_REGEX =
  /https?:\/\/[^\s<>"'\x1b[\]()]+|localhost(?::\d+)?(?:\/[^\s<>"'\x1b[\]()]*)?|127\.0\.0\.1(?::\d+)?(?:\/[^\s<>"'\x1b[\]()]*)?/gi;

export const TERMINAL_URL_CONTINUE_REGEX = /^[a-zA-Z0-9_\-.%=&?#/:]+/;

export type TerminalLineTextReader = (row: number) => string | null;

export function stripTerminalControlChars(value: string): string {
  return value.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1e[^\x1e]*\x1e/g, '');
}

export function stripTrailingUrlChars(value: string): string {
  return value.replace(/[.,;:!?)>\]}"']+$/g, '');
}

export function joinWrappedTerminalUrlLines(text: string): string {
  return stripTerminalControlChars(text).replace(/\n(?=[a-zA-Z0-9_%.=&?#/:-])/g, '');
}

function findLastUrlMatch(text: string): RegExpExecArray | null {
  const regex = new RegExp(TERMINAL_URL_REGEX.source, TERMINAL_URL_REGEX.flags);
  let lastMatch: RegExpExecArray | null = null;
  let match = regex.exec(text);

  while (match) {
    lastMatch = match;
    match = regex.exec(text);
  }

  return lastMatch;
}

export function lineEndsWithUrlContinuation(
  getLineText: TerminalLineTextReader,
  row: number,
): boolean {
  const text = getLineText(row);

  if (!text) {
    return false;
  }

  const lastMatch = findLastUrlMatch(text);

  if (!lastMatch) {
    return false;
  }

  const end = (lastMatch.index ?? 0) + lastMatch[0].length;

  return text.slice(end).trim() === '';
}

export function isTerminalUrlContinuationLine(
  getLineText: TerminalLineTextReader,
  row: number,
): boolean {
  if (row <= 0) {
    return false;
  }

  const text = getLineText(row) ?? '';

  if (!text.trim()) {
    return false;
  }

  if (/https?:\/\//i.test(text)) {
    return false;
  }

  if (!lineEndsWithUrlContinuation(getLineText, row - 1)) {
    return false;
  }

  const continuation = text.trimStart().match(TERMINAL_URL_CONTINUE_REGEX)?.[0] ?? '';

  return continuation.length > 0;
}

export function extendTerminalUrlAcrossLines(
  getLineText: TerminalLineTextReader,
  startRow: number,
  startCol: number,
  seed: string,
): { url: string; endRow: number; endCol: number } {
  let url = seed;
  let row = startRow;
  let endCol = startCol + seed.length;

  while (true) {
    const lineText = getLineText(row);

    if (!lineText) {
      break;
    }

    if (endCol < lineText.length && lineText.slice(endCol).trim() !== '') {
      break;
    }

    const nextRow = row + 1;
    const nextText = getLineText(nextRow);

    if (!nextText) {
      break;
    }

    const leadingSpaces = nextText.length - nextText.trimStart().length;
    const trimmedNext = nextText.trimStart();

    if (/^https?:\/\//i.test(trimmedNext)) {
      break;
    }

    const continuation = trimmedNext.match(TERMINAL_URL_CONTINUE_REGEX)?.[0];

    if (!continuation) {
      break;
    }

    url += continuation;
    row = nextRow;
    endCol = leadingSpaces + continuation.length;

    const remainder = nextText.slice(endCol);

    if (remainder.trim().length > 0) {
      break;
    }
  }

  return { url: stripTrailingUrlChars(url), endRow: row, endCol };
}

export function isPositionInsideTerminalUrlRange(
  row: number,
  col: number,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): boolean {
  if (row < startRow || row > endRow) {
    return false;
  }

  if (row === startRow && col < startCol) {
    return false;
  }

  if (row === endRow && col >= endCol) {
    return false;
  }

  return true;
}

function sortTerminalUrlHints(urls: string[]): string[] {
  return [...urls].sort((left, right) => {
    const leftLocal = isLocalDevUrl(left) ? 0 : 1;
    const rightLocal = isLocalDevUrl(right) ? 0 : 1;

    if (leftLocal !== rightLocal) {
      return leftLocal - rightLocal;
    }

    return left.localeCompare(right);
  });
}

export function extractTerminalUrls(text: string): string[] {
  const clean = joinWrappedTerminalUrlLines(text);
  const regex = new RegExp(TERMINAL_URL_REGEX.source, TERMINAL_URL_REGEX.flags);
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const match of clean.matchAll(regex)) {
    const raw = stripTrailingUrlChars(match[0]);
    const normalized = normalizeBrowserUrl(raw);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    urls.push(normalized);
  }

  return sortTerminalUrlHints(urls);
}

export function resolveTerminalUrlHints(urls: string[], limit = TERMINAL_URL_HINT_MAX_COUNT): string[] {
  return sortTerminalUrlHints(urls).slice(0, limit);
}

export function formatTerminalUrlLabel(url: string): string {
  return url;
}
