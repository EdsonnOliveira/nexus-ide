import type { IDecoration, IMarker, Terminal } from '@xterm/xterm';
import {
  findCommandBlockAtRow,
  isTerminalDividerLine,
} from '@/utils/terminalCommandBlocks';
import {
  outputIndexToLine,
  type TerminalCommandStatusEvent,
} from '@/utils/terminalCommandStatus';

export interface TerminalCommandDecorationController {
  handleEvents: (
    terminal: Terminal,
    cleanedOutput: string,
    baseLine: number,
    events: TerminalCommandStatusEvent[],
  ) => void;
  dispose: () => void;
}

function readBufferLine(terminal: Terminal, row: number): string {
  return terminal.buffer.active.getLine(row)?.translateToString(true).replace(/\s+$/, '') ?? '';
}

function resolveBlockStartLine(terminal: Terminal, markedLine: number): number {
  let start = Math.max(0, markedLine);

  for (let step = 0; step < 4; step += 1) {
    const previous = start - 1;

    if (previous < 0) {
      break;
    }

    const text = readBufferLine(terminal, previous).trim();

    if (!text || isTerminalDividerLine(text)) {
      break;
    }

    start = previous;
  }

  return start;
}

function isSkippableDecorationLine(terminal: Terminal, row: number): boolean {
  const text = readBufferLine(terminal, row).trim();
  return !text || isTerminalDividerLine(text);
}

function trimDecorationRange(
  terminal: Terminal,
  startLine: number,
  endLine: number,
): { start: number; end: number } | null {
  const buffer = terminal.buffer.active;
  const cursorAbsolute = buffer.baseY + buffer.cursorY;
  let from = Math.max(0, Math.min(startLine, endLine));
  let to = Math.min(Math.max(startLine, endLine), Math.max(0, cursorAbsolute - 1));

  while (from <= to && isSkippableDecorationLine(terminal, from)) {
    from += 1;
  }

  while (to >= from && isSkippableDecorationLine(terminal, to)) {
    to -= 1;
  }

  if (from > to) {
    return null;
  }

  return { start: from, end: to };
}

function extendRangeToLastContentBeforeDivider(
  terminal: Terminal,
  start: number,
  end: number,
): { start: number; end: number } {
  const buffer = terminal.buffer.active;
  let lastContent = end;

  for (let row = start; row < buffer.length; row += 1) {
    if (isTerminalDividerLine(readBufferLine(terminal, row))) {
      break;
    }

    if (readBufferLine(terminal, row).trim()) {
      lastContent = row;
    }
  }

  return { start, end: Math.max(end, lastContent) };
}

function findFailedCommandRange(
  terminal: Terminal,
  commandStartLine: number | null,
  fallbackEnd: number,
): { start: number; end: number } | null {
  if (commandStartLine !== null && commandStartLine >= 0) {
    return extendRangeToLastContentBeforeDivider(
      terminal,
      commandStartLine,
      Math.max(commandStartLine, fallbackEnd),
    );
  }

  const buffer = terminal.buffer.active;
  const cursorLine = buffer.baseY + buffer.cursorY;
  const searchFrom = Math.min(buffer.length - 1, Math.max(cursorLine, fallbackEnd));

  for (let row = searchFrom; row >= 0; row -= 1) {
    if (!isTerminalDividerLine(readBufferLine(terminal, row))) {
      continue;
    }

    if (row <= 0) {
      break;
    }

    const block = findCommandBlockAtRow(terminal, row - 1);

    if (!block) {
      continue;
    }

    if (block.endRow < cursorLine - 8) {
      break;
    }

    return extendRangeToLastContentBeforeDivider(
      terminal,
      block.startRow,
      block.endRow,
    );
  }

  const nearEnd = Math.max(0, fallbackEnd - 1);
  const block = findCommandBlockAtRow(terminal, nearEnd);

  if (block && block.endRow >= cursorLine - 8) {
    return extendRangeToLastContentBeforeDivider(
      terminal,
      block.startRow,
      block.endRow,
    );
  }

  const start = resolveBlockStartLine(terminal, fallbackEnd);
  return extendRangeToLastContentBeforeDivider(
    terminal,
    start,
    Math.max(start, fallbackEnd),
  );
}

function disposeDecorations(decorations: IDecoration[]): void {
  for (const decoration of decorations) {
    try {
      decoration.dispose();
    } catch {
      // ignore disposed decoration
    }
  }
}

function disposeMarker(marker: IMarker | null): void {
  if (!marker || marker.isDisposed) {
    return;
  }

  try {
    marker.dispose();
  } catch {
    // ignore disposed marker
  }
}

const MAX_ERROR_DECORATION_BATCHES = 40;

export function createTerminalCommandDecorationController(): TerminalCommandDecorationController {
  let pendingStartMarker: IMarker | null = null;
  let activeDecorations: IDecoration[] = [];
  let decorationBatches: IDecoration[][] = [];

  const pruneDecorationBatches = () => {
    while (decorationBatches.length > MAX_ERROR_DECORATION_BATCHES) {
      const oldest = decorationBatches.shift();

      if (!oldest) {
        break;
      }

      disposeDecorations(oldest);
      const drop = new Set(oldest);
      activeDecorations = activeDecorations.filter((decoration) => !drop.has(decoration));
    }
  };

  const decorateRange = (terminal: Terminal, startLine: number, endLine: number) => {
    const trimmed = trimDecorationRange(terminal, startLine, endLine);

    if (!trimmed) {
      return;
    }

    const buffer = terminal.buffer.active;
    const cursorAbsolute = buffer.baseY + buffer.cursorY;
    const nextDecorations: IDecoration[] = [];

    for (let line = trimmed.start; line <= trimmed.end; line += 1) {
      if (isTerminalDividerLine(readBufferLine(terminal, line))) {
        continue;
      }

      const marker = terminal.registerMarker(line - cursorAbsolute);

      if (!marker || marker.isDisposed) {
        continue;
      }

      const decoration = terminal.registerDecoration({
        marker,
        x: 0,
        width: Math.max(terminal.cols, 1),
        layer: 'bottom',
      });

      if (!decoration) {
        continue;
      }

      decoration.onRender((element) => {
        element.classList.add(
          'terminal-command-decoration',
          'terminal-command-decoration--error',
        );
        element.style.left = '0px';
        element.style.width = '100%';
      });

      nextDecorations.push(decoration);
    }

    if (nextDecorations.length > 0) {
      activeDecorations.push(...nextDecorations);
      decorationBatches.push(nextDecorations);
      pruneDecorationBatches();
    }
  };

  return {
    handleEvents: (terminal, cleanedOutput, baseLine, events) => {
      if (events.length === 0) {
        return;
      }

      for (const event of events) {
        const eventLine = outputIndexToLine(baseLine, cleanedOutput, event.outputIndex);
        const cursorAbsolute =
          terminal.buffer.active.baseY + terminal.buffer.active.cursorY;

        if (event.type === 'start') {
          disposeMarker(pendingStartMarker);
          const startLine = resolveBlockStartLine(terminal, eventLine);
          pendingStartMarker = terminal.registerMarker(startLine - cursorAbsolute);
          continue;
        }

        if (event.exitCode === 0) {
          disposeMarker(pendingStartMarker);
          pendingStartMarker = null;
          continue;
        }

        const commandStartLine =
          pendingStartMarker && !pendingStartMarker.isDisposed
            ? pendingStartMarker.line
            : null;
        disposeMarker(pendingStartMarker);
        pendingStartMarker = null;

        const range = findFailedCommandRange(terminal, commandStartLine, eventLine);

        if (!range) {
          continue;
        }

        decorateRange(terminal, range.start, range.end);
      }
    },
    dispose: () => {
      disposeMarker(pendingStartMarker);
      pendingStartMarker = null;
      disposeDecorations(activeDecorations);
      activeDecorations = [];
      decorationBatches = [];
    },
  };
}
