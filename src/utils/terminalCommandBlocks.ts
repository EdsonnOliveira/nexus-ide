import type { Terminal } from '@xterm/xterm';
import { readTerminalCellDimensions } from '@/utils/terminalBadgeMetrics';

export interface TerminalCommandBlock {
  startRow: number;
  endRow: number;
  hoverStartRow: number;
  hoverEndRow: number;
  header: string;
  command: string;
  output: string;
  all: string;
}

export interface TerminalCommandBlockMenuPosition {
  top: number;
  left: number;
}

function readBufferLine(terminal: Terminal, row: number): string {
  return terminal.buffer.active.getLine(row)?.translateToString(true).replace(/\s+$/, '') ?? '';
}

export function isTerminalDividerLine(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length >= 8 && /^─+$/.test(trimmed);
}

function buildBlockFromRange(
  terminal: Terminal,
  hoverStartRow: number,
  endDividerRow: number,
): TerminalCommandBlock | null {
  let contentStart = hoverStartRow;
  let contentEnd = endDividerRow - 1;

  while (contentStart <= contentEnd && !readBufferLine(terminal, contentStart).trim()) {
    contentStart += 1;
  }

  while (contentEnd >= contentStart && !readBufferLine(terminal, contentEnd).trim()) {
    contentEnd -= 1;
  }

  if (contentStart > contentEnd) {
    return null;
  }

  const lines: string[] = [];

  for (let row = contentStart; row <= contentEnd; row += 1) {
    lines.push(readBufferLine(terminal, row));
  }

  let header = '';
  let command = '';
  let output = '';

  if (lines.length === 1) {
    command = lines[0] ?? '';
  } else if (lines.length >= 2) {
    header = lines[0] ?? '';
    command = lines[1] ?? '';
    output = lines.slice(2).join('\n');
  }

  if (!command.trim() && !output.trim() && !header.trim()) {
    return null;
  }

  const all = [command, output].filter((part) => part.length > 0).join('\n');

  return {
    startRow: contentStart,
    endRow: contentEnd,
    hoverStartRow,
    hoverEndRow: endDividerRow - 1,
    header,
    command,
    output,
    all,
  };
}

export function findCommandBlockAtRow(
  terminal: Terminal,
  row: number,
): TerminalCommandBlock | null {
  const buffer = terminal.buffer.active;
  const length = buffer.length;

  if (row < 0 || row >= length) {
    return null;
  }

  if (isTerminalDividerLine(readBufferLine(terminal, row))) {
    return null;
  }

  let endDividerRow = -1;

  for (let cursor = row; cursor < length; cursor += 1) {
    if (isTerminalDividerLine(readBufferLine(terminal, cursor))) {
      endDividerRow = cursor;
      break;
    }
  }

  if (endDividerRow === -1) {
    return null;
  }

  let hoverStartRow = 0;

  for (let cursor = endDividerRow - 1; cursor >= 0; cursor -= 1) {
    if (isTerminalDividerLine(readBufferLine(terminal, cursor))) {
      hoverStartRow = cursor + 1;
      break;
    }
  }

  if (row < hoverStartRow || row >= endDividerRow) {
    return null;
  }

  return buildBlockFromRange(terminal, hoverStartRow, endDividerRow);
}

export function getTerminalCellPosition(
  terminal: Terminal,
  event: MouseEvent,
): { row: number; col: number } | null {
  const screen = terminal.element?.querySelector('.xterm-screen');

  if (!screen) {
    return null;
  }

  const rect = screen.getBoundingClientRect();
  const col = Math.floor((event.clientX - rect.left) / (rect.width / terminal.cols));
  const relativeRow = Math.floor((event.clientY - rect.top) / (rect.height / terminal.rows));
  const row = terminal.buffer.active.viewportY + relativeRow;

  if (col < 0 || col >= terminal.cols || relativeRow < 0 || relativeRow >= terminal.rows) {
    return null;
  }

  return { row, col };
}

export function computeCommandBlockMenuPosition(
  shell: HTMLElement,
  mount: HTMLElement,
  terminal: Terminal,
  block: TerminalCommandBlock,
): TerminalCommandBlockMenuPosition | null {
  const cell = readTerminalCellDimensions(terminal, mount);
  const screen = mount.querySelector('.xterm-screen');

  if (!cell || !(screen instanceof HTMLElement)) {
    return null;
  }

  const viewportStart = terminal.buffer.active.viewportY;
  const viewportEnd = viewportStart + terminal.rows - 1;
  const visibleStart = Math.max(block.startRow, viewportStart);
  const visibleEnd = Math.min(block.endRow, viewportEnd);

  if (visibleStart > visibleEnd) {
    return null;
  }

  const shellRect = shell.getBoundingClientRect();
  const screenRect = screen.getBoundingClientRect();
  const buttonSize = 24;
  const inset = 4;
  const top =
    screenRect.top - shellRect.top + (visibleStart - viewportStart) * cell.height + inset;
  const left = screenRect.right - shellRect.left - buttonSize - inset;

  return {
    top: Math.max(0, top),
    left: Math.max(0, left),
  };
}
