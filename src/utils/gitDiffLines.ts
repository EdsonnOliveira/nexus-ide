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
