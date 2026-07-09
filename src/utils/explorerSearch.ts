export interface ExplorerSearchOptions {
  matchCase: boolean;
  matchWholeWord: boolean;
  useRegex: boolean;
}

export interface ExplorerSearchLineMatch {
  lineNumber: number;
  preview: string;
  submatches: Array<{ start: number; end: number }>;
}

export interface ExplorerSearchNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: ExplorerSearchNode[];
  contentMatches?: ExplorerSearchLineMatch[];
}

export const DEFAULT_EXPLORER_SEARCH_OPTIONS: ExplorerSearchOptions = {
  matchCase: false,
  matchWholeWord: false,
  useRegex: false,
};

export interface SearchHighlightPart {
  text: string;
  highlight: boolean;
}

export function buildSearchHighlightParts(
  preview: string,
  submatches: Array<{ start: number; end: number }>,
): SearchHighlightPart[] {
  if (submatches.length === 0) {
    return [{ text: preview, highlight: false }];
  }

  const sortedMatches = [...submatches].sort((left, right) => left.start - right.start);
  const parts: SearchHighlightPart[] = [];
  let cursor = 0;

  sortedMatches.forEach((submatch) => {
    if (submatch.start > cursor) {
      parts.push({
        text: preview.slice(cursor, submatch.start),
        highlight: false,
      });
    }

    parts.push({
      text: preview.slice(submatch.start, submatch.end),
      highlight: true,
    });

    cursor = submatch.end;
  });

  if (cursor < preview.length) {
    parts.push({
      text: preview.slice(cursor),
      highlight: false,
    });
  }

  return parts;
}

export function buildQueryHighlightParts(text: string, query: string): SearchHighlightPart[] {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return [{ text, highlight: false }];
  }

  return buildSearchHighlightParts(text, findLineHighlightRanges(text, normalizedQuery, DEFAULT_EXPLORER_SEARCH_OPTIONS));
}

export function findLineHighlightRanges(
  line: string,
  query: string,
  options: ExplorerSearchOptions,
): Array<{ start: number; end: number }> {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return [];
  }

  const ranges: Array<{ start: number; end: number }> = [];

  if (options.useRegex) {
    try {
      const flags = options.matchCase ? 'g' : 'gi';
      const regex = new RegExp(trimmedQuery, flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(line)) !== null) {
        ranges.push({
          start: match.index,
          end: match.index + match[0].length,
        });

        if (match[0].length === 0) {
          regex.lastIndex += 1;
        }
      }
    } catch {
      return [];
    }

    return ranges;
  }

  if (options.matchWholeWord) {
    const pattern = options.matchCase
      ? new RegExp(`\\b${escapeRegExp(trimmedQuery)}\\b`, 'g')
      : new RegExp(`\\b${escapeRegExp(trimmedQuery)}\\b`, 'gi');
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(line)) !== null) {
      ranges.push({
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    return ranges;
  }

  if (options.matchCase) {
    let cursor = 0;

    while (cursor < line.length) {
      const index = line.indexOf(trimmedQuery, cursor);

      if (index === -1) {
        break;
      }

      ranges.push({
        start: index,
        end: index + trimmedQuery.length,
      });

      cursor = index + trimmedQuery.length;
    }

    return ranges;
  }

  const lowerLine = line.toLowerCase();
  const lowerQuery = trimmedQuery.toLowerCase();
  let cursor = 0;

  while (cursor < lowerLine.length) {
    const index = lowerLine.indexOf(lowerQuery, cursor);

    if (index === -1) {
      break;
    }

    ranges.push({
      start: index,
      end: index + trimmedQuery.length,
    });

    cursor = index + trimmedQuery.length;
  }

  return ranges;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
