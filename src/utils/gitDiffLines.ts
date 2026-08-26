export type GitDiffLineKind = 'context' | 'add' | 'remove' | 'prompt';

export interface GitDiffLine {
  kind: GitDiffLineKind;
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

type DiffOpKind = 'equal' | 'add' | 'remove';

interface DiffOp {
  kind: DiffOpKind;
  line: string;
}

function splitTextLines(text: string): string[] {
  if (!text) {
    return [];
  }

  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  if (normalized.endsWith('\n')) {
    return lines;
  }

  return lines;
}

function computeDiffOps(beforeLines: string[], afterLines: string[]): DiffOp[] {
  const rowCount = beforeLines.length;
  const columnCount = afterLines.length;
  const table: number[][] = Array.from({ length: rowCount + 1 }, () =>
    Array<number>(columnCount + 1).fill(0),
  );

  for (let row = 1; row <= rowCount; row += 1) {
    for (let column = 1; column <= columnCount; column += 1) {
      if (beforeLines[row - 1] === afterLines[column - 1]) {
        table[row][column] = table[row - 1][column - 1] + 1;
        continue;
      }

      table[row][column] = Math.max(table[row - 1][column], table[row][column - 1]);
    }
  }

  const ops: DiffOp[] = [];
  let row = rowCount;
  let column = columnCount;

  while (row > 0 || column > 0) {
    if (row > 0 && column > 0 && beforeLines[row - 1] === afterLines[column - 1]) {
      ops.push({ kind: 'equal', line: beforeLines[row - 1] });
      row -= 1;
      column -= 1;
      continue;
    }

    if (column > 0 && (row === 0 || table[row][column - 1] >= table[row - 1][column])) {
      ops.push({ kind: 'add', line: afterLines[column - 1] });
      column -= 1;
      continue;
    }

    ops.push({ kind: 'remove', line: beforeLines[row - 1] });
    row -= 1;
  }

  ops.reverse();
  return ops;
}

export function buildGitDiffLines(before: string, after: string): GitDiffLine[] {
  const beforeLines = splitTextLines(before);
  const afterLines = splitTextLines(after);
  const ops = computeDiffOps(beforeLines, afterLines);
  const lines: GitDiffLine[] = [];
  let oldLineNumber = 1;
  let newLineNumber = 1;

  for (const op of ops) {
    if (op.kind === 'equal') {
      lines.push({
        kind: 'context',
        content: op.line,
        oldLineNumber,
        newLineNumber,
      });
      oldLineNumber += 1;
      newLineNumber += 1;
      continue;
    }

    if (op.kind === 'add') {
      lines.push({
        kind: 'add',
        content: op.line,
        oldLineNumber: null,
        newLineNumber,
      });
      newLineNumber += 1;
      continue;
    }

    lines.push({
      kind: 'remove',
      content: op.line,
      oldLineNumber,
      newLineNumber: null,
    });
    oldLineNumber += 1;
  }

  return lines;
}

export function gitDiffHasChanges(before: string, after: string): boolean {
  return buildGitDiffLines(before, after).some((line) => line.kind !== 'context');
}

export function getGitDiffChangeLineIndices(lines: GitDiffLine[]): number[] {
  const indices: number[] = [];

  lines.forEach((line, index) => {
    if (line.kind === 'add' || line.kind === 'remove') {
      indices.push(index);
    }
  });

  return indices;
}

export interface GitDiffChangeRegion {
  kind: 'add' | 'remove';
  startLineIndex: number;
  endLineIndex: number;
}

export function getGitDiffChangeRegions(lines: GitDiffLine[]): GitDiffChangeRegion[] {
  const regions: GitDiffChangeRegion[] = [];
  let current: GitDiffChangeRegion | null = null;

  lines.forEach((line, index) => {
    if (line.kind !== 'add' && line.kind !== 'remove') {
      if (current) {
        regions.push(current);
        current = null;
      }
      return;
    }

    if (current && current.kind === line.kind) {
      current.endLineIndex = index;
      return;
    }

    if (current) {
      regions.push(current);
    }

    current = {
      kind: line.kind,
      startLineIndex: index,
      endLineIndex: index,
    };
  });

  if (current) {
    regions.push(current);
  }

  return regions;
}

export type GitDiffPreviewLineKind = 'context' | 'add' | 'remove';

export interface GitDiffPreviewLine {
  kind: GitDiffPreviewLineKind;
  content: string;
  lineNumber: number;
}

export interface GitDiffPreviewHunk {
  lines: GitDiffPreviewLine[];
}

const PREVIEW_CONTEXT_LINES = 3;
const PREVIEW_MAX_HUNKS = 8;
const PREVIEW_MAX_LINES = 90;
const PREVIEW_MAX_HUNK_LINES = 40;
const PREVIEW_LCS_MAX_CHARS = 80_000;
const PREVIEW_LCS_MAX_CELLS = 1_500_000;
const UNIFIED_HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function toPreviewLine(line: GitDiffLine): GitDiffPreviewLine {
  const kind: GitDiffPreviewLineKind =
    line.kind === 'add' || line.kind === 'remove' ? line.kind : 'context';
  const lineNumber =
    kind === 'remove' ? (line.oldLineNumber ?? 0) : (line.newLineNumber ?? line.oldLineNumber ?? 0);

  return {
    kind,
    content: line.content,
    lineNumber,
  };
}

export function shouldSkipGitDiffPreviewLcs(before: string, after: string): boolean {
  if (before.length + after.length > PREVIEW_LCS_MAX_CHARS) {
    return true;
  }

  return splitTextLines(before).length * splitTextLines(after).length > PREVIEW_LCS_MAX_CELLS;
}

export function capGitDiffPreviewHunks(hunks: GitDiffPreviewHunk[]): GitDiffPreviewHunk[] {
  const limited: GitDiffPreviewHunk[] = [];
  let totalLines = 0;

  for (const hunk of hunks.slice(0, PREVIEW_MAX_HUNKS)) {
    if (totalLines >= PREVIEW_MAX_LINES) {
      break;
    }

    const remaining = PREVIEW_MAX_LINES - totalLines;
    const lines = hunk.lines.slice(0, Math.min(PREVIEW_MAX_HUNK_LINES, remaining));

    if (lines.length === 0) {
      continue;
    }

    limited.push({ lines });
    totalLines += lines.length;
  }

  return limited;
}

export function buildGitDiffPreviewHunks(lines: GitDiffLine[]): GitDiffPreviewHunk[] {
  const changeIndices = getGitDiffChangeLineIndices(lines);

  if (changeIndices.length === 0) {
    return [];
  }

  const ranges: Array<{ start: number; end: number }> = [];

  for (const index of changeIndices) {
    const start = Math.max(0, index - PREVIEW_CONTEXT_LINES);
    const end = Math.min(lines.length - 1, index + PREVIEW_CONTEXT_LINES);
    const last = ranges[ranges.length - 1];

    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
      continue;
    }

    ranges.push({ start, end });
  }

  return capGitDiffPreviewHunks(
    ranges.map((range) => ({
      lines: lines.slice(range.start, range.end + 1).map(toPreviewLine),
    })),
  );
}

export function buildSingleSidePreviewHunks(
  content: string,
  kind: 'add' | 'remove',
  maxLines = PREVIEW_MAX_HUNK_LINES,
): GitDiffPreviewHunk[] {
  const lines = splitTextLines(content).slice(0, maxLines);

  if (lines.length === 0) {
    return [];
  }

  return [
    {
      lines: lines.map((line, index) => ({
        kind,
        content: line,
        lineNumber: index + 1,
      })),
    },
  ];
}

export function isBinaryGitPatch(patch: string): boolean {
  return /Binary files .* differ/i.test(patch) || /^GIT binary patch/m.test(patch);
}

export function looksLikeBinaryText(content: string): boolean {
  return content.includes('\0');
}

export function parseGitUnifiedDiff(patch: string): GitDiffPreviewHunk[] {
  if (!patch.trim()) {
    return [];
  }

  const hunks: GitDiffPreviewHunk[] = [];
  let lines: GitDiffPreviewLine[] | null = null;
  let oldLine = 0;
  let newLine = 0;
  const rawLines = patch.replace(/\r\n/g, '\n').split('\n');

  for (const raw of rawLines) {
    if (raw.startsWith('@@')) {
      if (lines && lines.length > 0) {
        hunks.push({ lines });
      }

      lines = [];
      const match = raw.match(UNIFIED_HUNK_HEADER);
      oldLine = match ? Number(match[1]) : 0;
      newLine = match ? Number(match[2]) : 0;
      continue;
    }

    if (!lines) {
      continue;
    }

    if (
      raw.startsWith('diff ') ||
      raw.startsWith('index ') ||
      raw.startsWith('--- ') ||
      raw.startsWith('+++ ') ||
      raw.startsWith('new file') ||
      raw.startsWith('deleted file') ||
      raw.startsWith('similarity') ||
      raw.startsWith('rename ') ||
      raw.startsWith('old mode') ||
      raw.startsWith('new mode') ||
      raw.startsWith('\\')
    ) {
      continue;
    }

    const marker = raw.charAt(0);
    const content = marker === '+' || marker === '-' || marker === ' ' ? raw.slice(1) : raw;

    if (marker === '+') {
      lines.push({ kind: 'add', content, lineNumber: newLine });
      newLine += 1;
      continue;
    }

    if (marker === '-') {
      lines.push({ kind: 'remove', content, lineNumber: oldLine });
      oldLine += 1;
      continue;
    }

    lines.push({
      kind: 'context',
      content: marker === ' ' ? content : raw,
      lineNumber: newLine > 0 ? newLine : oldLine,
    });

    if (oldLine > 0) {
      oldLine += 1;
    }

    if (newLine > 0) {
      newLine += 1;
    }
  }

  if (lines && lines.length > 0) {
    hunks.push({ lines });
  }

  return capGitDiffPreviewHunks(hunks);
}
